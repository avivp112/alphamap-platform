#!/usr/bin/env node
/**
 * scripts/check_sites.ts — are the companies a dry run could not read really unreadable? (owner, 2026-11-19: 17 sites of batch 8 failed with Jina Reader HTTP 422 and Serper scrape HTTP 400.)
 * For each company of not_enriched.csv with the reason domain_unresolved / fetch_failed / error — and for two CONTROL sites that were read well in the same batch — three requests, with the answer's
 * own words: the page straight from its server (status, where it ends, title), Jina Reader (status, headers about the credit and the rate, the first words of the answer) and Serper scrape.
 * If the controls fail too, it is the services (credit, rate, key); if only the sites fail, it is the sites. Free (a few requests per site), writes nothing.
 *   npx tsx scripts/check_sites.ts                       the companies of not_enriched.csv
 *   SITES=lula.co.za,cerbomed.com npx tsx scripts/check_sites.ts   only these
 */
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

if (existsSync(".env")) config({ path: ".env" });
const title = (html: string) => (html.match(/<title[^>]*>([^<]{1,100})/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string, n = 110) => s.replace(/\s+/g, " ").slice(0, n);
async function plain(url: string) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0 (compatible; site-check)" } });
    const text = (await res.text()).slice(0, 60000);
    return `${res.status} → ${new URL(res.url).hostname.replace(/^www\./, "")} "${title(text)}"`;
  } catch (e) { return `no answer (${(e as Error).message.slice(0, 50)}${(e as { cause?: { code?: string } }).cause?.code ? ` ${(e as { cause?: { code?: string } }).cause!.code}` : ""})`; }
}
async function jina(url: string) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(30000), headers: { ...(process.env.JINA_API_KEY ? { authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}), accept: "text/plain" } });
    const body = await res.text();
    const hdr = ["x-ratelimit-remaining", "x-ratelimit-limit", "retry-after"].map((h) => (res.headers.get(h) ? `${h}=${res.headers.get(h)}` : "")).filter(Boolean).join(" ");
    return `${res.status}${hdr ? ` [${hdr}]` : ""} ${res.ok ? `${body.length} chars` : `"${clip(body)}"`}`;
  } catch (e) { return `no answer (${(e as Error).message.slice(0, 40)})`; }
}
async function serper(url: string) {
  if (!process.env.SERP_KEY) return "no SERP_KEY";
  try {
    const res = await fetch("https://scrape.serper.dev", { method: "POST", signal: AbortSignal.timeout(40000), headers: { "X-API-KEY": process.env.SERP_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ url, includeMarkdown: true }) });
    const body = await res.text();
    return `${res.status} ${res.ok ? `${body.length} chars` : `"${clip(body)}"`}`;
  } catch (e) { return `no answer (${(e as Error).message.slice(0, 40)})`; }
}
(async () => {
  let rows: Array<{ company: string; website: string }> = [];
  if (process.env.SITES) rows = process.env.SITES.split(",").map((w) => ({ company: w.trim(), website: w.trim() }));
  else if (existsSync("not_enriched.csv")) {
    const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
    rows = b.map((r) => ({ company: r[h.indexOf("company")], website: r[h.indexOf("website")] })).filter((_, i) => /domain_unresolved|fetch_failed|error/.test(b[i][h.indexOf("why")]) && b[i][h.indexOf("website")]);
  }
  const controls = [{ company: "(control) example.com", website: "https://example.com" }, { company: "(control) trustlayer.co.uk", website: "https://trustlayer.co.uk" }, { company: "(control) cerbomed.com", website: "https://cerbomed.com" }];
  const all = process.env.SITES ? rows : [...controls, ...rows];
  console.log(`${all.length} site(s) — the controls first: if they fail too it is the services, not the sites\n`);
  for (const r of all) {
    const url = /^https?:/.test(r.website) ? r.website : `https://${r.website}`;
    const [p, j, s] = await Promise.all([plain(url), jina(url), serper(url)]);
    console.log(`${r.company.padEnd(30)} direct: ${p}\n${"".padEnd(30)} jina:   ${j}\n${"".padEnd(30)} serper: ${s}`);
  }
})();
