/**
 * lib/enrichment/regressionGate.ts — the regression gate (owner, 2026-11-19): a value that was good in a batch already written is not lost by a later fix. Each written batch has a
 * baseline (baseline/batch_<N>.json: its good values and its acceptance results); scripts/regression.ts runs every written batch again from the recordings and compares. A wet run is
 * refused unless the gate passed for the code it runs on (regression_pass_<commit>.json).
 * The pure part (keys, comparison, the pass file) is here; the runs are in scripts/regression.ts.
 */
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";

export const BASELINE_DIR = "baseline";
export interface BaselineValue { company: string; field: string; value: string }
export interface AcceptanceRecord { id: string; severity: string; pass: boolean }
export interface Baseline { batch: number; commit: string; created_at: string; companies: number; source: string; values: BaselineValue[]; acceptance: AcceptanceRecord[] }
export interface RunRow { company: string; field: string; value: string }
export interface Rejected { company: string; field: string; value: string; reason_code: string }
export interface Lost extends BaselineValue { reason_code: string }
export interface Comparison { lost: Lost[]; added: BaselineValue[]; changed: Array<{ company: string; field: string; was: string; now: string }> }

/** Rows that are not values of the company: proposals for the owner, free text that varies, dated points of the run day. */
export const IGNORED_FIELDS = new Set(["(nothing)", "name_proposal", "website_proposal", "brand_after_acquisition", "founder_bio", "headcount_history", "employee_history"]);
/** One value per company: a different value is "changed", no value is "lost". */
export const SINGLE_FIELDS = new Set(["description", "sector", "hq_city", "hq_country", "founded_year", "founding_country", "employee_range", "employee_count"]);

export const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const family = (f: string) => (f === "description_what_only" ? "description" : f);
export const valueKey = (company: string, field: string, value: string) => `${fold(company).replace(/ /g, "")}:${family(field)}:${fold(value).slice(0, 200)}`;
const slot = (company: string, field: string) => `${fold(company).replace(/ /g, "")}:${family(field)}`;

/** The values of a report that the gate watches. */
export function watched(rows: RunRow[]): BaselineValue[] {
  const seen = new Set<string>(), out: BaselineValue[] = [];
  for (const r of rows) {
    if (!r.field || IGNORED_FIELDS.has(r.field) || !r.value?.trim()) continue;
    const k = valueKey(r.company, r.field, r.value);
    if (seen.has(k)) continue;
    seen.add(k); out.push({ company: r.company, field: family(r.field), value: r.value });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company) || a.field.localeCompare(b.field) || a.value.localeCompare(b.value));
}

/** What a baseline held, against what a run gives now. `rejections` name why a lost value is gone, when the run said so. */
export function compare(baseline: BaselineValue[], now: RunRow[], rejections: Rejected[] = []): Comparison {
  const nowW = watched(now);
  const nowKeys = new Set(nowW.map((v) => valueKey(v.company, v.field, v.value)));
  const nowBySlot = new Map<string, BaselineValue[]>();
  for (const v of nowW) { const s = slot(v.company, v.field); (nowBySlot.get(s) ?? nowBySlot.set(s, []).get(s)!).push(v); }
  const baseKeys = new Set(baseline.map((v) => valueKey(v.company, v.field, v.value)));
  const why = (v: BaselineValue): string => {
    const same = rejections.filter((r) => fold(r.company) === fold(v.company) && family(r.field) === family(v.field));
    const exact = same.find((r) => fold(r.value) && (fold(r.value).includes(fold(v.value).slice(0, 40)) || fold(v.value).includes(fold(r.value).slice(0, 40))));
    return (exact ?? same[0])?.reason_code ?? "not_found_now";
  };
  const lost: Lost[] = [], changed: Comparison["changed"] = [];
  for (const b of baseline) {
    if (nowKeys.has(valueKey(b.company, b.field, b.value))) continue;
    if (SINGLE_FIELDS.has(family(b.field))) {
      const there = nowBySlot.get(slot(b.company, b.field));
      if (there?.length) { changed.push({ company: b.company, field: b.field, was: b.value, now: there[0].value }); continue; }
    }
    lost.push({ ...b, reason_code: why(b) });
  }
  const added = nowW.filter((v) => !baseKeys.has(valueKey(v.company, v.field, v.value)) && !(SINGLE_FIELDS.has(family(v.field)) && baseline.some((b) => slot(b.company, b.field) === slot(v.company, v.field))));
  return { lost, added, changed };
}

