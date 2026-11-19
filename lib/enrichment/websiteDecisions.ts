/**
 * lib/enrichment/websiteDecisions.ts — the owner's decisions on a company's address (owner, 2026-11-19: Lulalend → Lula, lula.co.za). eval/website_decisions.json: { "<company>": "https://…" }.
 * A decided address is used instead of the one on file, for the run only (the database is not changed by this file); the proposal is made with `scripts/website_decision.ts` after the owner approved it.
 */
import { readFileSync } from "fs";

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
let cache: Map<string, string> | null = null;
export function websiteDecision(companyName: string, file = "eval/website_decisions.json"): string | null {
  if (!cache || file !== "eval/website_decisions.json") {
    const m = new Map<string, string>();
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, string>)) m.set(fold(k), v); } catch { /* no decisions */ }
    if (file !== "eval/website_decisions.json") return m.get(fold(companyName)) ?? null;
    cache = m;
  }
  return cache.get(fold(companyName)) ?? null;
}
