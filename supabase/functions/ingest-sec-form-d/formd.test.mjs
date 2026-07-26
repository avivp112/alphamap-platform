// =============================================================================
// Offline tests for the Form D parser and filters.
//
// Run:  node supabase/functions/ingest-sec-form-d/formd.test.mjs
//
// The sandbox this was written in cannot reach sec.gov, so these fixtures are
// hand-built to SEC's documented primary_doc.xml schema rather than captured
// from a live response. That distinction matters: they prove the extractor is
// self-consistent and handles the shapes the schema permits, NOT that SEC
// serves exactly this. The first live run is still the real test.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "formd-"));
const bundle = join(dir, "formd.mjs");
const stripped = join(dir, "index.ts");
const src = new URL("./index.ts", import.meta.url).pathname;

const source = readFileSync(src, "utf8");
const withoutRemoteImport = source.replace(/^import\s+.*?from\s+"https:\/\/[^"]+";\s*$/m, "");
if (withoutRemoteImport === source) {
  console.error("expected a remote import to strip — has index.ts changed shape?");
  process.exit(1);
}
writeFileSync(stripped, withoutRemoteImport);
execFileSync("npx", [
  "--yes", "esbuild@0.21.5", stripped, "--bundle", "--format=esm",
  `--outfile=${bundle}`, "--log-level=warning",
], { stdio: "inherit" });

globalThis.Deno = { serve() {}, env: { get: () => undefined } };
const M = await import(bundle);

let failed = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${label}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const operatingCo = `<?xml version="1.0"?>
<edgarSubmission>
  <schemaVersion>X0708</schemaVersion>
  <submissionType>D</submissionType>
  <testOrLive>LIVE</testOrLive>
  <primaryIssuer>
    <cik>0001999888</cik>
    <entityName>ACME ROBOTICS &amp; AI, INC.</entityName>
    <jurisdictionOfInc>DELAWARE</jurisdictionOfInc>
    <entityType>Corporation</entityType>
    <yearOfInc>
      <withinFiveYears>true</withinFiveYears>
      <value>2025</value>
    </yearOfInc>
  </primaryIssuer>
  <relatedPersonsList>
    <relatedPersonInfo>
      <relatedPersonName><firstName>Dana</firstName><middleName>R</middleName><lastName>Okonkwo</lastName></relatedPersonName>
      <relatedPersonRelationshipList>
        <relationship>Executive Officer</relationship>
        <relationship>Director</relationship>
      </relatedPersonRelationshipList>
    </relatedPersonInfo>
    <relatedPersonInfo>
      <relatedPersonName><firstName>Sam</firstName><middleName></middleName><lastName>Iyer</lastName></relatedPersonName>
      <relatedPersonRelationshipList>
        <relationship>Promoter</relationship>
      </relatedPersonRelationshipList>
    </relatedPersonInfo>
  </relatedPersonsList>
  <offeringData>
    <industryGroup><industryGroupType>Computers</industryGroupType></industryGroup>
    <typeOfFiling><newOrAmendment><isAmendment>false</isAmendment></newOrAmendment><dateOfFirstSale>2026-06-30</dateOfFirstSale></typeOfFiling>
    <offeringSalesAmounts>
      <totalOfferingAmount>5000000</totalOfferingAmount>
      <totalAmountSold>3250000</totalAmountSold>
    </offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;

// A venture fund — the majority of any given day's Form D filings.
const ventureFund = `<?xml version="1.0"?>
<edgarSubmission>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0001222333</cik>
    <entityName>NORTHSTAR VENTURES IV, L.P.</entityName>
    <jurisdictionOfInc>DELAWARE</jurisdictionOfInc>
    <yearOfInc><withinFiveYears>true</withinFiveYears><value>2025</value></yearOfInc>
  </primaryIssuer>
  <offeringData>
    <industryGroup>
      <industryGroupType>Pooled Investment Fund</industryGroupType>
      <investmentFundInfo>
        <investmentFundType>Venture Capital Fund</investmentFundType>
        <is40Act>false</is40Act>
      </investmentFundInfo>
    </industryGroup>
    <offeringSalesAmounts><totalOfferingAmount>250000000</totalOfferingAmount><totalAmountSold>180000000</totalAmountSold></offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;

