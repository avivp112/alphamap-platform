/**
 * lib/enrichment/assemble.ts — pure helpers the orchestrator uses between
 * extraction and the database write:
 *
 *   - groundRoundDetails(): the round fields extractFunding() can't verify
 *     with a single verbatim quote (other_investors, investor_amounts,
 *     source_url) are checked mechanically against the fetched sources —
 *     the Cap Table tab shows these names, so a name no source mentions
 *     never reaches it.
 *   - planRoundWrites(): decides, per extracted round, whether it is a NEW
 *     round, the SAME round as one already on file (then only its empty
 *     fields are filled), or a CONTRADICTION (same round, different amount)
 *     that is reported and left alone. dedupRounds() only merges pairs with
 *     dates within 9 months and a matching amount/investor, so a re-run that
 *     found "Seed, $2M, 2020-03" for a company already holding "Seed, $2M,
 *     2020-01" (no investor) used to insert a second Seed row.
 *   - merge*Extractions(): fold a Stage 9 deep-dive extraction into the
 *     first-pass one. Fill-only: a first-pass value is never replaced, list
 *     sections are unioned by identity.
 */

import { normalizeForMatch, extractNumbersFromText } from "./evidence";
import { investorNamesMatch, normalizeRoundType, type RoundLike } from "./rounds";
import { termAppearsIn, normalizeUrlForMatch, type V2MarketExtraction, type V2NewsItem } from "./extractMarket";
import type { V2Round, V2FundingExtraction } from "./extractFunding";
import type { V2ProfileExtraction, V2Founder, V2Leader } from "./extractProfile";
import type { LabeledSource } from "./sources";

const sourceText = (s: LabeledSource) => `${s.title ?? ""} ${s.content} ${s.url}`;

// ── Round grounding ──────────────────────────────────────────────────────

export type RoundGroundingDrop = "investor_not_in_source" | "investor_amount_not_in_source" | "round_source_url_not_in_sources";

export function groundRoundDetails(
  round: V2Round,
  sources: LabeledSource[],
): { round: V2Round; dropped: RoundGroundingDrop[] } {
  const dropped: RoundGroundingDrop[] = [];
  const lead = round.lead_investor?.value ?? null;

  const seen = new Set<string>();
  const otherInvestors = (round.other_investors ?? []).filter((name) => {
    if (typeof name !== "string" || !name.trim()) return false;
    const key = normalizeForMatch(name);
    if (seen.has(key) || investorNamesMatch(name, lead)) return false;
    if (!sources.some((s) => termAppearsIn(name, sourceText(s)))) { dropped.push("investor_not_in_source"); return false; }
    seen.add(key);
    return true;
  });

  // A disclosed per-investor amount needs a source that names the investor
  // AND states that figure — never an even split of the round total.
  const investorAmounts = (round.investor_amounts ?? []).filter((ia) => {
    if (!ia?.name || typeof ia.amount !== "number" || ia.amount <= 0) return false;
    const ok = sources.some((s) => {
      const text = sourceText(s);
      return termAppearsIn(ia.name, text) && extractNumbersFromText(text).some((n) => Math.abs(n - ia.amount) / ia.amount < 0.001);
    });
    if (!ok) dropped.push("investor_amount_not_in_source");
    return ok;
  });

  // source_url: the model's URL only if it is one of the fetched sources;
  // otherwise the URL of the source its own evidence quotes came from.
  const byUrl = new Map(sources.map((s) => [normalizeUrlForMatch(s.url), s]));
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  let sourceUrl: string | undefined;
  if (round.source_url && byUrl.has(normalizeUrlForMatch(round.source_url))) {
    sourceUrl = byUrl.get(normalizeUrlForMatch(round.source_url))!.url;
  } else {
    if (round.source_url) dropped.push("round_source_url_not_in_sources");
    const citedId = (round.amount_raised ?? round.announcement_date ?? round.lead_investor ?? round.valuation)?.source_id;
    sourceUrl = citedId ? byId.get(citedId)?.url : undefined;
  }

  return {
    round: {
      ...round,
      other_investors: otherInvestors.length > 0 ? otherInvestors : undefined,
      investor_amounts: investorAmounts.length > 0 ? investorAmounts : undefined,
      source_url: sourceUrl,
    },
    dropped,
  };
}

// ── Round write planning ─────────────────────────────────────────────────

const NAMED_STAGES = new Set([
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D", "Series E", "Series F+",
]);
const GENERIC_TYPES = new Set(["Other", "Unknown"]);

function daysApart(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime(), db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(da - db) / 86_400_000;
}

