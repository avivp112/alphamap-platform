#!/usr/bin/env node
/**
 * fetch_sec_deals.ts — Ingests recent SEC Form D filings into the `deals` table.
 *
 * SEC Form D is a notice that private companies must file within 15 days of
 * closing a private securities offering. It reveals unannounced funding rounds
 * before they appear on Crunchbase / TechCrunch, giving TalonAI exclusive
 * early-signal intelligence on the private market.
 *
 * Data flow:
 *   1. Fetch SEC EDGAR Atom RSS feed (Form D filings, most-recent N)
 *   2. Parse each entry → company name, CIK, accession number, filing date
 *   3. Fetch primary_doc.xml for each filing to extract:
 *        - Offering amount (target_amount) and amount already sold (amount_raised)
 *        - Date of first sale (deal_date)
 *        - Industry group (→ sector)
 *        - State / country
 *        - Type of securities (Equity / Debt → deal_type suffix)
 *   4. Attempt to link to existing startups table via case-insensitive name match
 *   5. Upsert into `deals` table (idempotent — safe to re-run)
 *
 * SEC EDGAR rate-limit policy: ≤ 10 requests/second.
 *   Default DELAY_MS=150 gives ~6 requests/sec — well within the limit.
 *   See: https://www.sec.gov/os/accessing-edgar-data
 *
 * Usage:
 *   npx tsx scripts/fetch_sec_deals.ts                    # dry run (default)
 *   DRY_RUN=false npx tsx scripts/fetch_sec_deals.ts
 *   DRY_RUN=false COUNT=100 npx tsx scripts/fetch_sec_deals.ts
 *   DRY_RUN=false MIN_AMOUNT=500000 npx tsx scripts/fetch_sec_deals.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap .env ────────────────────────────────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Configuration ─────────────────────────────────────────────────────────────
const DRY_RUN    = process.env.DRY_RUN    !== "false";  // safe default
const COUNT      = Math.min(Number(process.env.COUNT ?? 40), 100);
const DELAY_MS   = Number(process.env.DELAY_MS ?? 150);
const MIN_AMOUNT = Number(process.env.MIN_AMOUNT ?? 0); // skip offerings below this USD

// SEC requires a descriptive User-Agent with contact info.
// Set SEC_USER_AGENT in .env, e.g. "MyPlatform/1.0 contact@myplatform.com"
const SEC_USER_AGENT = process.env.SEC_USER_AGENT
  ?? "TalonAI Platform/1.0 data@talonai.com";

const EDGAR_RSS = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&dateb=&owner=include&count=${COUNT}&output=atom`;

// ── Env guard ─────────────────────────────────────────────────────────────────
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ── Supabase client (service role for writes) ─────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── US state codes (used to classify addresses as USA) ────────────────────────
const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
  "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
  "TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU","AS","MP",
]);

// ── EDGAR industry group → platform sector ────────────────────────────────────
const INDUSTRY_TO_SECTOR: Record<string, string> = {
  "Software":                     "SaaS",
  "Technology":                   "AI & ML",
  "Internet":                     "SaaS",
  "Finance Technology":           "Fintech",
  "Banking & Financial Services": "Fintech",
  "Health Care":                  "HealthTech",
  "Computer Hardware":            "DeepTech",
  "Energy":                       "Climate & Energy",
  "Natural Resources":            "Climate & Energy",
  "Business Services":            "Enterprise Software",
  "Consumer Products":            "Consumer & Media",
  "Entertainment":                "Consumer & Media",
  "Media":                        "Consumer & Media",
  "Retailing":                    "E-commerce & Retail",
  "Defense Military Security":    "Cybersecurity",
  "Manufacturing":                "DeepTech",
  "Transportation":               "DeepTech",
  "Investing":                    "Fintech",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface AtomEntry {
  companyName: string;
  cik: string;               // zero-padded 10-digit string
  accessionNumber: string;   // "0001234567-26-000042"
  filingDate: string;        // "2026-06-08"
  linkHref: string;
}

interface FormDData {
  entityName: string | null;
  targetAmount: number | null;   // totalOfferingAmount
  amountRaised: number | null;   // totalAmountSold
  dealDate: string | null;       // dateOfFirstSale → <value>
  industryGroup: string | null;
  country: string | null;
  dealType: string;              // "Form D (Equity)" | "Form D (Debt)" | "Form D"
}

interface DealInsert {
  company_name: string;
  startup_id: string | null;
  deal_date: string;
  amount_raised: number | null;
  target_amount: number | null;
  deal_type: string;
  investors: null;               // Form D doesn't name individual investors
  source_url: string;
  sector: string | null;
  country: string | null;
  valuation: null;
  is_valuation_estimated: false;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function xmlValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : null;
}

function xmlValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
  }
  return out;
}

function parseNum(s: string | null): number | null {
  if (!s || s === "Indefinite" || s === "0") return null;
  const n = parseInt(s.replace(/,/g, ""), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// ── SEC EDGAR fetch helpers ───────────────────────────────────────────────────

const EDGAR_HEADERS = {
  "User-Agent":      SEC_USER_AGENT,
  "Accept-Encoding": "gzip, deflate",
  "Accept":          "application/xml, text/xml, */*",
};

