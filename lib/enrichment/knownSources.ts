/**
 * lib/enrichment/knownSources.ts — memory of verified sources (owner, round 10): what was verified once is not searched for again.
 *
 * Every value a run reported with a source address and a quote is kept (company, field, value, source, quote, date, run). A later run first
 * re-reads those addresses and checks the quote is still there: confirmed → the value stays, with no model and no search; the page cannot be
 * read → the value stays, marked stale_check_failed; the page is read and the quote is gone → the value goes back to review (not deleted, not
 * carried). Values the owner marked correct are locked: a later run does not replace them. Fields that change over time (leaders, headcount,
 * headquarters, news, rounds) are carried only for REFRESH_DAYS after they were verified; after that the run's own search must renew them.
 *
 * Dry runs keep this in cache/known_sources.json; a wet run reads field_provenance for the same thing (not built yet).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface KnownEntry {
  company_id: string; company: string; field: string; value: string;
  source_url: string; quote: string; verified_at: string; run_id: string;
  status?: "ok" | "stale_check_failed" | "quote_gone";
}
export type KnownStore = Record<string, KnownEntry[]>;     // company_id → entries
export interface ReportRow { company_id: string; company: string; field: string; before: string; after: string; source_url: string; quote: string; origin?: string }

export const VOLATILE_FIELDS = new Set(["leader", "headcount_history", "employee_count", "employee_range", "hq_city", "hq_country", "office", "news", "round", "acquired"]);
/** Fields with one value: a locked (marked correct) value is kept against a different new one. */
export const SINGLE_FIELDS = new Set(["tags", "founded_year", "founding_country", "hq_city", "hq_country", "sector", "description", "description_what_only", "employee_count", "employee_range"]);
export const KNOWN_PATH = process.env.KNOWN_SOURCES ?? "cache/known_sources.json";
export const refreshDays = (): number => Number(process.env.REFRESH_DAYS ?? 90);

export const loadKnown = (path = KNOWN_PATH): KnownStore => {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as KnownStore : {}; } catch { return {}; }
};
export function saveKnown(store: KnownStore, path = KNOWN_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 1));
}

/** description and description_what_only are one field: a company has one description, complete or what-only. */
const family = (f: string) => (f === "description_what_only" ? "description" : f);
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const markKey = (company: string, field: string, value: string) => `${fold(company)}|${field}|${fold(value).slice(0, 80)}`;

const ageDays = (iso: string, today: string) => (Date.parse(today) - Date.parse(iso)) / 86_400_000;
/** A volatile value older than REFRESH_DAYS is not carried: the run must find it again. */
export const refreshDue = (e: Pick<KnownEntry, "field" | "verified_at">, today: string, days = refreshDays()): boolean =>
  VOLATILE_FIELDS.has(e.field) && ageDays(e.verified_at, today) > days;

/** Adds what a run reported (rows with a source) to the store; a value already there gets the new date and run. */
export function remember(store: KnownStore, rows: ReportRow[], runId: string, today: string, wrong: Set<string> = new Set()): number {
  let added = 0;
  for (const r of rows) {
    if (!r.company_id || r.field === "(nothing)" || !r.after || !r.source_url) continue;
    if (r.origin && r.origin !== "new") continue;                                   // carried rows are not re-verified here
    if (wrong.has(markKey(r.company, r.field, r.after))) continue;                  // marked wrong: never remembered
    const list = store[r.company_id] ?? (store[r.company_id] = []);
    const same = list.find((e) => e.field === r.field && fold(e.value) === fold(r.after));
    if (same) { Object.assign(same, { source_url: r.source_url, quote: r.quote || same.quote, verified_at: today, run_id: runId, status: "ok" as const }); continue; }
    // A single-valued field has one value: the newer replaces the older one.
    if (SINGLE_FIELDS.has(r.field)) for (let i = list.length - 1; i >= 0; i--) if (family(list[i].field) === family(r.field)) list.splice(i, 1);
    list.push({ company_id: r.company_id, company: r.company, field: r.field, value: r.after, source_url: r.source_url, quote: r.quote, verified_at: today, run_id: runId, status: "ok" });
    added++;
  }
  return added;
}

export type Check = "confirmed" | "stale_check_failed" | "quote_gone";
/** Is the entry's quote still on its page? `readText` returns the page text or null when it could not be read. */
export async function checkEntry(e: KnownEntry, readText: (url: string) => Promise<string | null>): Promise<Check> {
  const text = await readText(e.source_url);
  if (!text) return "stale_check_failed";
  const hay = fold(text);
  const needle = fold(e.quote || e.value).slice(0, 90);
  if (!needle) return "stale_check_failed";
  return hay.includes(needle) ? "confirmed" : "quote_gone";
}

export interface CarryResult { rows: ReportRow[]; carried: ReportRow[]; fromMemory: string[]; fromSearch: string[]; recheck: string[]; refreshDue: string[]; locked: string[] }

/**
 * The company's report rows with the memory applied: values already verified and still confirmed are carried (also the ones this run did not
 * find again); a locked value stays against a different new one.
 */
export async function applyKnown(
  store: KnownStore, companyId: string, rows: ReportRow[], today: string, readText: (url: string) => Promise<string | null>,
  locked: Set<string> = new Set(),
): Promise<CarryResult> {
  const known = store[companyId] ?? [];
  const real = rows.filter((r) => r.field !== "(nothing)");
  const have = (field: string, value: string) => real.some((r) => family(r.field) === family(field) && fold(r.after) === fold(value));
  const hasField = (field: string) => real.some((r) => family(r.field) === family(field));
  const out: ReportRow[] = [...real];
  const carried: ReportRow[] = [], recheck: string[] = [], due: string[] = [], lockedKept: string[] = [], fromMemory = new Set<string>();
  const cache = new Map<string, Promise<string | null>>();
  const read = (u: string) => cache.get(u) ?? (cache.set(u, readText(u).catch(() => null)), cache.get(u)!);
  for (const e of known) {
    if (e.status === "quote_gone") continue;
    if (have(e.field, e.value)) continue;
    const isLocked = locked.has(markKey(e.company, e.field, e.value));
    // A different new value for a single-valued field stands, unless the old one is locked.
    if (SINGLE_FIELDS.has(e.field) && hasField(e.field) && !isLocked) continue;
    if (!isLocked && refreshDue(e, today)) { due.push(`${e.field}: ${e.value.slice(0, 40)}`); continue; }
    const check = await checkEntry(e, async () => read(e.source_url));
    if (check === "quote_gone") { e.status = "quote_gone"; recheck.push(`${e.field}: ${e.value.slice(0, 40)}`); continue; }
    e.status = check === "confirmed" ? "ok" : "stale_check_failed";
    if (isLocked && SINGLE_FIELDS.has(e.field) && hasField(e.field)) {
      for (let i = out.length - 1; i >= 0; i--) if (family(out[i].field) === family(e.field)) out.splice(i, 1);
      lockedKept.push(`${e.field}: ${e.value.slice(0, 40)}`);
    }
    const row: ReportRow = { company_id: e.company_id, company: e.company, field: e.field, before: "", after: e.value, source_url: e.source_url, quote: e.quote, origin: check === "confirmed" ? "known_source" : "known_source_stale_check_failed" };
    out.push(row); carried.push(row); fromMemory.add(e.field);
  }
  const fromSearch = [...new Set(real.map((r) => r.field))].filter((f) => !fromMemory.has(f) || real.some((r) => r.field === f));
  return { rows: out, carried, fromMemory: [...fromMemory], fromSearch, recheck, refreshDue: due, locked: lockedKept };
}
