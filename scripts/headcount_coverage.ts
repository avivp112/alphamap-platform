#!/usr/bin/env node
/**
 * scripts/headcount_coverage.ts — how many of OUR companies each headcount-history source can reach, measured
 * before anything is built (owner, 2026-11-07). READ-ONLY: nothing is written to the database or to any file but
 * the report. Steps (each optional, each samples SAMPLE companies, default 25, seed SEED):
 *
 *   always     the companies by country: UK / US / Norway / Denmark / Israel / other (the ceiling of each register)
 *   UK=1       Companies House (COMPANIES_HOUSE_API_KEY): finds the company, reads its latest accounts, counts
 *              those whose iXBRL states AverageNumberEmployeesDuringPeriod
 *   F5500=<csv>  a Form 5500 (and/or 5500-SF) dataset of the DOL, downloaded by hand: matches US companies by name
 *              (+ state), drops payroll/PEO sponsors, counts those with a participant figure
 *   NO=1       Brreg (open): the company's antallAnsatte
 *   WAYBACK=1  archived /about and /careers pages: companies with ≥1 and with ≥2 team-size sentences in different years
 *
 *   SAMPLE=25 SEED=1 UK=1 NO=1 WAYBACK=1 F5500=/tmp/F_5500_2023_latest.csv npx tsx scripts/headcount_coverage.ts
 *
 * Requests are paced (≥1 s apart per host), with a plain client name as User-Agent.
 */
import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { parseIxbrlEmployees, isPayrollProvider, form5500Columns, sizeStatement } from "../lib/enrichment/headcountSources.ts";
import { sameEntityName } from "../lib/enrichment/registers.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const SAMPLE = Number(process.env.SAMPLE ?? 25);
let seed = Number(process.env.SEED ?? 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const sample = <T,>(xs: T[], n: number) => [...xs].sort(() => rnd() - 0.5).slice(0, n);
const UA = "AlphaMapCoverageCheck/1.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map<string, number>();
async function get(u: string, headers: Record<string, string> = {}, asText = true): Promise<{ status: number; body: string }> {
  const host = new URL(u).host;
  const wait = 1100 - (Date.now() - (lastHit.get(host) ?? 0));
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  const r = await fetch(u, { headers: { "User-Agent": UA, ...headers }, redirect: "follow" });
  return { status: r.status, body: asText ? await r.text() : "" };
}

interface Co { id: string; name: string; website: string | null; country: string | null; founding_country: string | null }
const group = (c: Co) => {
  const k = (c.country ?? "").toLowerCase();
  if (/^(united kingdom|uk|england|scotland|wales|great britain)$/.test(k)) return "UK";
  if (/^(united states|usa|us|united states of america)$/.test(k)) return "US";
  if (k === "norway") return "NO";
  if (k === "denmark") return "DK";
  if (k === "israel") return "IL";
  return k ? "other" : "unknown";
};
const hostOf = (w: string | null) => { try { return w ? new URL(w.startsWith("http") ? w : `https://${w}`).hostname.replace(/^www\./, "") : null; } catch { return null; } };
const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "0/0");

