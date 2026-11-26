#!/usr/bin/env node
/**
 * scripts/cost_per_company.ts — what a company costs, from the summary a run prints (READS log files only, free; owner, 2026-11-26).
 * For each log: the companies run (the "── name (id) ──" blocks), the Claude cost the run reported, the Serper / Jina / Tavily calls, the pages and articles read, and the cost per company: the model's (reported) plus the searches
 * at the unit prices below. THE UNIT PRICES ARE ASSUMPTIONS (change them with env): Serper $0.001 a search, Serper scrape $0.001, Jina search $0.0005, Tavily $0.016 a call (an "advanced" search is 2 credits at $8 per 1000). Jina Reader pages
 * are counted but not priced (a fraction of a cent). A log of a run that stopped early has no summary: then only the companies are counted.
 *   LOGS="dry9.log,regression/out/acquired_9_live/run.log" npx tsx scripts/cost_per_company.ts
 */
import { existsSync, readFileSync } from "fs";
const P = { serper: Number(process.env.P_SERPER ?? 0.001), scrape: Number(process.env.P_SCRAPE ?? 0.001), jina: Number(process.env.P_JINA ?? 0.0005), tavily: Number(process.env.P_TAVILY ?? 0.016) };
const files = (process.env.LOGS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (!files.length) { console.error('LOGS="a.log,b.log" is required.'); process.exit(2); }
const num = (t: string, re: RegExp) => { const m = t.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
const rows: Array<Record<string, number | string | null>> = [];
for (const f of files) {
  if (!existsSync(f)) { console.log(`${f}: missing`); continue; }
  const t = readFileSync(f, "utf8");
  const companies = new Set([...t.matchAll(/^── (.+?) \(([0-9a-f-]{36})\) ──/gm)].map((m) => m[2])).size;
  const model = num(t, /claude cost\s+\$([\d.]+)/), serper = num(t, /serper calls: (\d+)/), jina = num(t, /jina search \(Serper backup\): (\d+)/), scrape = num(t, /serper scrape \(Jina backup\): (\d+)/), tavily = num(t, /tavily calls: (\d+)/);
  const pages = num(t, /website pages: (\d+) real/), articles = num(t, /full articles read \(Jina\)\s+(\d+)/), deep = num(t, /companies deep-dived\s+(\d+)/), minutes = num(t, /time ([\d.]+) min/);
  const web = (serper ?? 0) * P.serper + (scrape ?? 0) * P.scrape + (jina ?? 0) * P.jina + (tavily ?? 0) * P.tavily;
  const n = Math.max(companies, 1);
  console.log(`\n${f}\n  companies run: ${companies}${model == null ? "  (no summary in this log: the run did not finish, or this is not a run's log)" : ""}`);
  if (model == null) continue;
  console.log(`  model $${model.toFixed(2)} → $${(model / n).toFixed(4)} a company`);
  console.log(`  searches: serper ${serper ?? "?"} · serper scrape ${scrape ?? "?"} · jina search ${jina ?? "?"} · tavily ${tavily ?? "?"}  → about $${web.toFixed(2)} → $${(web / n).toFixed(4)} a company`);
  console.log(`  pages read: ${pages ?? "?"} real (${((pages ?? 0) / n).toFixed(1)} a company) · full articles ${articles ?? "?"} (${((articles ?? 0) / n).toFixed(1)}) · deep dives ${deep ?? "?"}${minutes != null ? ` · ${minutes} min` : ""}`);
  console.log(`  TOTAL about $${((model + web) / n).toFixed(4)} a company (model + searches at the assumed prices)`);
  rows.push({ f, companies, per: (model + web) / n });
}
if (rows.length > 1) { console.log("\n── compared:"); for (const r of rows) console.log(`  $${Number(r.per).toFixed(4)} a company · ${r.companies} compan(ies) · ${r.f}`); }
