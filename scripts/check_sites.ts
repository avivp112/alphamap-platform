#!/usr/bin/env node
/**
 * scripts/check_sites.ts — are the companies a dry run could not read really unreadable? (owner, 2026-11-19: 17 sites of batch 8 failed with Jina HTTP 422 / Serper HTTP 400.)
 * For each company of not_enriched.csv with the reason domain_unresolved (or error): a plain request to the address (status, where it ends up, its title), and the same page through the reader (Jina).
 * Free (a few requests per site), writes nothing. It tells a dead site, a site that moved to another business, a site that refuses the reader, and a transient failure apart.
 *   npx tsx scripts/check_sites.ts
 */
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

if (existsSync(".env")) config({ path: ".env" });
const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
const rows = b.map((r) => ({ company: r[h.indexOf("company")], website: r[h.indexOf("website")], why: r[h.indexOf("why")] })).filter((r) => /domain_unresolved|error/.test(r.why) && r.website);
const title = (html: string) => (html.match(/<title[^>]*>([^<]{1,100})/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
async function plain(url: string) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0 (compatible; site-check)" } });
    const text = (await res.text()).slice(0, 60000);
    return `${res.status} → ${new URL(res.url).hostname.replace(/^www\./, "")} "${title(text)}"`;
  } catch (e) { return `no answer (${(e as Error).message.slice(0, 50)})`; }
}
async function jina(url: string) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(30000), headers: { ...(process.env.JINA_API_KEY ? { authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}), accept: "text/plain" } });
    return `${res.status}`;
  } catch (e) { return `no answer (${(e as Error).message.slice(0, 40)})`; }
}
(async () => {
  console.log(`${rows.length} site(s)\n`);
  for (const r of rows) {
    const url = /^https?:/.test(r.website) ? r.website : `https://${r.website}`;
    const [p, j] = await Promise.all([plain(url), jina(url)]);
    console.log(`${r.company.padEnd(26)} plain: ${p}\n${"".padEnd(26)} reader: ${j}`);
  }
})();
