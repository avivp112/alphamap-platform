#!/usr/bin/env node
/**
 * scripts/registers_probe.ts — READ ONLY, costs nothing. Checks the three
 * company registers answer from this machine and shows what they hold for
 * the pilot companies, before the dry run relies on them (owner, 2026-11-02):
 *
 *   - Companies House search (needs COMPANIES_HOUSE_API_KEY);
 *   - the Israeli registrar on data.gov.il (no key) — prints its field names;
 *   - SEC EDGAR full-text search for Form D (needs SEC_USER_AGENT);
 *   - and why flyworks.in / mentat.ai could not be read: a direct request.
 *
 *   npx tsx scripts/registers_probe.ts
 *   npx tsx scripts/registers_probe.ts "Guardz" "KETS Quantum Security"
 */
import { IL_REGISTRAR_RESOURCE, legalName } from "../lib/enrichment/registers.ts";

const NAMES = process.argv.slice(2).length ? process.argv.slice(2)
  : ["Flyworks", "Guardz", "Soda", "Mentat", "KETS Quantum Security", "OfBusiness", "Carbon Masters", "Photonic", "Crossmint"];
const UNREAD_SITES = ["https://flyworks.in", "https://mentat.ai"];

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  return { status: r.status, body: await r.text() };
}
const why = (e: unknown) => (e instanceof Error ? `${e.message}${(e as { cause?: { code?: string } }).cause?.code ? ` (${(e as { cause?: { code?: string } }).cause!.code})` : ""}` : String(e));

async function main() {
  const ch = process.env.COMPANIES_HOUSE_API_KEY, ua = process.env.SEC_USER_AGENT;
  console.log(`Companies House key: ${ch ? "set" : "NOT SET — UK register skipped"} · SEC_USER_AGENT: ${ua ? "set" : "NOT SET — Form D skipped"}\n`);
  let ilFieldsShown = false;
  for (const name of NAMES) {
    console.log(`── ${name}`);
    if (ch) try {
      const r = await get(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`, { Authorization: `Basic ${Buffer.from(`${ch}:`).toString("base64")}` });
      const items = r.status === 200 ? (JSON.parse(r.body).items ?? []) as Array<Record<string, any>> : [];
      console.log(`   UK  HTTP ${r.status}: ${items.map((i) => `${i.title} #${i.company_number} ${i.date_of_creation} ${i.company_status} ${i.address?.postal_code ?? ""}`).join(" | ") || "nothing"}`);
    } catch (e) { console.log(`   UK  failed: ${why(e)}`); }
    try {
      const r = await get(`https://data.gov.il/api/3/action/datastore_search?resource_id=${IL_REGISTRAR_RESOURCE}&q=${encodeURIComponent(legalName(name))}&limit=5`);
      const recs = r.status === 200 ? (JSON.parse(r.body).result?.records ?? []) as Array<Record<string, unknown>> : [];
      if (!ilFieldsShown && recs[0]) { console.log(`   IL  fields: ${Object.keys(recs[0]).join(" · ")}`); ilFieldsShown = true; }
      console.log(`   IL  HTTP ${r.status}: ${recs.map((x) => Object.entries(x).filter(([k]) => /אנגלית|מספר חברה|התאגדות|עיר|סטטוס/.test(k)).map(([, v]) => v).join(" ")).join(" | ") || (r.status === 200 ? "nothing" : r.body.slice(0, 160))}`);
    } catch (e) { console.log(`   IL  failed: ${why(e)}`); }
    if (ua) try {
      const r = await get(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${legalName(name)}"`)}&forms=D`, { "User-Agent": ua });
      const hits = r.status === 200 ? (JSON.parse(r.body).hits?.hits ?? []) as Array<{ _source?: { display_names?: string[]; biz_locations?: string[]; file_date?: string } }> : [];
      console.log(`   US  HTTP ${r.status}: ${hits.slice(0, 3).map((h) => `${h._source?.display_names?.[0]} ${h._source?.biz_locations?.[0] ?? ""} ${h._source?.file_date ?? ""}`).join(" | ") || "nothing"}`);
    } catch (e) { console.log(`   US  failed: ${why(e)}`); }
  }
  console.log("\n── Sites that could not be read");
  for (const site of UNREAD_SITES) {
    try { const r = await get(site, { "User-Agent": "Mozilla/5.0" }); console.log(`   ${site}: HTTP ${r.status}, ${r.body.length} chars — "${r.body.replace(/\s+/g, " ").slice(0, 120)}"`); }
    catch (e) { console.log(`   ${site}: ${why(e)}`); }
  }
}

main();
