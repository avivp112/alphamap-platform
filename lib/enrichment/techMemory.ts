/**
 * lib/enrichment/techMemory.ts — a company turned away as not technology stays turned away (owner, round 10): noo.ma was "not technology" in one run and went through in the next,
 * Mototech was "not technology" and then "undetermined". A rejection is kept with its reason and date and reused for TECH_MEMORY_DAYS (90) days, which also saves the searches.
 * TECH_RECHECK=true ignores the memory for one run; deleting the company's entry in cache/tech_decisions.json lifts it for good.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface TechRecord { reason: string; kind: "early" | "profile"; date: string }
const path = () => process.env.TECH_DECISIONS ?? "cache/tech_decisions.json";
const days = () => Number(process.env.TECH_MEMORY_DAYS ?? 90);

function load(): Record<string, TechRecord> {
  try { return existsSync(path()) ? JSON.parse(readFileSync(path(), "utf8")) as Record<string, TechRecord> : {}; } catch { return {}; }
}

/** The stored rejection of this company, when it is still valid and not being re-checked. */
export function storedRejection(companyId: string, today = new Date().toISOString().slice(0, 10)): TechRecord | null {
  if (process.env.TECH_RECHECK === "true") return null;
  const r = load()[companyId];
  if (!r) return null;
  // A rejection is permanent — it is an automatic tech_override (owner, round 10) — unless the owner lifts it (delete its entry, or TECH_RECHECK=true for one run).
  // TECH_MEMORY_DAYS, when set, still limits it.
  return process.env.TECH_MEMORY_DAYS && (Date.parse(today) - Date.parse(r.date)) / 86_400_000 > days() ? null : r;
}

export function rememberRejection(companyId: string, rec: Omit<TechRecord, "date">, today = new Date().toISOString().slice(0, 10)): void {
  const all = load();
  all[companyId] = { ...rec, date: today };
  mkdirSync(dirname(path()), { recursive: true });
  writeFileSync(path(), JSON.stringify(all, null, 1));
}