async function edgarFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: EDGAR_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Atom RSS feed parser ──────────────────────────────────────────────────────

function parseAtomFeed(xml: string): AtomEntry[] {
  return xmlValues(xml, "entry").flatMap(entry => {
    // <title>COMPANY NAME (0001234567) (D)</title>
    const title = xmlValue(entry, "title") ?? "";
    const tm    = title.match(/^(.+?)\s+\((\d{1,10})\)\s+\(.*?\)\s*$/);
    const companyName    = tm ? tm[1].trim() : title.trim();
    const cikFromTitle   = tm ? tm[2].padStart(10, "0") : "";

    // <id>urn:tag:security.gov,2008:accession-number=0001234567-26-000042</id>
    const id  = xmlValue(entry, "id") ?? "";
    const am  = id.match(/accession-number=(.+)$/);
    const accessionNumber = am ? am[1].trim() : "";

    // CIK — prefer from accession number (first 10 digits before first dash)
    const cik = accessionNumber
      ? accessionNumber.split("-")[0].padStart(10, "0")
      : cikFromTitle;

    // <updated>2026-06-08T00:00:00-05:00</updated>
    const updated    = xmlValue(entry, "updated") ?? "";
    const filingDate = updated.slice(0, 10);

    // <link href="..."/>
    const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i);
    const linkHref  = linkMatch ? linkMatch[1] : "";

    if (!accessionNumber || !cik || !filingDate) return [];
    return [{ companyName, cik, accessionNumber, filingDate, linkHref }];
  });
}

// ── Form D XML parser ─────────────────────────────────────────────────────────

function parseFormD(xml: string): FormDData {
  // Entity name
  const entityName = xmlValue(xml, "entityName") ?? xmlValue(xml, "issuerName");

  // Offering amounts (inside <offeringSalesAmounts>)
  const salesBlock   = xmlValue(xml, "offeringSalesAmounts");
  const targetAmount = parseNum(salesBlock ? xmlValue(salesBlock, "totalOfferingAmount") : null);
  const amountRaised = parseNum(salesBlock ? xmlValue(salesBlock, "totalAmountSold")     : null);

  // Date of first sale: <dateOfFirstSale><value>2026-06-01</value></dateOfFirstSale>
  const dateBlock = xmlValue(xml, "dateOfFirstSale");
  const dealDate  = dateBlock ? xmlValue(dateBlock, "value") : null;

  // Industry group
  const industryBlock = xmlValue(xml, "industryGroup");
  const industryGroup = industryBlock ? xmlValue(industryBlock, "industryGroupType") : null;

  // Country/state
  const addressBlock   = xmlValue(xml, "issuerAddress");
  const stateCode      = addressBlock ? xmlValue(addressBlock, "stateOrCountry")            : null;
  const countryDesc    = addressBlock ? xmlValue(addressBlock, "stateOrCountryDescription") : null;
  const isUS           = stateCode ? US_STATE_CODES.has(stateCode.toUpperCase()) : false;
  const country        = isUS ? "USA" : (countryDesc?.trim() ?? stateCode ?? null);

  // Securities type → deal_type suffix
  const typesBlock = xmlValue(xml, "typesOfSecuritiesOffered");
  const isEquity   = typesBlock ? xmlValue(typesBlock, "isEquityType") === "true" : false;
  const isDebt     = typesBlock ? xmlValue(typesBlock, "isDebtType")   === "true" : false;
  const dealType   = isEquity ? "Form D (Equity)" : isDebt ? "Form D (Debt)" : "Form D";

  return { entityName, targetAmount, amountRaised, dealDate, industryGroup, country, dealType };
}

// ── Filing URL builders ───────────────────────────────────────────────────────

function primaryDocUrl(accessionNumber: string): string {
  // "0001234567-26-000042" → cik = "1234567", accNoDash = "000123456726000042"
  const cikInt    = parseInt(accessionNumber.split("-")[0], 10).toString();
  const accNoDash = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/primary_doc.xml`;
}

function filingIndexUrl(accessionNumber: string): string {
  const cikInt    = parseInt(accessionNumber.split("-")[0], 10).toString();
  const accNoDash = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${accNoDash}-index.htm`;
}

// ── Startup name → id resolution (single prefetch) ───────────────────────────

