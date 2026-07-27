// =============================================================================
// Offline tests for the UK Companies House and USPTO ingesters.
//
// Run:  node supabase/functions/ingest-uk-companies-house/sources.test.mjs
//
// Neither API was reachable from the sandbox these were written in, so the
// fixtures follow each service's documented response shape rather than a
// captured live response. They prove the mapping and filtering are correct
// against that shape — not that the shape is right. For USPTO in particular,
// run the function with { rawSample: true } before trusting it.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gov-sources-"));
const here = dirname(new URL(import.meta.url).pathname);
const fns = dirname(here);

async function load(name) {
  const src = join(fns, name, "index.ts");
  const stripped = join(dir, `${name}.ts`);
  const bundle = join(dir, `${name}.mjs`);
  const source = readFileSync(src, "utf8");
  const out = source.replace(/^import\s+.*?from\s+"https:\/\/[^"]+";\s*$/m, "");
  if (out === source) { console.error(`no remote import to strip in ${name}`); process.exit(1); }
  writeFileSync(stripped, out);
  execFileSync("npx", ["--yes", "esbuild@0.21.5", stripped, "--bundle", "--format=esm",
    `--outfile=${bundle}`, "--log-level=warning"], { stdio: "inherit" });
  return import(bundle);
}

globalThis.Deno = { serve() {}, env: { get: () => undefined } };
const CH = await load("ingest-uk-companies-house");
const PV = await load("ingest-uspto-patents");

