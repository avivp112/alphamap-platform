#!/usr/bin/env node
/**
 * eval/patent_register_review.ts — the golden set's patents, from the EPO
 * register, judged by the owner (2026-10-27).
 *
 * For each golden company it lists EVERY publication the register returns for
 * the company's name as applicant — other applicants with a similar name
 * included — so the owner, not enrichment's own name matching
 * (lib/enrichment/epoPatents.ts companyPatents), decides which are the
 * company's (owner or filer). Rows go to eval/review/patents_review.csv;
 * marks already made are kept. Then: npx tsx eval/import_review.ts
 *
 *   npx tsx eval/patent_register_review.ts           # all golden companies
 *   ONLY=azumo,cyera npx tsx eval/patent_register_review.ts
 *
 * Needs EPO_OPS_KEY and EPO_OPS_SECRET (env or .env). Reads only — writes nothing to the database.
 */

import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { searchEpoPublications, applicantQuery } from "../lib/enrichment/epoPatents.ts";
import { toCsv, parseCsv, mergeRows, patentKey, PATENT_COLUMNS, NO_PUBLICATIONS, type SheetRow } from "./reviewSheet.ts";
import type { GoldenSet } from "./score.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });
if (!process.env.EPO_OPS_KEY || !process.env.EPO_OPS_SECRET) { console.error("EPO_OPS_KEY and EPO_OPS_SECRET are required (developers.epo.org)."); process.exit(1); }

const ONLY = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const golden: GoldenSet = JSON.parse(readFileSync(join(__dir, "golden_set.json"), "utf8"));
const companies = golden.companies.filter((c) => !ONLY.length || ONLY.includes(c.id) || ONLY.includes(c.name.toLowerCase()));

(async () => {
  const rows: SheetRow[] = [];
  for (const c of companies) {
    const found = await searchEpoPublications(applicantQuery(c.name));
    const pubs = found?.publications ?? [];
    console.log(`${c.name}: ${pubs.length} publication(s)${found && !found.complete ? ` of ${found.total} — only the first 400 listed` : ""}`);
    if (pubs.length === 0) rows.push({ company_id: c.id, company: c.name, publication: NO_PUBLICATIONS, title: "", applicants: "", family_id: "", mark: "" });
    for (const p of pubs) {
      rows.push({
        company_id: c.id, company: c.name, publication: p.number, title: p.title ?? "",
        applicants: p.applicants.map((a) => `${a.name}${a.country ? ` [${a.country}]` : ""}`).join("; "), family_id: p.familyId ?? "", mark: "",
      });
    }
    await new Promise((r) => setTimeout(r, 1200));   // OPS free-tier pace
  }
  const sheet = join(__dir, "review", "patents_review.csv");
  mkdirSync(dirname(sheet), { recursive: true });
  const existing = existsSync(sheet) ? parseCsv(readFileSync(sheet, "utf8")) : [];
  const merged = mergeRows(existing, rows, patentKey);
  writeFileSync(sheet, toCsv(PATENT_COLUMNS, merged));
  console.log(`\n📝  ${merged.length - existing.length} new row(s) in eval/review/patents_review.csv — mark each "של החברה" or "לא של החברה"`);
  console.log(`   (a "${NO_PUBLICATIONS}" row: "נכון" if the company really has no patent). Then: npx tsx eval/import_review.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
