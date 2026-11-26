#!/usr/bin/env node
/**
 * scripts/registers_check.ts — the registers against companies whose register entry is known (owner, round 10): PASS / FAIL for the company number, the legal name and the jurisdiction,
 * and the incorporation date printed for every company so it can be written into eval/registers_expected.json once someone has read it on the register's own page ("incorporation_date": null
 * is not checked). Israeli companies: add an entry with their company number the same way. Needs COMPANIES_HOUSE_API_KEY for the British ones.
 *
 *   npx tsx scripts/registers_check.ts
 */
import { readFileSync } from "fs";
import { lookupRegisters, nodeRegisterIo } from "../lib/enrichment/registers.ts";
import { chooseRegistryRecord } from "../lib/enrichment/registerRecord.ts";

interface Case { company: string; legal_name_hint?: string; website_country: string; site_text: string; siteCities?: string[]; expect: { company_number: string; legal_name: string; jurisdiction: string; incorporation_date: string | null } }
const cases = JSON.parse(readFileSync("eval/registers_expected.json", "utf8")) as Case[];
let failed = 0;
for (const c of cases) {
  const findings = await lookupRegisters({ name: c.company, legalName: c.legal_name_hint ?? null, siteText: c.site_text, siteCities: c.siteCities ?? [], country: c.website_country }, nodeRegisterIo(), (m) => console.warn(`    ⚠️  ${m}`));
  const rec = chooseRegistryRecord(findings, c.company, c.website_country);
  const checks: Array<[string, boolean]> = [
    ["company_number", rec?.company_number === c.expect.company_number],
    ["legal_name", (rec?.legal_name ?? "").toUpperCase() === c.expect.legal_name.toUpperCase()],
    ["jurisdiction", rec?.incorporation_jurisdiction === c.expect.jurisdiction],
    ...(c.expect.incorporation_date ? [["incorporation_date", rec?.incorporation_date === c.expect.incorporation_date] as [string, boolean]] : []),
  ];
  for (const [k, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${c.company} — ${k}`); if (!ok) failed++; }
  console.log(`      found: ${rec ? `${rec.legal_name} · ${rec.company_number} · incorporated ${rec.incorporation_date ?? "?"} · ${rec.registered_address ?? "no address"}` : "no record"}${c.expect.incorporation_date ? "" : "   (incorporation date not yet verified — check it on the register's page and write it into the expected file)"}`);
}
console.log(failed ? `\nREGISTERS: ${failed} FAIL.` : "\nREGISTERS: all PASS.");
process.exit(failed ? 1 : 0);