let failed = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${label}`);
}

// ── Companies House ─────────────────────────────────────────────────────────

console.log("── Companies House: SIC filtering ──");
check("software development is tech", CH.isTechSic(["62012"]), true);
check("IT consultancy is tech", CH.isTechSic(["62020"]), true);
check("R&D on engineering is tech", CH.isTechSic(["72190"]), true);
check("any one tech code among several qualifies", CH.isTechSic(["56101", "62012"]), true);
check("restaurant is not", CH.isTechSic(["56101"]), false);
check("management consultancy is not", CH.isTechSic(["70229"]), false);
check("property is not", CH.isTechSic(["68209"]), false);
check("empty is not", CH.isTechSic([]), false);
check("null is not", CH.isTechSic(null), false);
check("whitespace tolerated", CH.isTechSic([" 62012 "]), true);

console.log("\n── Companies House: response mapping ──");
const chItem = {
  company_name: "DEEPMIND ROBOTICS LTD",
  company_number: "14567890",
  date_of_creation: "2026-07-20",
  company_status: "active",
  company_type: "ltd",
  sic_codes: ["62012", "72190"],
  registered_office_address: { locality: "London", postal_code: "EC1A 1BB" },
};
check("maps a search item", CH.mapCompany(chItem), {
  companyNumber: "14567890",
  companyName: "DEEPMIND ROBOTICS LTD",
  dateOfCreation: "2026-07-20",
  companyStatus: "active",
  companyType: "ltd",
  sicCodes: ["62012", "72190"],
  locality: "London",
});
check("no company number -> null", CH.mapCompany({ company_name: "X" }), null);
check("missing sic_codes becomes an empty array", CH.mapCompany({ ...chItem, sic_codes: undefined }).sicCodes, []);
check("numeric sic codes coerced to strings", CH.mapCompany({ ...chItem, sic_codes: [62012] }).sicCodes, ["62012"]);
check("incorporation year", CH.yearOf("2026-07-20"), 2026);
check("null date -> null year", CH.yearOf(null), null);
check("malformed date -> null year", CH.yearOf("20/07/2026"), null);

console.log("\n── Companies House: officers ──");
const officers = {
  items: [
    { name: "BLOGGS, Jo", officer_role: "director", appointed_on: "2026-07-20" },
    { name: "QUICKFORM SECRETARIES LIMITED", officer_role: "corporate-secretary", appointed_on: "2026-07-20" },
    { name: "OLD, Director", officer_role: "director", appointed_on: "2020-01-01", resigned_on: "2024-03-03" },
    { name: "PATEL, Anya", officer_role: "director", appointed_on: "2026-07-20" },
  ],
};
check("formation-agent secretary excluded, resigned excluded",
  CH.mapOfficers(officers).map((o) => o.name), ["BLOGGS, Jo", "PATEL, Anya"]);
check("role kept as a relationship", CH.mapOfficers(officers)[0].relationships, ["director"]);
check("empty payload is fine", CH.mapOfficers({}), []);

console.log("\n── Companies House: URL ──");
check("search url",
  CH.searchUrl("2026-07-24", "2026-07-24", 0, 100),
  "https://api.company-information.service.gov.uk/advanced-search/companies?incorporated_from=2026-07-24&incorporated_to=2026-07-24&size=100&start_index=0");
check("summary is derived, nothing invented",
  CH.techSummary(CH.mapCompany(chItem), 2),
  "UK SIC 62012, 72190; incorporated 2026-07-20; in London; ltd; 2 directors");

// ── USPTO ───────────────────────────────────────────────────────────────────

console.log("\n── USPTO: CPC filtering ──");
check("G06N3/08 is AI (prefix match into the hierarchy)", PV.isDeepTechCpc(["G06N3/08"]), true);
check("G06N20/00 is machine learning", PV.isDeepTechCpc(["G06N20/00"]), true);
check("B25J robotics", PV.isDeepTechCpc(["B25J9/16"]), true);
check("H01L semiconductors", PV.isDeepTechCpc(["H01L29/78"]), true);
check("spaces tolerated", PV.isDeepTechCpc([" g06n 3/08 "]), true);
check("A01B ploughs are not deep tech", PV.isDeepTechCpc(["A01B1/02"]), false);
check("A47J kitchen equipment is not", PV.isDeepTechCpc(["A47J31/00"]), false);
check("one qualifying code among several is enough", PV.isDeepTechCpc(["A01B1/02", "G06N3/08"]), true);
check("empty is not", PV.isDeepTechCpc([]), false);

console.log("\n── USPTO: record mapping (nested shape) ──");
const nested = {
  publication_number: "US20260123456A1",
  application_number: "18/123456",
  patent_title: "Sparse attention routing for transformer inference",
  patent_abstract: "A method for reducing inference cost in transformer models...",
  publication_date: "2026-07-16",
  assignees: [{ assignee_organization: "Synthorai Technology Inc" }],
  inventors: [
    { inventor_name_first: "Rin", inventor_name_last: "Sato" },
    { inventor_name_first: "Marco", inventor_name_last: "Bianchi" },
  ],
  cpc_current: [{ cpc_group_id: "G06N3/08" }, { cpc_group_id: "G06F40/40" }],
};
const m = PV.mapPublication(nested);
check("publication number", m.publicationNumber, "US20260123456A1");
check("assignee organisation", m.assignee, "Synthorai Technology Inc");
check("inventor names assembled", m.inventors, ["Rin Sato", "Marco Bianchi"]);
check("cpc codes", m.cpcCodes, ["G06N3/08", "G06F40/40"]);
check("title", m.title, "Sparse attention routing for transformer inference");

console.log("\n── USPTO: mapping tolerates alternative field spellings ──");
check("flattened assignee key",
  PV.mapPublication({ document_number: "US1", assignee_organization: "Acme Labs" }).assignee, "Acme Labs");
check("flattened cpc array of strings",
  PV.mapPublication({ document_number: "US1", cpc_current: ["G06N3/08"] }).cpcCodes, ["G06N3/08"]);
check("inventor as a single name field",
  PV.mapPublication({ document_number: "US1", inventors: [{ name: "Ada Lovelace" }] }).inventors, ["Ada Lovelace"]);
check("no identifier at all -> null", PV.mapPublication({ patent_title: "x" }), null);

console.log("\n── USPTO: the inventor-held case, which is the valuable one ──");
const held = PV.mapPublication({
  publication_number: "US20260999999A1",
  patent_title: "Cryogenic control circuit for qubit arrays",
  publication_date: "2026-07-10",
  inventors: [{ inventor_name_first: "Ada", inventor_name_last: "Byron" }],
  cpc_current: [{ cpc_group_id: "G06N10/40" }],
});
check("no organisation assignee", held.assignee, null);
check("but the inventors survive", held.inventors, ["Ada Byron"]);
check("and it still classifies as deep tech", PV.isDeepTechCpc(held.cpcCodes), true);
check("inventors map to the officers shape",
  PV.inventorsAsOfficers(held), [{ name: "Ada Byron", relationships: ["Inventor"] }]);
check("summary flags it for the founder watchlist",
  PV.techSummary(held), "CPC G06N10/40; published 2026-07-10; no organisation assignee — inventor-held; 1 inventor");

console.log("\n── USPTO: query URL ──");
const url = new URL(PV.buildQueryUrl("2026-07-01", "2026-07-24", 0, 100));
check("endpoint", url.origin + url.pathname, "https://search.patentsview.org/api/v1/publication/");
check("date window is server-side", JSON.parse(url.searchParams.get("q")),
  { _and: [{ _gte: { publication_date: "2026-07-01" } }, { _lte: { publication_date: "2026-07-24" } }] });
check("paging", JSON.parse(url.searchParams.get("o")), { size: 100, offset: 0 });

rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
