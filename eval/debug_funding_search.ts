#!/usr/bin/env node
/**
 * eval/debug_funding_search.ts — throwaway diagnostic, NOT part of Phase 0/1
 * architecture. Deletable once the funding_rounds=0% question is answered.
 *
 * Fires the exact same 4 funding-related queries researchCompany() (v1)
 * sends to Serper for Apex and Fresha — byte-for-byte the same query
 * strings/anchor logic as scripts/bulk_enrich_all.ts lines ~1402-1430 — and
 * prints the raw organic/answerBox counts. Does NOT import or modify v1 at
 * all, so it can't mask or introduce any behavior change.
 *
 * Purpose: confirm or rule out "Serper returns zero organic/answer results
 * for these specific multi-phrase, site:-restricted queries" as the reason
 * eval/run_eval.ts just measured funding_rounds coverage=0% for both
 * golden-set companies, given that serperSearch() in v1 collapses a genuine
 * HTTP failure and a 200-with-zero-results response into the same silent
 * null (no warning logged either way) — so the earlier run's clean console
 * output (no "Serper HTTP ..." warnings) is consistent with either a key
 * problem or simply zero-result queries, and this is the fastest way to
 * tell them apart.
 *
 * Usage: npx tsx eval/debug_funding_search.ts
 * Needs: SERP_KEY, TAVILY_API_KEY (same .env as bulk_enrich_all.ts)
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

async function serperRaw(query: string): Promise<{ status: number; organic: number; hasAnswer: boolean; body: string }> {
  if (!process.env.SERP_KEY) return { status: -1, organic: 0, hasAnswer: false, body: "NO SERP_KEY SET" };
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 10, autocorrect: false }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: res.status, organic: 0, hasAnswer: false, body: body.slice(0, 300) };
  }
  const data = await res.json() as { organic?: unknown[]; answerBox?: unknown; knowledgeGraph?: { description?: string } };
  return {
    status: res.status,
    organic: data.organic?.length ?? 0,
    hasAnswer: !!(data.answerBox || data.knowledgeGraph?.description),
    body: "",
  };
}

async function tavilyRaw(query: string): Promise<{ ok: boolean; results: number; body: string }> {
  if (!process.env.TAVILY_API_KEY) return { ok: false, results: 0, body: "NO TAVILY_API_KEY SET" };
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 10 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, results: 0, body: body.slice(0, 300) };
  }
  const data = await res.json() as { results?: unknown[] };
  return { ok: true, results: data.results?.length ?? 0, body: "" };
}

const companies = [
  { name: "Apex", website: "apexspace.com", country: "United States" },
  { name: "Fresha", website: "fresha.com", country: "United Kingdom" },
];

// Byte-for-byte the same 3 funding-specific query templates as
// bulk_enrich_all.ts (history/amounts/backers) — the ones that actually feed
// funding_rounds[]. Profile/competitors/news queries are deliberately
// excluded since they're not implicated by this specific 0% result.
function fundingQueries(name: string, anchor: string) {
  return {
    history:  `"${name}"${anchor} seed round "Series A" first funding earliest founding investors site:crunchbase.com OR site:techcrunch.com OR site:pitchbook.com`,
    amounts:  `"${name}"${anchor} total funding raised since founding all rounds USD million billion valuation announcement history`,
    backers:  `"${name}"${anchor} lead investor venture capital backed participated investors funded round investment amount check size`,
  };
}

async function main() {
  for (const c of companies) {
    const domain = websiteDomain(c.website);
    const anchor = domain ? ` "${domain}"` : c.country ? ` ${c.country} (startup OR tech company)` : "";
    console.log(`\n=== ${c.name} (anchor: "${anchor.trim()}") ===`);
    const queries = fundingQueries(c.name, anchor);
    for (const [label, q] of Object.entries(queries)) {
      const s = await serperRaw(q);
      console.log(`  [serper:${label}] status=${s.status} organic=${s.organic} answerBox=${s.hasAnswer}${s.body ? ` body="${s.body}"` : ""}`);
      if (s.status !== 200 || (s.organic === 0 && !s.hasAnswer)) {
        const t = await tavilyRaw(q);
        console.log(`  [tavily:${label}]  ok=${t.ok} results=${t.results}${t.body ? ` body="${t.body}"` : ""}`);
      }
      console.log(`    query: ${q}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
