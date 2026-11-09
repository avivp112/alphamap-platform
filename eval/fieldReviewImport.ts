/**
 * eval/fieldReviewImport.ts — the owner's field-review marks as golden-set entries (owner,
 * 2026-11-05). Pure; eval/import_field_review.ts reads the files.
 *
 * The first marking of every value is the measurement: the verdict as the owner gave it, whatever
 * rule was corrected afterwards. A company enters as a judged-only entry (score.ts `judged_only`):
 * what the owner called correct is a verified golden value; what he called wrong is a known wrong
 * one where the schema can say so (rounds, competitors, patents); everything the pipeline produces
 * beyond those is unjudged — excluded from precision, never a wrong write. Fields the schema has
 * no place for (offices, leaders, news, bios, employees) are not imported.
 */
import type { GoldenCompany, GoldenRound } from "./score.ts";
import type { Mark } from "../lib/enrichment/fieldReview.ts";

/** Marks that are first-pass verdicts on a company outside the golden set: review runs, wet batches, the model check. */
export const IMPORTABLE_ID = /^(?:\d+|w\d+)\.\d+$|^m\.\d+$/;

export const slug = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Series A $35M · 2026-09-09 · lead Oak HC/FT" → a golden round; null when it has no amount. */
export function parseRoundValue(value: string, source_url?: string): GoldenRound | null {
  const type = value.split(/\s+\$|\s+amount not disclosed/i)[0].trim();
  const amt = value.match(/\$([\d.]+)\s*([MB])\b/i);
  if (!type || !amt) return null;
  const amount_usd = Math.round(Number(amt[1]) * (amt[2].toUpperCase() === "B" ? 1e9 : 1e6));
  const date = value.match(/·\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?)\b/)?.[1] ?? null;
  const lead = value.match(/·\s*lead\s+(.+?)\s*$/i)?.[1] ?? null;
  return { type, amount_usd, date, lead_investor: lead, confidence: "verified", ...(source_url ? { source_url } : {}) };
}

export interface ImportResult { company: GoldenCompany; counts: Record<string, number> }

/** One company's golden entry from its marks; null when nothing in them can be imported. */
export function goldenFromMarks(company: string, marks: Mark[]): ImportResult | null {
  const mine = marks.filter((m) => m.company === company && IMPORTABLE_ID.test(m.id));
  const ok = (f: string) => mine.filter((m) => m.field === f && m.verdict === "correct");
  const bad = (f: string) => mine.filter((m) => m.field === f && m.verdict === "wrong");
  const g: GoldenCompany = { id: slug(company), name: company, judged_only: true, reviewed_by_human: true, hard_case_tags: ["field_review"] };
  const counts: Record<string, number> = {};
  const scalar = (field: string, set: (v: string, url: string | undefined) => void) => { const m = ok(field)[0]; if (m) { set(m.value, m.source_url || undefined); counts[field] = (counts[field] ?? 0) + 1; } };
  const gf = <T,>(value: T, url?: string) => ({ value, confidence: "verified" as const, ...(url ? { source_url: url } : {}) });
  scalar("hq_city", (v, u) => { g.city = gf(v, u); });
  scalar("hq_country", (v, u) => { g.country = gf(v, u); });
  scalar("founded_year", (v, u) => { const n = Number(v.match(/\d{4}/)?.[0]); if (n) g.founded_year = gf(n, u); });
  scalar("founding_country", (v, u) => { g.founding_country = gf(v, u); });

  const founders = ok("founder").map((m) => { const [name, ...t] = m.value.split(/\s+—\s+/); return { name: name.trim(), ...(t.length ? { title: t.join(" — ") } : {}), confidence: "verified" as const, ...(m.source_url ? { source_url: m.source_url } : {}) }; });
  if (founders.length) { g.founders = founders; counts.founder = founders.length; }

  const rounds = ok("round").map((m) => parseRoundValue(m.value, m.source_url)).filter((r): r is GoldenRound => !!r);
  if (rounds.length) { g.funding_rounds = rounds; counts.round = rounds.length; }
  const wrongRounds = bad("round").map((m) => parseRoundValue(m.value, m.source_url)).filter((r): r is GoldenRound => !!r);
  if (wrongRounds.length) { g.funding_rounds_wrong = wrongRounds; counts.round_wrong = wrongRounds.length; }

  const names = ok("competitor").map((m) => m.value.trim());
  const notNames = bad("competitor").map((m) => m.value.trim());
  if (names.length || notNames.length) {
    g.competitors = { names, ...(notNames.length ? { not_competitors: notNames } : {}), confidence: "verified", source_urls: ok("competitor").map((m) => m.source_url).filter(Boolean) };
    counts.competitor = names.length + notNames.length;
  }

  const number = (v: string) => v.split(/\s+/)[0];
  const patents = ok("patent").map((m) => number(m.value));
  const notPatents = bad("patent").map((m) => number(m.value));
  if (patents.length || notPatents.length) {
    g.patents = { numbers: patents, ...(notPatents.length ? { not_numbers: notPatents } : {}), confidence: "verified" };
    counts.patent = patents.length + notPatents.length;
  }
  // The fields the owner has verified here (score.ts reviewed_fields); founders are listed in the
  // entry but not scored — it holds only the ones he marked.
  const reviewed = [g.city && "city", g.country && "country", g.founded_year && "founded_year", g.founding_country && "founding_country",
    (g.funding_rounds || g.funding_rounds_wrong) && "rounds", g.competitors && "competitors", g.patents && "patents"].filter((f): f is string => !!f);
  g.reviewed_fields = reviewed;
  return Object.keys(counts).length ? { company: g, counts } : null;
}