function amountsClose(a: number | null | undefined, b: number | null | undefined, pct: number): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= pct;
}

/**
 * True when two records describe the same real-world round:
 *   - the same named stage (Seed, Series A, ...) with dates within ~9
 *     months or a date missing on either side — a company essentially
 *     never runs two different "Series B"s; or
 *   - any type, with amounts within 10% and dates within 60 days (the
 *     same raise reported under different labels, e.g. "Other" vs "Seed").
 */
export function isSameRound(a: RoundLike, b: RoundLike): boolean {
  const ta = normalizeRoundType(a.round_type), tb = normalizeRoundType(b.round_type);
  const gap = daysApart(a.announcement_date, b.announcement_date);
  if (ta === tb && NAMED_STAGES.has(ta) && (gap == null || gap <= 270)) return true;
  if (ta === tb && !NAMED_STAGES.has(ta) && gap != null && gap <= 60) return true;
  if (amountsClose(a.amount_raised, b.amount_raised, 0.10) && gap != null && gap <= 60) return true;
  return false;
}

export interface ExistingRoundRef extends RoundLike { id: string }

export interface RoundUpdate {
  id: string;
  round_type: string;
  patch: Record<string, unknown>;
}

export interface RoundConflict { round_type: string; message: string }

export interface RoundWritePlan {
  inserts: RoundLike[];
  updates: RoundUpdate[];
  conflicts: RoundConflict[];
}

/** Fills only the empty fields of `target` from `incoming` — never overwrites a value already present. */
function fillRound(target: RoundLike, incoming: RoundLike): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (target.amount_raised == null && incoming.amount_raised != null) patch.amount_raised = incoming.amount_raised;
  if (target.valuation == null && incoming.valuation != null) {
    patch.valuation = incoming.valuation;
    patch.is_valuation_estimated = incoming.is_valuation_estimated ?? null;
  }
  if (!target.announcement_date && incoming.announcement_date) patch.announcement_date = incoming.announcement_date;
  if (!target.lead_investor && incoming.lead_investor) patch.lead_investor = incoming.lead_investor;
  if (!target.source_url && incoming.source_url) patch.source_url = incoming.source_url;
  if (!target.investor_amounts?.length && incoming.investor_amounts?.length) patch.investor_amounts = incoming.investor_amounts;
  // Investors are additive: names already on the round are kept, newly
  // found participants appended (the lead is never duplicated into the list).
  const leadNow = (patch.lead_investor as string | undefined) ?? target.lead_investor ?? null;
  const current = target.other_investors ?? [];
  const additions = [
    ...(incoming.other_investors ?? []),
    // A lead that differs from the one on file still participated.
    ...(incoming.lead_investor && !investorNamesMatch(incoming.lead_investor, leadNow) ? [incoming.lead_investor] : []),
  ].filter((n) => !investorNamesMatch(n, leadNow) && !current.some((c) => investorNamesMatch(c, n)));
  const uniqueAdditions = additions.filter((n, i) => additions.findIndex((m) => investorNamesMatch(m, n)) === i);
  if (uniqueAdditions.length > 0) patch.investors = [...current, ...uniqueAdditions];
  if (GENERIC_TYPES.has(normalizeRoundType(target.round_type)) && !GENERIC_TYPES.has(normalizeRoundType(incoming.round_type))) {
    patch.round_type = normalizeRoundType(incoming.round_type);
  }
  return patch;
}

function conflictBetween(existing: RoundLike, incoming: RoundLike): string | null {
  if (existing.amount_raised != null && incoming.amount_raised != null && !amountsClose(existing.amount_raised, incoming.amount_raised, 0.15)) {
    return `amount on file ${existing.amount_raised.toLocaleString()} vs found ${incoming.amount_raised.toLocaleString()}`;
  }
  const gap = daysApart(existing.announcement_date, incoming.announcement_date);
  if (gap != null && gap > 120) {
    return `date on file ${existing.announcement_date} vs found ${incoming.announcement_date}`;
  }
  return null;
}

function closestMatch<T extends RoundLike>(candidates: T[], r: RoundLike): T | undefined {
  const matches = candidates.filter((c) => isSameRound(c, r));
  return matches.sort((x, y) =>
    (daysApart(x.announcement_date, r.announcement_date) ?? 9e9) - (daysApart(y.announcement_date, r.announcement_date) ?? 9e9),
  )[0];
}

/**
 * Plans the funding_rounds writes for one company. A round matching one
 * already on file only fills that row's empty fields; a match whose amount
 * (or date, by more than ~4 months) disagrees is a contradiction — the row
 * on file is left untouched and the conflict reported, never resolved by
 * guessing. Unmatched rounds are inserted, themselves deduped the same way.
 */
