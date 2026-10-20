// =============================================================================
// worker/deepen.ts — "Deepen this profile": enrichment v2 on a company that is
// already in AlphaMap (migration 20261026000000, decision of 2026-10-20).
//
// The collection runs on the company's own row and rounds, exactly as the
// bulk run reads them. Then:
//   * the user sees what it found at once, on their own check, pending
//     verification;
//   * an EMPTY field that an official source (registry) fills with high
//     confidence is written to AlphaMap at once (directWrites);
//   * everything else — rounds, a value that would replace one on file,
//     weaker sources — is proposed to the admin as an "update" with the
//     differences (buildDiff), and written only on approval, by the same
//     Stage 10 (worker/promote.ts).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { V2_STARTUP_COLUMNS, V2_ROUND_COLUMNS, type CollectedCompany, type CollectResult, type V2StartupRow, type V2FundingRoundRow } from "../lib/enrichment/collect.ts";
import { computeFieldConfidence, meetsProfileThreshold } from "../lib/enrichment/confidence.ts";
import { BULK_THRESHOLDS, type WriteOutcome } from "../lib/enrichment/writeCompany.ts";
import type { EvidencedValue } from "../lib/enrichment/extractProfile.ts";
import { buildProfile, investorNames } from "./profile.ts";
import { PermanentError } from "./retry.ts";
import type { CheckRow } from "./queue.ts";
import type { Outcome } from "./runner.ts";

export interface Company { row: V2StartupRow; rounds: V2FundingRoundRow[] }

/** The AlphaMap company and its rounds, with the bulk run's own columns. */
export async function loadCompany(db: SupabaseClient, startupId: string): Promise<Company | null> {
  const [{ data: row, error: rErr }, { data: rounds, error: fErr }] = await Promise.all([
    db.from("startups").select(V2_STARTUP_COLUMNS).eq("id", startupId).maybeSingle(),
    db.from("funding_rounds").select(V2_ROUND_COLUMNS).eq("startup_id", startupId).order("created_at"),
  ]);
  if (rErr) throw new Error(`startups: ${rErr.message}`);
  if (fErr) throw new Error(`funding_rounds: ${fErr.message}`);
  return row ? { row: row as unknown as V2StartupRow, rounds: (rounds ?? []) as unknown as V2FundingRoundRow[] } : null;
}

// ── Written at once: empty fields an official source fills ───────────────────

/** computeFieldConfidence gives a registry source 90; nothing weaker is written without review. */
export const OFFICIAL_MIN_CONFIDENCE = 90;

export interface DirectWrite {
  field: "founded_year" | "country" | "city";
  value: string | number;
  source_url: string | null;
  quote: string | null;
}

export function directWrites(row: V2StartupRow, c: CollectedCompany): DirectWrite[] {
  const out: DirectWrite[] = [];
  const consider = (field: DirectWrite["field"], value: string | number | null | undefined, ev: EvidencedValue<unknown> | undefined, passes = true) => {
    if (value == null || value === "" || row[field] != null || !ev || !passes) return;
    const type = c.sourceTypeFor(ev.source_id);
    if (type !== "registry" || computeFieldConfidence([{ source_type: type }]) < OFFICIAL_MIN_CONFIDENCE) return;
    out.push({ field, value, source_url: c.sourceUrlFor(ev.source_id), quote: ev.evidence_quote ?? null });
  };
  const p = c.profile.profile;
  consider("founded_year", c.validation.accepted.founded_year, p.founded_year);
  consider("country", c.validation.accepted.country, p.country, meetsProfileThreshold(c.countryConfidence, BULK_THRESHOLDS));
  consider("city", c.validation.accepted.city, p.city, meetsProfileThreshold(c.cityConfidence, BULK_THRESHOLDS));
  return out;
}

/** Writes each one only if the field is still empty; returns those written. */
export async function applyDirectWrites(db: SupabaseClient, startupId: string, writes: DirectWrite[]): Promise<DirectWrite[]> {
  const written: DirectWrite[] = [];
  for (const w of writes) {
    const { data, error } = await db.from("startups").update({ [w.field]: w.value }).eq("id", startupId).is(w.field, null).select("id");
    if (error) throw new Error(`startups.${w.field}: ${error.message}`);
    if (!data?.length) continue;   // filled meanwhile: nothing replaced
    written.push(w);
    const { error: pErr } = await db.from("field_provenance").insert({
      startup_id: startupId, field: `profile.${w.field}`, value: w.value, source_url: w.source_url,
      source_type: "registry", evidence_quote: w.quote, confidence: OFFICIAL_MIN_CONFIDENCE,
    });
    if (pErr) console.error(`[worker] field_provenance (${w.field}): ${pErr.message}`);
  }
  if (written.length) {
    const { error } = await db.from("startups").update({ enriched_v2_at: new Date().toISOString() }).eq("id", startupId);
    if (error) console.error(`[worker] enriched_v2_at: ${error.message}`);
  }
  return written;
}

// ── Waits for the admin: what Stage 10 would write, as differences ───────────

export interface UpdateDiff {
  /** A single value: added (from null) or replacing the one on file. */
  fields: Array<{ field: string; from: unknown; to: unknown }>;
  /** Entries a list gains (people, competitors, news...); nothing is removed. */
  lists: Array<{ field: string; added: string[] }>;
  rounds: {
    inserts: Array<{ round_type: string; amount: number | null; date: string | null; lead: string | null; source_url: string | null }>;
    updates: Array<{ round_type: string; changes: string[] }>;
  };
  headcount_points: number;
  tags: string[];
}

