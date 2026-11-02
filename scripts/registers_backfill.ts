#!/usr/bin/env node
/**
 * scripts/registers_backfill.ts — the company registers over the whole
 * database (owner, 2026-11-02, coverage c). READ ONLY: a report, nothing is
 * written. The write comes after the owner approves the report.
 *
 * For each company with a website (not public): reads its site (home, about,
 * contact) and its legal pages (Terms, Privacy, Legal, Imprint) — cached —
 * and matches it against Companies House, the Israeli registrar and SEC
 * Form D with the rules of lib/enrichment/registers.ts: the name (or the
 * legal name the legal pages give) AND a tie — the company number on the
 * site, the registered city among the site's addresses, a known founder
 * among the register's people (UK, US), or the postcode / street (same name).
 *
 *   npx tsx scripts/registers_backfill.ts                 # LIMIT=200 companies, from OFFSET=0
 *   LIMIT=1000 OFFSET=200 npx tsx scripts/registers_backfill.ts
 *
 * Writes registers_report.csv: per match, what is on file and what the
 * register says, and whether it would fill an empty field or contradict one.
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; COMPANIES_HOUSE_API_KEY and
 * SEC_USER_AGENT for those two registers (skipped without them); Jina for the pages.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createSearchProviderState, fetchCompanyWebsitePages, readPageCached } from "../lib/enrichment/searchProviders.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { buildLabeledSources } from "../lib/enrichment/sources.ts";
import { contactPageAddresses } from "../lib/enrichment/headquarters.ts";
import { legalFacts, type LegalFacts } from "../lib/enrichment/companyFacts.ts";
import { lookupRegisters, nodeRegisterIo, type RegisterFinding } from "../lib/enrichment/registers.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const LIMIT = Number(process.env.LIMIT ?? 200);
const OFFSET = Number(process.env.OFFSET ?? 0);
const db = createClient(url, key, { auth: { persistSession: false } });

interface Row {
  id: string; name: string; website: string | null; founded_year: number | null; founding_country: string | null;
  founders: Array<{ name?: string }> | null; offices: Array<{ city?: string }> | null;
}

const LEGAL_PATHS = ["/terms", "/privacy", "/legal", "/imprint", "/terms-of-service", "/privacy-policy"];

(async () => {
  const { data, error } = await db.from("startups")
    .select("id, name, website, founded_year, founding_country, founders, offices")
    .not("website", "is", null).neq("status", "ipo").order("id").range(OFFSET, OFFSET + LIMIT - 1);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const io = nodeRegisterIo();
  console.log(`Registers over ${rows.length} companies (offset ${OFFSET}). Companies House: ${io.env?.COMPANIES_HOUSE_API_KEY ? "on" : "off (no key)"} · SEC: ${io.env?.SEC_USER_AGENT ? "on" : "off (no SEC_USER_AGENT)"} · Israeli registrar: on. Nothing is written.\n`);

  const out: string[][] = [];
  let matched = 0, fills = 0, conflicts = 0;
  for (const [i, row] of rows.entries()) {
    const state = createSearchProviderState();
    state.cache = openSearchCache(row.id);
    try {
      const pages = await fetchCompanyWebsitePages(row.website, state);
      const domain = (row.website ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      const sources = buildLabeledSources(pages.map((p) => ({ url: p.url, content: p.content, provider: p.provider, query_label: "website", ...(p.also_urls ? { also_urls: p.also_urls } : {}) })), domain);
      let legal: LegalFacts = {};
      const root = (row.website!.startsWith("http") ? row.website! : `https://${row.website}`).replace(/\/+$/, "");
      if (pages.length) for (const path of LEGAL_PATHS) {
        const page = await readPageCached(root + path, state);
        if (!page) continue;
        legal = { ...legalFacts(page.text, row.name), ...legal };
        if (legal.legalName && legal.companyNumber && legal.registeredCity) break;
      }
      const siteCities = [
        ...sources.flatMap((s) => contactPageAddresses(s)).map((c) => c.city),
        ...((row.offices ?? []).map((o) => o.city).filter((c): c is string => !!c)),
        ...(legal.registeredCity ? [legal.registeredCity] : []),
      ];
      const findings: RegisterFinding[] = await lookupRegisters({
        name: row.name, legalName: legal.legalName ?? null,
        siteText: [...pages.map((p) => p.content), legal.companyNumber ? `company number ${legal.companyNumber}` : ""].join("\n"),
        siteCities, founders: (row.founders ?? []).map((f) => f.name ?? "").filter(Boolean),
        statedFoundingCountry: row.founding_country,
      }, io, (m) => console.warn(`    ⚠️  ${row.name}: ${m}`));
      const reg = findings[0];
      if (!reg) { if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${rows.length}, ${matched} matched`); continue; }
      matched++;
      // A founding year earlier than the register's incorporation stands (owner, 2026-11-02).
      const year = row.founded_year != null && reg.founded_year != null && row.founded_year < reg.founded_year ? row.founded_year : reg.founded_year;
      const effect = (onFile: unknown, value: unknown) => onFile == null || onFile === "" ? "fill" : String(onFile) === String(value) ? "same" : "differs";
      const ey = effect(row.founded_year, year), ec = effect(row.founding_country, reg.founding_country);
      if (ey === "fill" || ec === "fill") fills++;
      if (ey === "differs" || ec === "differs") conflicts++;
      console.log(`  🏛️  ${row.name}: ${reg.register} ${reg.entity} (${reg.number}) — ${reg.match} → founded ${year ?? "?"} [${ey}], ${reg.founding_country} [${ec}]`);
      out.push([row.id, row.name, row.website ?? "", reg.register, reg.entity, reg.number, reg.match, String(row.founded_year ?? ""), String(year ?? ""), ey, row.founding_country ?? "", reg.founding_country, ec, reg.url, legal.legalName ?? "", ""]);
    } catch (e) {
      console.warn(`    💥  ${row.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      state.cache?.save();
    }
  }
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["company_id", "company", "website", "register", "entity", "number", "why_certain", "founded_on_file", "founded_register", "founded_effect", "country_on_file", "country_register", "country_effect", "register_url", "legal_name_from_site", "mark"];
  writeFileSync("registers_report.csv", "﻿" + [header, ...out].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
  console.log(`\n${matched} of ${rows.length} matched a register for certain · ${fills} would fill an empty field · ${conflicts} differ from what is on file.`);
  console.log(`📝  registers_report.csv — mark "נכון" / "לא נכון". Next batch: LIMIT=${LIMIT} OFFSET=${OFFSET + LIMIT} npx tsx scripts/registers_backfill.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