// A fund that did NOT declare the pooled industry group — caught only by the
// presence of investmentFundInfo. This is why there are two independent tells.
const sneakyFund = `<?xml version="1.0"?>
<edgarSubmission>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0001444555</cik><entityName>MERIDIAN TECH OPPORTUNITIES FUND II LP</entityName>
    <yearOfInc><withinFiveYears>true</withinFiveYears><value>2026</value></yearOfInc>
  </primaryIssuer>
  <offeringData>
    <industryGroup>
      <industryGroupType>Other Technology</industryGroupType>
      <investmentFundInfo><investmentFundType>Private Equity Fund</investmentFundType></investmentFundInfo>
    </industryGroup>
  </offeringData>
</edgarSubmission>`;

const oldCompany = `<?xml version="1.0"?>
<edgarSubmission>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0000777888</cik><entityName>LEGACY SYSTEMS CORPORATION</entityName>
    <yearOfInc><overFiveYears>true</overFiveYears></yearOfInc>
  </primaryIssuer>
  <offeringData><industryGroup><industryGroupType>Computers</industryGroupType></industryGroup></offeringData>
</edgarSubmission>`;

const notYetFormed = `<?xml version="1.0"?>
<edgarSubmission>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0002000111</cik><entityName>Newco Labs</entityName>
    <yearOfInc><yetToBeFormed>true</yetToBeFormed></yearOfInc>
  </primaryIssuer>
  <offeringData><industryGroup><industryGroupType>Other Technology</industryGroupType></industryGroup></offeringData>
</edgarSubmission>`;

const restaurant = `<?xml version="1.0"?>
<edgarSubmission>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0000333444</cik><entityName>BLUE PLATE HOSPITALITY LLC</entityName>
    <yearOfInc><withinFiveYears>true</withinFiveYears><value>2025</value></yearOfInc>
  </primaryIssuer>
  <offeringData><industryGroup><industryGroupType>Restaurants</industryGroupType></industryGroup></offeringData>
</edgarSubmission>`;

// ── Parsing ─────────────────────────────────────────────────────────────────

console.log("── parseFormD: operating company ──");
const a = M.parseFormD(operatingCo);
check("entityName decodes &amp;", a.entityName, "ACME ROBOTICS & AI, INC.");
check("cik", a.cik, "0001999888");
check("jurisdiction", a.jurisdiction, "DELAWARE");
check("yearOfInc scoped to its own block", a.yearOfInc, 2025);
check("withinFiveYears", a.withinFiveYears, true);
check("industryGroup", a.industryGroup, "Computers");
check("not a fund", a.isFund, false);
check("officers", a.officers, [
  { name: "Dana R Okonkwo", relationships: ["Executive Officer", "Director"] },
  { name: "Sam Iyer", relationships: ["Promoter"] },
]);
check("totalOffering", a.totalOffering, 5000000);
check("totalSold", a.totalSold, 3250000);
check("dateOfFirstSale", a.dateOfFirstSale, "2026-06-30");

console.log("\n── parseFormD: edge shapes ──");
check("no issuer name -> null", M.parseFormD("<edgarSubmission></edgarSubmission>"), null);
check("empty string -> null", M.parseFormD(""), null);
check("empty middleName does not add a double space",
  M.parseFormD(operatingCo).officers[1].name, "Sam Iyer");
check("comma-formatted amount", M.tagText("<a>x</a>", "a"), "x");
check("numbers tolerate $ and commas",
  M.parseFormD(operatingCo.replace("<totalOfferingAmount>5000000<", "<totalOfferingAmount>$5,000,000<")).totalOffering,
  5000000);