async function buildStartupIndex(): Promise<Map<string, string>> {
  const { data } = await supabase.from("startups").select("id, name");
  const map = new Map<string, string>();
  for (const s of data ?? []) map.set(s.name.toLowerCase(), s.id);
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const bar = "═".repeat(64);
  console.log(`╔${bar}╗`);
  console.log(`║  TalonAI — SEC Form D Deal Ingestion${" ".repeat(64 - 38)}║`);
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | COUNT=${String(COUNT).padEnd(4)} | DELAY=${DELAY_MS}ms | MIN_AMT=$${MIN_AMOUNT.toLocaleString()}${" ".repeat(64 - 55)}║`);
  console.log(`╚${bar}╝\n`);

  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to write to Supabase.\n");

  // ── 1. Prefetch startup index for name→id linking ─────────────────────────
  console.log("── Prefetching startup index…");
  const startupIndex = await buildStartupIndex();
  console.log(`   ${startupIndex.size} startups loaded for name matching.\n`);

  // ── 2. Fetch SEC EDGAR Atom RSS ───────────────────────────────────────────
  console.log(`── Fetching EDGAR RSS (${COUNT} Form D filings)…`);
  await sleep(DELAY_MS);
  const rssXml = await edgarFetch(EDGAR_RSS);
  if (!rssXml) {
    console.error("❌  Failed to fetch EDGAR RSS feed. Check network / User-Agent.");
    process.exit(1);
  }

  const entries = parseAtomFeed(rssXml);
  console.log(`   ${entries.length} entries parsed.\n`);
  console.log("─".repeat(64));

  // ── 3. Process each entry ─────────────────────────────────────────────────
  const tally = { inserted: 0, skipped: 0, filtered: 0, error: 0 };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const idx   = `[${i + 1}/${entries.length}]`;

    await sleep(DELAY_MS);

    // Fetch Form D primary XML
    const docUrl = primaryDocUrl(entry.accessionNumber);
    const docXml = await edgarFetch(docUrl);

    let formD: FormDData;
    if (docXml) {
      formD = parseFormD(docXml);
    } else {
      // Fall back to RSS-only data
      formD = {
        entityName:    null,
        targetAmount:  null,
        amountRaised:  null,
        dealDate:      null,
        industryGroup: null,
        country:       null,
        dealType:      "Form D",
      };
    }

    const companyName = formD.entityName ?? entry.companyName;
    const dealDate    = formD.dealDate    ?? entry.filingDate;
    const sector      = formD.industryGroup ? (INDUSTRY_TO_SECTOR[formD.industryGroup] ?? formD.industryGroup) : null;
    const sourceUrl   = filingIndexUrl(entry.accessionNumber);

    // Skip "Pooled Investment Fund" (VCs filing for their own fund raises, not portfolio cos)
    if (formD.industryGroup === "Pooled Investment Fund") {
      console.log(`${idx} SKIP (pooled fund): ${companyName}`);
      tally.filtered++;
      continue;
    }

    // Skip if below minimum offering amount
    const bestAmount = formD.amountRaised ?? formD.targetAmount ?? 0;
    if (MIN_AMOUNT > 0 && bestAmount < MIN_AMOUNT) {
      console.log(`${idx} SKIP (amount $${bestAmount.toLocaleString()} < min $${MIN_AMOUNT.toLocaleString()}): ${companyName}`);
      tally.filtered++;
      continue;
    }

    // Try to link to existing startup
    const startupId = startupIndex.get(companyName.toLowerCase()) ?? null;

    const deal: DealInsert = {
      company_name:          companyName,
      startup_id:            startupId,
      deal_date:             dealDate,
      amount_raised:         formD.amountRaised,
      target_amount:         formD.targetAmount,
      deal_type:             formD.dealType,
      investors:             null,
      source_url:            sourceUrl,
      sector,
      country:               formD.country,
      valuation:             null,
      is_valuation_estimated: false,
    };

    const amtStr = formD.amountRaised
      ? `$${(formD.amountRaised / 1e6).toFixed(1)}M raised`
      : formD.targetAmount
      ? `$${(formD.targetAmount / 1e6).toFixed(1)}M target`
      : "amount undisclosed";

    console.log(`${idx} ${companyName} | ${formD.dealType} | ${amtStr} | ${sector ?? formD.industryGroup ?? "?"} | ${formD.country ?? "?"}`);
    if (startupId) console.log(`     ✅  Linked → startups.id ${startupId}`);

    if (DRY_RUN) {
      console.log(`     [DRY] Would upsert to deals table.`);
      tally.inserted++;
      continue;
    }

    const { error } = await supabase
      .from("deals")
      .upsert(deal, { onConflict: "source_url", ignoreDuplicates: true });

    if (error) {
      console.warn(`     ⚠️  Upsert failed: ${error.message}`);
      tally.error++;
    } else {
      tally.inserted++;
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(64));
  console.log(`  Inserted / updated : ${tally.inserted}`);
  console.log(`  Filtered (skipped) : ${tally.filtered}`);
  console.log(`  Errors             : ${tally.error}`);
  console.log(DRY_RUN ? "\n  Re-run with DRY_RUN=false to apply writes." : "\n  ✅  Done.");
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