const LIST_KEY: Record<string, (x: Record<string, unknown>) => string> = {
  founders: (x) => String(x.name ?? ""), leadership: (x) => String(x.name ?? ""), competitors: (x) => String(x.name ?? ""),
  acquisitions: (x) => String(x.company_name ?? ""), news: (x) => String(x.title ?? x.url ?? ""), patents: (x) => String(x.title ?? ""),
  arr_milestones: (x) => `${x.arr} (${x.date ?? "undated"})`, valuation_benchmarks: (x) => `${x.valuation} (${x.date ?? "undated"})`,
};

export function buildDiff(row: V2StartupRow, w: WriteOutcome, sectorName: string | null): UpdateDiff {
  const fields: UpdateDiff["fields"] = [];
  const lists: UpdateDiff["lists"] = [];
  const onFile = row as unknown as Record<string, unknown>;
  for (const [key, to] of Object.entries(w.patch)) {
    if (Array.isArray(to)) {
      const keyOf = LIST_KEY[key] ?? ((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)));
      const before = new Set(((onFile[key] as unknown[] | null) ?? []).map((x) => keyOf(x as Record<string, unknown>).toLowerCase()));
      const added = to.map((x) => keyOf(x as Record<string, unknown>)).filter((k) => k && !before.has(k.toLowerCase()));
      if (added.length) lists.push({ field: key, added });
    } else if (key === "sector_id") {
      fields.push({ field: "sector", from: null, to: sectorName ?? to });
    } else {
      fields.push({ field: key, from: onFile[key] ?? null, to });
    }
  }
  return {
    fields, lists,
    rounds: {
      inserts: w.roundInserts.map((r) => ({
        round_type: r.round_type, amount: r.amount_raised ?? null, date: r.announcement_date ?? null,
        lead: r.lead_investor ?? null, source_url: r.source_url ?? null,
      })),
      updates: w.roundUpdates.map((u) => ({ round_type: u.round_type, changes: Object.keys(u.patch) })),
    },
    headcount_points: w.headcountPoints.length,
    tags: w.tags,
  };
}

export const isEmptyDiff = (d: UpdateDiff): boolean =>
  !d.fields.length && !d.lists.length && !d.rounds.inserts.length && !d.rounds.updates.length && !d.headcount_points && !d.tags.length;

// ── The run ──────────────────────────────────────────────────────────────────

export interface DeepenDeps {
  loadCompany: (startupId: string) => Promise<Company | null>;
  collect: (company: Company, onStage: (stage: string) => void) => Promise<CollectResult>;
  applyDirectWrites: (startupId: string, writes: DirectWrite[]) => Promise<DirectWrite[]>;
  /** writeCollected in a dry run: what Stage 10 would write to this row. */
  dryRunWrite: (row: V2StartupRow, collected: CollectedCompany) => Promise<WriteOutcome>;
  investorFacts: (names: string[]) => Promise<Array<{ name: string } & Record<string, unknown>>>;
  proposeUpdate: (checkId: string, startupId: string, collected: CollectedCompany, diff: UpdateDiff) => Promise<void>;
  progress: (stage: string) => void;
}

const NOTHING_NEW: Record<string, string> = {
  no_change: "The research found nothing newer than what AlphaMap already has.",
  no_data: "The research found too little public information to add anything.",
  low_evidence: "The research found too little public information to add anything.",
  public: "The research suggests the company is publicly listed — AlphaMap's team will look at it.",
  rejected: "The research suggests the company is not technology-driven — AlphaMap's team will look at it.",
};

export async function runDeepen(check: CheckRow, d: DeepenDeps): Promise<Outcome> {
  const startupId = check.matched_startup_id;
  if (!startupId) throw new PermanentError("deepen check has no company");
  const company = await d.loadCompany(startupId);
  if (!company) throw new PermanentError("the company is no longer in AlphaMap");
  const name = company.row.name;

  d.progress("starting");
  const collected = await d.collect(company, d.progress);
  if (collected.outcome === "error") throw new Error(`enrichment: ${collected.reason}`);   // worth one more attempt
  if (collected.outcome !== "collected") {
    return {
      status: "no_new_data",
      patch: { result: { note: NOTHING_NEW[collected.outcome] }, progress: { stage: "done", at: new Date().toISOString() } },
      notify: { title: `${name}: nothing new found`, body: NOTHING_NEW[collected.outcome] },
    };
  }

  const profile = buildProfile(collected, name);
  d.progress("validating");
  const direct = await d.applyDirectWrites(startupId, directWrites(company.row, collected));
  // What review would add, against the row as it is now (after the direct writes).
  const now = (await d.loadCompany(startupId)) ?? company;
  const diff = buildDiff(now.row, await d.dryRunWrite(now.row, collected), profile.overview.sector);
  const proposed = !isEmptyDiff(diff);

  d.progress("investors");
  const { names, led } = investorNames(profile);
  const investors = (await d.investorFacts(names)).map((f) => ({ ...f, led_here: led.has(f.name.toLowerCase()) }));

  return {
    status: "done",
    patch: {
      result: { profile, investors, deepen: { direct, proposed, diff } },
      progress: { stage: "done", at: new Date().toISOString() },
    },
    notify: {
      title: `${name}: deeper profile ready`,
      body: proposed ? "What the research found is on your check; AlphaMap's team reviews it before it is added." : "What the research found is on your check.",
    },
    after: proposed ? () => d.proposeUpdate(check.id, startupId, collected, diff) : undefined,
  };
}
