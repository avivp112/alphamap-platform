/**
 * lib/enrichment/collectedStore.ts — what the live run collected for a company, kept on disk, so the write step reads it instead of collecting again (owner, 2026-11-23, stage 3 option A).
 * The write used to replay the model's recordings, which needed the day of the live run and the same prompts; now it loads the CollectedCompany that writeCollected receives and calls it unchanged.
 *  - saveCollected writes collected/batch_<N>/<company_id>.json and refuses to write a file that does not come back identical (a Map, a Set or a Date lost on the way is an error, not a silent change).
 *  - loadCollected gives the company back, or says why not: no file, or the company's rounds in the database are no longer the rounds the plan was made against ("stale").
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";

const TAG = "__t";
/** Map, Set and Date go through JSON as tagged objects; anything else must already be plain data. */
export function encode(value: unknown, path = "$"): unknown {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) return { [TAG]: "num", v: String(value) }; return value; }
  if (typeof value === "bigint" || typeof value === "symbol") throw new Error(`cannot keep a ${typeof value} at ${path}`);
  if (typeof value === "function") throw new Error(`cannot keep a function at ${path}`);
  if (value instanceof Date) return { [TAG]: "date", v: value.toISOString() };
  if (value instanceof Map) return { [TAG]: "map", v: [...value.entries()].map(([k, x], i) => [encode(k, `${path}.key${i}`), encode(x, `${path}[${String(k)}]`)]) };
  if (value instanceof Set) return { [TAG]: "set", v: [...value].map((x, i) => encode(x, `${path}[${i}]`)) };
  if (Array.isArray(value)) return value.map((x, i) => encode(x, `${path}[${i}]`));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`cannot keep a ${(value as object).constructor?.name ?? "class instance"} at ${path}`);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(value as Record<string, unknown>)) { if (x === undefined) continue; out[k] = encode(x, `${path}.${k}`); }
  if (TAG in out) throw new Error(`a key named ${TAG} at ${path}`);
  return out;
}
export function decode(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  const o = value as Record<string, unknown>;
  if (TAG in o) {
    const v = o.v;
    switch (o[TAG]) {
      case "date": return new Date(v as string);
      case "map": return new Map((v as Array<[unknown, unknown]>).map(([k, x]) => [decode(k), decode(x)]));
      case "set": return new Set((v as unknown[]).map(decode));
      case "num": return Number(v);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = decode(x);
  return out;
}

/** Structural equality: Map/Set/Date/array/object, undefined-valued keys ignored. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof Map || b instanceof Map) { if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false; for (const [k, x] of a) if (!b.has(k) || !sameData(x, b.get(k))) return false; return true; }
  if (a instanceof Set || b instanceof Set) { if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false; const bs = [...b]; return [...a].every((x) => bs.some((y) => sameData(x, y))); }
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined), kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => k in (b as object) && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export interface RoundSnapshot { id: string; round_type: string | null; amount_raised: number | null; announcement_date: string | null }
export const snapshotRounds = (rounds: ReadonlyArray<RoundSnapshot>): RoundSnapshot[] =>
  rounds.map((r) => ({ id: r.id, round_type: r.round_type ?? null, amount_raised: r.amount_raised ?? null, announcement_date: r.announcement_date ?? null })).sort((x, y) => x.id.localeCompare(y.id));

export const collectedDir = (dir: string) => dir;
export const collectedPath = (dir: string, companyId: string) => `${dir}/${companyId}.json`;

/** The functions CollectedCompany carries are views of allSources; they are rebuilt on load. */
const REBUILT = ["sourceTypeFor", "sourceUrlFor"] as const;

export function saveCollected(dir: string, companyId: string, collected: unknown, rounds: ReadonlyArray<RoundSnapshot>): void {
  const c = { ...(collected as Record<string, unknown>) };
  for (const k of REBUILT) delete c[k];
  const encoded = encode(c);
  const back = decode(JSON.parse(JSON.stringify(encoded)));
  if (!sameData(back, c)) throw new Error("the collected company does not come back identical from disk — not saved");
  mkdirSync(dir, { recursive: true });
  writeFileSync(collectedPath(dir, companyId), JSON.stringify({ version: 1, saved_at: new Date().toISOString(), rounds: snapshotRounds(rounds), collected: encoded }));
}

export type Loaded = { ok: true; collected: Record<string, unknown> } | { ok: false; reason: "missing" | "stale" | "unreadable"; detail: string };

export function loadCollected(dir: string, companyId: string, currentRounds: ReadonlyArray<RoundSnapshot>): Loaded {
  const f = collectedPath(dir, companyId);
  if (!existsSync(f)) return { ok: false, reason: "missing", detail: `no ${f}` };
  let file: { version: number; rounds: RoundSnapshot[]; collected: unknown };
  try { file = JSON.parse(readFileSync(f, "utf8")); } catch (e) { return { ok: false, reason: "unreadable", detail: String(e) }; }
  if (file.version !== 1) return { ok: false, reason: "unreadable", detail: `version ${file.version}` };
  const now = JSON.stringify(snapshotRounds(currentRounds)), then = JSON.stringify(snapshotRounds(file.rounds));
  if (now !== then) return { ok: false, reason: "stale", detail: "the company's rounds in the database are not the rounds the plan was made against — collect it again" };
  const c = decode(file.collected) as Record<string, unknown>;
  const sources = (c.allSources ?? []) as Array<{ source_id: string; source_type: unknown; url?: string | null }>;
  const byId = (c.sourceById instanceof Map ? c.sourceById : new Map(sources.map((s) => [s.source_id, s]))) as Map<string, { source_type: unknown; url?: string | null }>;
  c.sourceTypeFor = (id: string | undefined) => (id ? byId.get(id)?.source_type : undefined);
  c.sourceUrlFor = (id: string | undefined) => (id ? byId.get(id)?.url ?? null : null);
  return { ok: true, collected: c };
}