check("CDATA is unwrapped",
  M.tagText("<entityName><![CDATA[Quantum & Co]]></entityName>", "entityName"), "Quantum & Co");
check("&amp;lt; decodes once, not twice", M.decodeEntities("&amp;lt;"), "&lt;");
check("numeric entity", M.decodeEntities("Caf&#233;"), "Café");

// ── Eligibility ─────────────────────────────────────────────────────────────

console.log("\n── classifyFiling ──");
const verdict = (xml) => M.classifyFiling(M.parseFormD(xml));
check("tech operating company is eligible", verdict(operatingCo), { eligible: true });
check("declared venture fund rejected", verdict(ventureFund), { eligible: false, reason: "fund" });
check("fund hiding under a tech industry group rejected", verdict(sneakyFund), { eligible: false, reason: "fund" });
check("company over five years old rejected", verdict(oldCompany), { eligible: false, reason: "too_old" });
check("entity not yet formed is eligible — earlier than early", verdict(notYetFormed), { eligible: true });
check("restaurant rejected as non-tech", verdict(restaurant), { eligible: false, reason: "not_tech" });
check("unparseable rejected", M.classifyFiling(null), { eligible: false, reason: "no_name" });

// ── Daily index ─────────────────────────────────────────────────────────────

console.log("\n── parseDailyIndex ──");
const idx = [
  "Description:           Daily Index of EDGAR Dissemination Feed by Form Type",
  "Last Data Received:    July 24, 2026",
  "",
  "Form Type   Company Name                                CIK         Date Filed  File Name",
  "---------------------------------------------------------------------------------------",
  "8-K         BIG PUBLIC CO                               0000012345  20260724    edgar/data/12345/0000012345-26-000001.txt",
  "D           ACME ROBOTICS & AI, INC.                    1999888     20260724    edgar/data/1999888/0001999888-26-000123.txt",
  "D/A         NORTHSTAR VENTURES IV, L.P.                 1222333     20260724    edgar/data/1222333/0001222333-26-000045.txt",
  "DEF 14A     SOME OTHER CO                               0000099999  20260724    edgar/data/99999/0000099999-26-000009.txt",
  "D           NEWCO LABS                                  2000111     20260724    edgar/data/2000111/0002000111-26-000002.txt",
].join("\n");
const parsedIdx = M.parseDailyIndex(idx);
check("keeps only D and D/A", parsedIdx.map((r) => r.formType), ["D", "D/A", "D"]);
check("DEF 14A is not matched as a D form", parsedIdx.some((r) => r.companyName.includes("SOME OTHER")), false);
check("company name with internal spaces survives", parsedIdx[0].companyName, "ACME ROBOTICS & AI, INC.");
check("accession extracted from path", parsedIdx[0].accession, "0001999888-26-000123");
check("header lines ignored", parsedIdx.length, 3);

console.log("\n── URLs ──");
check("quarter boundaries", [1, 3, 4, 6, 7, 9, 10, 12].map(M.quarterOf), [1, 1, 2, 2, 3, 3, 4, 4]);
check("daily index url", M.dailyIndexUrl(new Date("2026-07-24T00:00:00Z")),
  "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/form.20260724.idx");
check("primary doc url strips CIK padding and accession dashes",
  M.primaryDocUrl("0001999888", "0001999888-26-000123"),
  "https://www.sec.gov/Archives/edgar/data/1999888/000199988826000123/primary_doc.xml");
check("isoDate", M.isoDate("20260724"), "2026-07-24");

console.log("\n── techSummary ──");
check("summary is composed from real fields, nothing invented",
  M.techSummary(M.parseFormD(operatingCo)),
  "SEC industry: Computers; incorporated 2025; in DELAWARE; offering 5,000,000, 3,250,000 sold; 2 related people");
check("not-yet-formed says so instead of a year",
  M.techSummary(M.parseFormD(notYetFormed)),
  "SEC industry: Other Technology; entity not yet formed at filing");

rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