async function main() {
  const all: Co[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select("id, name, website, country, founding_country").eq("status", "active").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as Co[]));
    if (!data || data.length < 1000) break;
  }
  const by = new Map<string, Co[]>();
  for (const c of all) by.set(group(c), [...(by.get(group(c)) ?? []), c]);
  console.log(`\nCompanies in the database (active): ${all.length}`);
  for (const g of ["UK", "US", "NO", "DK", "IL", "other", "unknown"]) console.log(`  ${g.padEnd(8)} ${by.get(g)?.length ?? 0}`);
  console.log("  (these are the ceilings: a register can only reach the companies of its own country)\n");

  if (process.env.UK) {
    const ck = process.env.COMPANIES_HOUSE_API_KEY;
    if (!ck) console.log("UK: COMPANIES_HOUSE_API_KEY is not set — skipped.");
    else {
      const auth = { Authorization: `Basic ${Buffer.from(`${ck}:`).toString("base64")}` };
      const pool = sample(by.get("UK") ?? [], SAMPLE);
      let found = 0, withAccounts = 0, withEmployees = 0, points = 0;
      for (const c of pool) {
        try {
          const s = await get(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(c.name)}&items_per_page=5`, auth);
          const item = (JSON.parse(s.body).items ?? []).find((i: { title: string; company_status?: string }) => sameEntityName(i.title, c.name));
          if (!item) continue;
          found++;
          const f = await get(`https://api.company-information.service.gov.uk/company/${item.company_number}/filing-history?category=accounts&items_per_page=3`, auth);
          const doc = (JSON.parse(f.body).items ?? []).map((i: { links?: { document_metadata?: string } }) => i.links?.document_metadata).find(Boolean) as string | undefined;
          if (!doc) continue;
          withAccounts++;
          const d = await get(`${doc}/content`, { ...auth, Accept: "application/xhtml+xml" });
          const readings = d.status === 200 ? parseIxbrlEmployees(d.body) : [];
          if (readings.length) { withEmployees++; points += readings.length; }
        } catch (e) { console.log(`  UK ${c.name}: ${(e as Error).message}`); }
      }
      console.log(`UK (Companies House), sample ${pool.length}: matched ${pct(found, pool.length)} · accounts on file ${pct(withAccounts, pool.length)} · employees stated in the iXBRL ${pct(withEmployees, pool.length)} · ${points} points`);
    }
  }

  if (process.env.F5500) {
    const us = by.get("US") ?? [];
    const names = us.map((c) => c.name);
    const hits = new Map<string, number>();
    let skippedPayroll = 0;
    const rl = createInterface({ input: createReadStream(process.env.F5500) });
    let cols: ReturnType<typeof form5500Columns> = null;
    const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    for await (const line of rl) {
      if (!cols) { cols = form5500Columns(split(line)); if (!cols) { console.log(`F5500: no sponsor / participant column found in: ${line.slice(0, 300)}`); break; } continue; }
      const f = split(line);
      const sponsor = f[cols.sponsor] ?? "";
      const n = Number(f[cols.active]);
      if (!sponsor || !(n > 0)) continue;
      if (isPayrollProvider(sponsor)) { skippedPayroll++; continue; }
      for (const nm of names) if (!hits.has(nm) && sameEntityName(sponsor, nm)) hits.set(nm, n);
    }
    console.log(`US (Form 5500, ${process.env.F5500}): ${pct(hits.size, us.length)} of the US companies have a sponsor of the same name with an active-participants figure (${skippedPayroll} payroll/PEO rows ignored). Name match only — no EIN/state check, so an upper bound.`);
  }

  if (process.env.NO) {
    const pool = sample(by.get("NO") ?? [], SAMPLE);
    let withCount = 0;
    for (const c of pool) {
      try {
        const r = await get(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(c.name)}&size=5`);
        const e = (JSON.parse(r.body)._embedded?.enheter ?? []).find((x: { navn: string; antallAnsatte?: number }) => sameEntityName(x.navn, c.name));
        if (e && e.antallAnsatte != null) withCount++;
      } catch (e) { console.log(`  NO ${c.name}: ${(e as Error).message}`); }
    }
    console.log(`Norway (Brreg), sample ${pool.length}: employee count ${pct(withCount, pool.length)}`);
  }
  if ((by.get("DK")?.length ?? 0) > 0) console.log(`Denmark: ${by.get("DK")?.length} companies — CVR needs registration (cvrapi.dk is rate-limited); not measured here.`);

  if (process.env.WAYBACK) {
    const pool = sample(all.filter((c) => hostOf(c.website)), SAMPLE);
    let one = 0, two = 0;
    for (const c of pool) {
      const host = hostOf(c.website)!;
      const byYear = new Map<string, number>();
      try {
        for (const path of ["about", "careers", "company"]) {
          const cdx = await get(`https://web.archive.org/cdx/search/cdx?url=${host}/${path}&output=json&filter=statuscode:200&collapse=timestamp:4&limit=12`);
          const rows = (JSON.parse(cdx.body) as string[][]).slice(1);
          for (const [, ts, orig] of rows) {
            const year = ts.slice(0, 4);
            if (byYear.has(year)) continue;
            const page = await get(`https://web.archive.org/web/${ts}id_/${orig}`);
            const st = page.status === 200 ? sizeStatement(page.body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")) : null;
            if (st) byYear.set(year, st.value);
          }
          if (byYear.size >= 2) break;
        }
      } catch (e) { console.log(`  Wayback ${host}: ${(e as Error).message}`); }
      if (byYear.size >= 1) one++;
      if (byYear.size >= 2) two++;
    }
    console.log(`Wayback (about / careers / company pages), sample ${pool.length}: ≥1 team-size sentence ${pct(one, pool.length)} · ≥2 in different years ${pct(two, pool.length)}`);
  }
  console.log("\nThe sample figures are a ratio to apply to the ceilings above; they are not a count of the whole database.");
}
main().catch((e) => { console.error(e); process.exit(1); });
