/**
 * eval/manualRounds.ts — rounds the owner adds to (or completes in) the golden set by hand
 * (2026-11-06). Pure. A round that is already there (same type and an amount within 1%) is completed —
 * its date, source and investors are set from the entry — never added twice; otherwise it is added.
 * Idempotent: running it again changes nothing.
 */
import type { GoldenCompany, GoldenRound } from "./score.ts";

export interface ManualRound {
  company_id: string;
  type: string;
  amount_usd: number | null;
  date: string | null;
  source_url: string;
  lead_investor?: string | null;
  investors?: string[];
  note?: string;
}

export const MANUAL_ROUNDS: ManualRound[] = [
  // The siliconangle article is tier 4: the owner approved it for this round (2026-11-06).
  { company_id: "hibob", type: "Other", amount_usd: 166_000_000, date: "2026-09-01", investors: ["Salesforce"], source_url: "https://siliconangle.com/2026/09/01/hr-software-startup-hibob-raises-166m-after-annualized-revenue-tops-400m/" },
  // Marked correct on the rounds sheet without a date; the owner gave the date and the wire.
  { company_id: "cato-networks", type: "Series B", amount_usd: 30_000_000, date: "2016-09-13", source_url: "https://www.globenewswire.com/news-release/2016/09/13/1060385/0/en/Cato-Networks-Secures-30M-to-Accelerate-Customer-Adoption-of-Networking-and-Security-in-the-Cloud.html" },
  // Marked "נכון" on the rounds sheet on 2026-11-06; entered here because the marks did not reach the file in Cloud Shell.
  { company_id: "upwind-security", type: "Series C", amount_usd: 400_000_000, date: "2026-10-28", lead_investor: "Bessemer Venture Partners", source_url: "https://techcrunch.com/2026/10/28/upwind-raises-400m-after-walking-away-from-datadog-acquisition-offer/" },
  { company_id: "mistral-ai", type: "Series D", amount_usd: 3_480_000_000, date: "2026-09-08", lead_investor: "Samsung Electronics", source_url: "https://mistral.ai/news/mistral-makes-sovereign-open-weight-ai-to-frontier/" },
];

const sameAmount = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && b !== 0 && Math.abs(a - b) / b <= 0.01;

export function applyManualRounds(companies: GoldenCompany[], entries: ManualRound[]): { companies: GoldenCompany[]; report: string[] } {
  const report: string[] = [];
  const out = companies.map((c) => ({ ...c, funding_rounds: c.funding_rounds ? c.funding_rounds.map((r) => ({ ...r })) : c.funding_rounds }));
  for (const e of entries) {
    const g = out.find((c) => c.id === e.company_id);
    if (!g) { report.push(`✗ ${e.company_id}: not in the golden set — ${e.type} ${e.amount_usd} not added`); continue; }
    const rounds = (g.funding_rounds ??= []);
    const hit = rounds.find((r) => sameAmount(r.amount_usd, e.amount_usd) && r.type.toLowerCase() === e.type.toLowerCase());
    if (hit) {
      const before = JSON.stringify([hit.date, hit.source_url, hit.investors]);
      hit.date = e.date ?? hit.date;
      hit.source_url = e.source_url;
      if (e.investors) hit.investors = [...new Set([...(hit.investors ?? []), ...e.investors])];
      if (e.lead_investor) hit.lead_investor = e.lead_investor;
      hit.confidence = "verified";
      report.push(JSON.stringify([hit.date, hit.source_url, hit.investors]) === before ? `= ${g.name}: ${e.type} ${e.amount_usd} already complete` : `~ ${g.name}: ${e.type} ${e.amount_usd} completed (date ${hit.date})`);
    } else {
      const r: GoldenRound = { type: e.type, amount_usd: e.amount_usd, date: e.date, lead_investor: e.lead_investor ?? null, confidence: "verified", source_url: e.source_url, ...(e.investors ? { investors: e.investors } : {}) };
      rounds.push(r);
      report.push(`+ ${g.name}: ${e.type} ${e.amount_usd} ${e.date ?? ""} added`);
    }
  }
  return { companies: out, report };
}