/** Every company with importable marks that the golden set does not hold yet (by name). */
export function newGoldenEntries(marks: Mark[], existing: Array<{ name: string; aka?: string[] }>): ImportResult[] {
  const have = new Set(existing.flatMap((c) => [c.name, ...(c.aka ?? [])].map(norm)));
  const companies = [...new Set(marks.filter((m) => IMPORTABLE_ID.test(m.id)).map((m) => m.company))];
  return companies.filter((c) => !have.has(norm(c))).map((c) => goldenFromMarks(c, marks)).filter((r): r is ImportResult => !!r);
}

/** nameKey(name) → startups.id from CSV rows that have both a `company` and a `company_id` column. */
/** One key for a company name across files: case, accents, spacing and punctuation do not matter. */
export const nameKey = (n: string) => n.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function companyIdsFromCsv(rows: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const ci = header.indexOf("company"), ii = header.indexOf("company_id");
  if (ci < 0 || ii < 0) return out;
  for (const r of rows.slice(1)) {
    const name = (r[ci] ?? "").trim(), id = (r[ii] ?? "").trim();
    if (name && /^[0-9a-f-]{36}$/i.test(id) && !out.has(nameKey(name))) out.set(nameKey(name), id);
  }
  return out;
}

/**
 * Keeps the companies whose id is known AND whose database row has a website, and copies that website
 * (by id, never by name) into the entry. The rest are returned with the reason they stay out.
 */
export function withWebsites(candidates: ImportResult[], ids: Map<string, string>, sites: Map<string, string | null>): { kept: ImportResult[]; dropped: Array<ImportResult & { reason: string }> } {
  const kept: ImportResult[] = []; const dropped: Array<ImportResult & { reason: string }> = [];
  for (const c of candidates) {
    const id = ids.get(nameKey(c.company.name));
    if (!id) { dropped.push({ ...c, reason: "no company id in the review files" }); continue; }
    const site = (sites.get(id) ?? "").trim();
    if (!site) { dropped.push({ ...c, reason: `no website in the database (id ${id})` }); continue; }
    kept.push({ ...c, company: { ...c.company, company_id: id, website: /^https?:\/\//i.test(site) ? site : `https://${site}` } });
  }
  return { kept, dropped };
}