export function planRoundWrites(existing: ExistingRoundRef[], incoming: RoundLike[]): RoundWritePlan {
  const inserts: RoundLike[] = [];
  const updatesById = new Map<string, RoundUpdate>();
  const conflicts: RoundConflict[] = [];
  // Working copies so a second incoming round matching the same row sees
  // the fields the first one already filled.
  const working = existing.map((r) => ({ ...r }));

  for (const r of incoming) {
    const type = normalizeRoundType(r.round_type);
    if (type === "IPO") continue; // never stored, matching v1

    const onFile = closestMatch(working, r);
    if (onFile) {
      const conflict = conflictBetween(onFile, r);
      if (conflict) { conflicts.push({ round_type: type, message: conflict }); continue; }
      const patch = fillRound(onFile, r);
      if (Object.keys(patch).length === 0) continue;
      Object.assign(onFile, { ...patch, other_investors: (patch.investors as string[] | undefined) ?? onFile.other_investors });
      const prev = updatesById.get(onFile.id);
      updatesById.set(onFile.id, { id: onFile.id, round_type: normalizeRoundType(onFile.round_type), patch: { ...(prev?.patch ?? {}), ...patch } });
      continue;
    }

    const planned = closestMatch(inserts, r);
    if (planned) {
      const conflict = conflictBetween(planned, r);
      if (conflict) { conflicts.push({ round_type: type, message: conflict }); continue; }
      const { investors, ...rest } = fillRound(planned, r);
      Object.assign(planned, { ...rest, other_investors: (investors as string[] | undefined) ?? planned.other_investors });
      continue;
    }
    inserts.push({ ...r, round_type: type });
  }

  return { inserts, updates: [...updatesById.values()], conflicts };
}

// ── Deep-dive merges (fill-only) ─────────────────────────────────────────

const personKey = (name: string | undefined) => (name ? normalizeForMatch(name) : "");

function unionPeople<T extends { name: string }>(base: T[], extra: T[]): T[] {
  const keys = new Set(base.map((p) => personKey(p.name)).filter(Boolean));
  return [...base, ...extra.filter((p) => { const k = personKey(p.name); if (!k || keys.has(k)) return false; keys.add(k); return true; })];
}

export function mergeProfileExtractions(base: V2ProfileExtraction, extra: V2ProfileExtraction): V2ProfileExtraction {
  const p = { ...base.profile };
  const e = extra.profile;
  for (const key of [
    "website", "description", "description_source_ids", "value_proposition", "value_proposition_source_ids",
    "industry", "founded_year", "sector_name", "sub_sector_name", "linkedin_url", "facebook_url", "instagram_url",
  ] as const) {
    if (p[key] === undefined && e[key] !== undefined) (p as Record<string, unknown>)[key] = e[key];
  }
  if (!p.sub_sector_names?.length && e.sub_sector_names?.length) p.sub_sector_names = e.sub_sector_names;
  // City and country travel as a pair: a city is only taken from the deep
  // dive when the country agrees with whatever the first pass found.
  if (!p.city && !p.country) {
    if (e.city) p.city = e.city;
    if (e.country) p.country = e.country;
  } else if (!p.city && e.city && e.country && p.country && normalizeForMatch(e.country.value) === normalizeForMatch(p.country.value)) {
    p.city = e.city;
  } else if (!p.country && e.country && p.city && e.city && normalizeForMatch(e.city.value) === normalizeForMatch(p.city.value)) {
    p.country = e.country;
  }
  p.founders = unionPeople<V2Founder>(base.profile.founders ?? [], e.founders ?? []);

  const m = { ...base.metrics };
  if (!m.employee_count && extra.metrics.employee_count) m.employee_count = extra.metrics.employee_count;
  if (!m.employee_range && extra.metrics.employee_range) m.employee_range = extra.metrics.employee_range;
  if (!m.growth_trend && extra.metrics.growth_trend) m.growth_trend = extra.metrics.growth_trend;
  const dates = new Set((m.headcount_history ?? []).map((h) => h.date));
  m.headcount_history = [...(m.headcount_history ?? []), ...(extra.metrics.headcount_history ?? []).filter((h) => !dates.has(h.date))];

  return {
    is_public_company: base.is_public_company,
    is_tech_company: base.is_tech_company,
    profile: p,
    leadership: unionPeople<V2Leader>(base.leadership, extra.leadership),
    metrics: m,
  };
}

