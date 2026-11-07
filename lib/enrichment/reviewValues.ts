/**
 * lib/enrichment/reviewValues.ts — the values a collection would write, by review field
 * (scripts/field_review.ts shows them; scripts/field_review_replay.ts re-derives the marked ones
 * under the current rules — owner, 2026-11-04).
 */
import type { collectCompany, V2StartupRow } from "./collect.ts";
import { buildProfile } from "../../worker/profile.ts";
import { profileSourceAllowed } from "./roundSources.ts";

/** The fields, in the order of the report and of the tracker. */
export const REVIEW_FIELDS = ["hq_city", "hq_country", "founded_year", "founding_country", "office", "employee_range", "employee_count", "founder", "founder_bio", "leader", "round", "competitor_declared", "competitor_market", "patent", "news", "founder_background"] as const;
export type Field = (typeof REVIEW_FIELDS)[number];
export interface Value { company_id: string; company: string; field: Field; value: string; on_file: string; source_url: string; quote: string }

/** Every value this collection would write for the company, by field. */
export function wouldWrite(c: Awaited<ReturnType<typeof collectCompany>>, row: V2StartupRow): Value[] {
  if (c.outcome !== "collected") return [];
  const p = buildProfile(c, row.name);
  const src = (id?: string | null) => (id ? c.sourceUrlFor(id) ?? "" : "");
  /** The first of these sources that is on the allowed list (field review run 1 showed LinkedIn first). */
  const allowedId = (ids?: string[]) => (ids ?? []).find((id) => { const x = c.sourceById.get(id); return !!x && profileSourceAllowed(x); });
  const quoteOf = (id?: string | null) => (id ? (c.sourceById.get(id)?.content ?? "").replace(/\s+/g, " ").slice(0, 200) : "");
  const usd = (n: number | null | undefined) => (n == null ? "amount not disclosed" : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : `$${+(n / 1e6).toFixed(1)}M`);
  const out: Value[] = [];
  const add = (field: Field, value: string, on_file: unknown, source_url = "", quote = "") => {
    if (!value) return;
    out.push({ company_id: row.id, company: row.name, field, value, on_file: on_file == null ? "" : String(on_file), source_url, quote: quote.replace(/\s+/g, " ").slice(0, 240) });
  };
  const fill = (field: Field, v: { value: unknown; source_url: string | null; quote: string | null } | null | undefined, onFile: unknown) => {
    if (v?.value == null || v.value === "" || (onFile != null && onFile !== "")) return; // only an empty field is filled
    add(field, String(v.value), onFile, v.source_url ?? "", v.quote ?? "");
  };
  fill("hq_city", p.overview.city, row.city);
  fill("hq_country", p.overview.country, row.country);
  fill("founded_year", p.overview.founded_year, row.founded_year);
  fill("founding_country", p.overview.founding_country, row.founding_country);
  const range = c.profile.metrics.employee_range;
  if (range && !row.employee_range) add("employee_range", range.value, row.employee_range, src(range.source_id), range.evidence_quote);
  const count = c.profile.metrics.employee_count;
  if (count && row.employee_count == null) add("employee_count", String(count.value), row.employee_count, src(count.source_id), count.evidence_quote);
  for (const o of p.overview.offices ?? []) add("office", [o.city, o.country].filter(Boolean).join(", "), "", o.source_url ?? "");
  const onFileFounders = new Set(((row.founders ?? []) as Array<{ name?: string }>).map((f) => (f.name ?? "").toLowerCase()));
  for (const f of c.profile.profile.founders ?? []) {
    if (!onFileFounders.has(f.name.toLowerCase())) add("founder", `${f.name}${f.title ? ` — ${f.title}` : ""}`, "", f.grounded_url ?? "");
    if (f.bio) { const id = allowedId(f.bio_source_ids); add("founder_bio", `${f.name}: ${f.bio}`, "", src(id), quoteOf(id)); }
    const filed = ((row.founders ?? []) as Array<{ name?: string; background?: Array<{ kind: string; organization: string }> }>).find((x) => (x.name ?? "").toLowerCase() === f.name.toLowerCase())?.background ?? [];
    for (const b of f.background ?? []) {
      if (filed.some((h) => h.kind === b.kind && h.organization.toLowerCase() === b.organization.toLowerCase())) continue;
      add("founder_background", `${f.name}: ${b.kind.replace("_", " ")} — ${b.organization}${b.role ? `, ${b.role}` : ""}${b.year ? ` (${b.year})` : ""}`, "", src(b.source_id), b.evidence_quote);
    }
  }
  for (const l of c.profile.leadership) {
    if (l.group === "board") continue; // the board is apart from the management (owner, 2026-11-04)
    // The source shown is an allowed one: the bio's, else the first allowed page that names the person.
    const id = allowedId(l.bio_source_ids) ?? c.allSources.find((x) => profileSourceAllowed(x) && `${x.title ?? ""} ${x.content}`.includes(l.name.split(" ").pop() ?? l.name))?.source_id;
    add("leader", `${l.name} — ${l.role}${l.bio ? ` · ${l.bio}` : ""}`, "", src(id));
  }
  for (const r of c.plan.inserts) {
    const original = r.amount_original != null && r.amount_currency && r.amount_currency !== "USD" ? ` (${r.amount_currency} ${r.amount_original.toLocaleString()})` : "";
    add("round", `${r.round_type} ${usd(r.amount_raised)}${original} · ${r.announcement_date ?? "no date"}${r.announcement_date_precision && r.announcement_date_precision !== "day" ? ` (${r.announcement_date_precision})` : ""}${r.lead_investor ? ` · lead ${r.lead_investor}` : ""}`, "", r.source_url ?? "");
  }
  const onFileCompetitors = new Set(((row.competitors ?? []) as Array<{ name?: string; unverified?: boolean }>).filter((x) => !x.unverified).map((x) => (x.name ?? "").toLowerCase()));
  for (const x of c.market.competitors) if (!onFileCompetitors.has(x.name.toLowerCase())) add(x.tier === "market" ? "competitor_market" : "competitor_declared", x.name, "", src(x.source_id), x.evidence_quote ?? x.how_it_competes);
  const onFilePatents = new Set(((row.patents ?? []) as Array<{ patent_number?: string }>).map((x) => x.patent_number));
  for (const pt of c.market.patents) if (!onFilePatents.has(pt.patent_number)) add("patent", `${pt.patent_number ?? ""} ${pt.title}`.trim(), "", pt.url ?? "");
  const onFileNews = new Set(((row.news ?? []) as Array<{ url?: string }>).map((x) => x.url));
  for (const n of c.market.news) if (!onFileNews.has(n.url)) add("news", `${n.published_date || "no date"} — ${n.title}`, "", n.url);
  return out;
}