/** The acceptance results that fail as an ERROR (a gap is not a regression). */
export function acceptanceErrors(results: Array<{ id: string; severity: string; pass: boolean; detail?: string }>): Array<{ id: string; detail: string }> {
  return results.filter((r) => !r.pass && r.severity === "error").map((r) => ({ id: r.id, detail: r.detail ?? "" }));
}

// ── baselines on disk ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const baselinePath = (n: number) => `${BASELINE_DIR}/batch_${n}.json`;
export function loadBaseline(n: number): Baseline | null {
  try { return JSON.parse(readFileSync(baselinePath(n), "utf8")) as Baseline; } catch { return null; }
}
export function saveBaseline(b: Baseline): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(baselinePath(b.batch), JSON.stringify(b, null, 1) + "\n");
}
/** The written batches the gate runs, in order. A batch written from now on is added by the wet run itself. */
export function writtenBatches(): number[] {
  try { const j = JSON.parse(readFileSync(`${BASELINE_DIR}/batches.json`, "utf8")) as { batches: number[] }; return [...new Set(j.batches)].sort((a, b) => a - b); } catch { return []; }
}
export function saveWrittenBatches(batches: number[]): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(`${BASELINE_DIR}/batches.json`, JSON.stringify({ batches: [...new Set(batches)].sort((a, b) => a - b) }, null, 1) + "\n");
}
export function addWrittenBatch(n: number): void { saveWrittenBatches([...writtenBatches(), n]); }

// ── the pass file ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const git = (args: string) => { try { return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
export const headCommit = () => git("rev-parse HEAD");
/**
 * The content of the code, whatever merge commit holds it: two commits with the same files are the same code. The baselines (baseline/) are data the gate itself keeps, not code: a batch joining
 * the gate, or the owner committing the baselines, does not make the code another code.
 */
export function headTree(): string {
  const listing = git("ls-tree -r HEAD").split("\n").filter((l) => l && !/\tbaseline\//.test(l) && !/\tregression_pass_/.test(l)).join("\n");
  return listing ? createHash("sha1").update(listing).digest("hex") : "";
}
export const treeIsClean = () => git("status --porcelain --untracked-files=no -- . :(exclude)baseline") === "";
export interface PassFile { commit: string; tree: string; at: string; batches: number[]; values: number; cost_usd: number }
export const passFileName = (commit: string) => `regression_pass_${commit.slice(0, 12)}.json`;
export function writePass(p: PassFile): string { const f = passFileName(p.commit); writeFileSync(f, JSON.stringify(p, null, 1) + "\n"); return f; }
/** A wet run needs a pass for the code it runs: the commit's own file, or a file of any commit whose tree is the same. */
export function passFor(commit: string, tree: string, dir = "."): PassFile | null {
  if (!commit) return null;
  const own = `${dir}/${passFileName(commit)}`;
  const read = (f: string) => { try { return JSON.parse(readFileSync(f, "utf8")) as PassFile; } catch { return null; } };
  const o = existsSync(own) ? read(own) : null;
  if (o && (!o.tree || o.tree === tree)) return o;
  for (const f of readdirSync(dir).filter((x) => /^regression_pass_[0-9a-f]+\.json$/.test(x))) { const p = read(`${dir}/${f}`); if (p && tree && p.tree === tree) return p; }
  return null;
}