function newsDate(n: V2NewsItem): string { return n.published_date ?? ""; }

export function mergeMarketExtractions(base: V2MarketExtraction, extra: V2MarketExtraction): V2MarketExtraction {
  const compKeys = new Set(base.competitors.map((c) => normalizeForMatch(c.name)));
  const competitors = [...base.competitors, ...extra.competitors.filter((c) => {
    const k = normalizeForMatch(c.name); if (compKeys.has(k)) return false; compKeys.add(k); return true;
  })].slice(0, 6);

  const acqKeys = new Set(base.acquisitions.map((a) => normalizeForMatch(a.company_name)));
  const acquisitions = [...base.acquisitions, ...extra.acquisitions.filter((a) => {
    const k = normalizeForMatch(a.company_name); if (acqKeys.has(k)) return false; acqKeys.add(k); return true;
  })];

  const newsKeys = new Set(base.news.map((n) => normalizeUrlForMatch(n.url)));
  const news = [...base.news, ...extra.news.filter((n) => {
    const k = normalizeUrlForMatch(n.url); if (newsKeys.has(k)) return false; newsKeys.add(k); return true;
  })].sort((a, b) => newsDate(b).localeCompare(newsDate(a))).slice(0, 10);

  const patKey = (p: { patent_number?: string; title: string }) => p.patent_number ? `#${p.patent_number}` : normalizeForMatch(p.title);
  const patKeys = new Set(base.patents.map(patKey));
  const patents = [...base.patents, ...extra.patents.filter((p) => { const k = patKey(p); if (patKeys.has(k)) return false; patKeys.add(k); return true; })];

  return {
    competitors, acquisitions, news, patents,
    patent_summary: {
      patent_count: base.patent_summary.patent_count ?? extra.patent_summary.patent_count,
      patent_fields: base.patent_summary.patent_fields.length ? base.patent_summary.patent_fields : extra.patent_summary.patent_fields,
    },
    technology: {
      tech_stack: [...new Set([...(base.technology.tech_stack ?? []), ...(extra.technology.tech_stack ?? [])])],
      github_url: base.technology.github_url ?? extra.technology.github_url,
      huggingface_url: base.technology.huggingface_url ?? extra.technology.huggingface_url,
    },
  };
}

export function mergeFundingExtractions(base: V2FundingExtraction, extra: V2FundingExtraction): V2FundingExtraction {
  const figureKey = (n: number, d?: string) => `${n}|${d ?? ""}`;
  const arrKeys = new Set(base.arr_milestones.map((m) => figureKey(m.arr, m.date)));
  const valKeys = new Set(base.valuation_benchmarks.map((v) => figureKey(v.valuation, v.date)));
  return {
    // Rounds are concatenated; planRoundWrites() collapses duplicates.
    funding_rounds: [...base.funding_rounds, ...extra.funding_rounds],
    // A deep dive that found rounds the first pass missed means the first
    // pass's "complete" was wrong; otherwise keep the first-pass answer.
    funding_history_complete: extra.funding_rounds.length > 0 && base.funding_history_complete === true
      ? (extra.funding_history_complete ?? null)
      : (base.funding_history_complete ?? extra.funding_history_complete),
    arr_milestones: [...base.arr_milestones, ...extra.arr_milestones.filter((m) => !arrKeys.has(figureKey(m.arr, m.date)))],
    revenue_estimate: base.revenue_estimate ?? extra.revenue_estimate,
    valuation_benchmarks: [...base.valuation_benchmarks, ...extra.valuation_benchmarks.filter((v) => !valKeys.has(figureKey(v.valuation, v.date)))],
  };
}

// ── Small write-shape helpers ────────────────────────────────────────────

/** "2023-06" -> "2023-06-01", "2023" -> "2023-01-01"; null for anything unparseable or in the future. */
export function normalizeIsoDate(raw: string | null | undefined, today = new Date().toISOString().slice(0, 10)): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
  else if (/^\d{4}-\d{2}$/.test(s)) iso = `${s}-01`;
  else if (/^\d{4}$/.test(s)) iso = `${s}-01-01`;
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  return iso > today ? null : iso;
}

/** Appends items whose key isn't already present — existing entries are never removed or reordered. */
export function appendNew<T>(existing: T[], incoming: T[], keyOf: (t: T) => string, maxTotal = Infinity): T[] {
  const keys = new Set(existing.map(keyOf));
  const out = [...existing];
  for (const item of incoming) {
    if (out.length >= maxTotal) break;
    const k = keyOf(item);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    out.push(item);
  }
  return out;
}
