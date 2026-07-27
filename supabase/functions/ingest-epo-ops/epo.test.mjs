// =============================================================================
// Offline tests for the EPO OPS adapter.
//
// Run:  node supabase/functions/ingest-epo-ops/epo.test.mjs
//
// OPS was not reachable from the sandbox this was written in, so the fixtures
// follow OPS's documented exchange-document shape rather than a captured live
// response. They prove the mapping handles that shape — including the
// single-element collapse that is the classic OPS trap — not that the shape is
// right. Run the function with { rawSample: true } before trusting it.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "epo-"));
const src = new URL("./index.ts", import.meta.url).pathname;
const stripped = join(dir, "index.ts");
const bundle = join(dir, "epo.mjs");
const source = readFileSync(src, "utf8");
const out = source.replace(/^import\s+.*?from\s+"https:\/\/[^"]+";\s*$/m, "");
if (out === source) { console.error("no remote import to strip"); process.exit(1); }
writeFileSync(stripped, out);
execFileSync("npx", ["--yes", "esbuild@0.21.5", stripped, "--bundle", "--format=esm",
  `--outfile=${bundle}`, "--log-level=warning"], { stdio: "inherit" });

globalThis.Deno = { serve() {}, env: { get: () => undefined } };
const M = await import(bundle);

let failed = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${label}`);
}

// ── The OPS single-element collapse ─────────────────────────────────────────

console.log("── asArray: OPS collapses single-element lists to objects ──");
check("array passes through", M.asArray([1, 2]), [1, 2]);
check("bare object becomes a one-element array", M.asArray({ a: 1 }), [{ a: 1 }]);
check("null -> empty", M.asArray(null), []);
check("undefined -> empty", M.asArray(undefined), []);

console.log("\n── text: OPS wraps text nodes as {$: value} ──");
check("wrapped", M.text({ $: "US" }), "US");
check("bare string", M.text("US"), "US");
check("whitespace trimmed", M.text({ $: "  US  " }), "US");
check("empty becomes null", M.text({ $: "   " }), null);
check("missing -> null", M.text(undefined), null);
check("numeric value coerced", M.text({ $: 42 }), "42");

console.log("\n── cpcSymbol: reassembled from exploded parts ──");
check("full symbol", M.cpcSymbol({
  section: { $: "G" }, class: { $: "06" }, subclass: { $: "N" },
  "main-group": { $: "3" }, subgroup: { $: "08" },
}), "G06N3/08");
check("no subgroup", M.cpcSymbol({
  section: { $: "B" }, class: { $: "25" }, subclass: { $: "J" }, "main-group": { $: "9" },
}), "B25J9");
check("subclass only", M.cpcSymbol({ section: { $: "H" }, class: { $: "01" }, subclass: { $: "L" } }), "H01L");
check("no section -> null, never a partial symbol", M.cpcSymbol({ class: { $: "06" } }), null);

// ── Full document ───────────────────────────────────────────────────────────

const corporate = {
  "@country": "US", "@doc-number": "2026012345", "@kind": "A1", "@family-id": "88123456",
  "bibliographic-data": {
    "publication-reference": {
      "document-id": [
        { "@document-id-type": "docdb", country: { $: "US" }, "doc-number": { $: "2026012345" }, kind: { $: "A1" }, date: { $: "20260716" } },
        { "@document-id-type": "epodoc", "doc-number": { $: "US2026012345" } },
      ],
    },
    "application-reference": {
      "document-id": { "@document-id-type": "docdb", country: { $: "US" }, "doc-number": { $: "18123456" } },
    },
    "invention-title": [
      { "@lang": "de", $: "Spärliche Aufmerksamkeitsführung" },
      { "@lang": "en", $: "Sparse attention routing for transformer inference" },
    ],
    parties: {
      applicants: {
        applicant: [
          { "@data-format": "epodoc", "applicant-name": { name: { $: "SYNTHORAI TECH INC" } } },
          { "@data-format": "original", "applicant-name": { name: { $: "Synthorai Technology Inc." } } },
        ],
      },
      inventors: {
        inventor: [
          { "@data-format": "original", "inventor-name": { name: { $: "SATO, Rin" } } },
          { "@data-format": "original", "inventor-name": { name: { $: "BIANCHI, Marco" } } },
        ],
      },
    },
    "patent-classifications": {
      "patent-classification": [
        { section: { $: "G" }, class: { $: "06" }, subclass: { $: "N" }, "main-group": { $: "3" }, subgroup: { $: "08" } },
        { section: { $: "G" }, class: { $: "06" }, subclass: { $: "F" }, "main-group": { $: "40" }, subgroup: { $: "40" } },
      ],
    },
  },
  abstract: { "@lang": "en", p: { $: "A method for reducing inference cost." } },
};

console.log("\n── parseExchangeDocument: corporate applicant ──");
const c = M.parseExchangeDocument(corporate);
check("publication number assembled", c.publicationNumber, "US2026012345A1");
check("date punctuated", c.publicationDate, "2026-07-16");
check("application number", c.applicationNumber, "18123456");
check("family id", c.familyId, "88123456");
check("English title preferred over German", c.title, "Sparse attention routing for transformer inference");
check("ORIGINAL applicant preferred over normalised epodoc", c.applicant, "Synthorai Technology Inc.");
check("inventors", c.inventors, ["SATO, Rin", "BIANCHI, Marco"]);
check("cpc reassembled", c.cpcCodes, ["G06N3/08", "G06F40/40"]);
check("abstract", c.abstract, "A method for reducing inference cost.");
check("classifies as deep tech", M.isDeepTechCpc(c.cpcCodes), true);

console.log("\n── the collapse trap: ONE inventor, ONE classification, ONE title ──");
// Every list here is a bare object rather than an array. This is the shape that
// breaks naive .map() code in production after passing every multi-party test.
const solo = {
  "@country": "US", "@doc-number": "2026099999", "@kind": "A1",
  "bibliographic-data": {
    "publication-reference": {
      "document-id": { "@document-id-type": "docdb", country: { $: "US" }, "doc-number": { $: "2026099999" }, kind: { $: "A1" }, date: { $: "20260710" } },
    },
    "invention-title": { "@lang": "en", $: "Cryogenic control circuit for qubit arrays" },
    parties: {
      applicants: { applicant: { "@data-format": "original", "applicant-name": { name: { $: "Quantum Edge Labs Ltd" } } } },
      inventors: { inventor: { "@data-format": "original", "inventor-name": { name: { $: "BYRON, Ada" } } } },
    },
    "patent-classifications": {
      "patent-classification": { section: { $: "G" }, class: { $: "06" }, subclass: { $: "N" }, "main-group": { $: "10" }, subgroup: { $: "40" } },
    },
  },
  abstract: { p: { $: "A cryogenic circuit." } },
};
const s = M.parseExchangeDocument(solo);
check("single document-id object handled", s.publicationNumber, "US2026099999A1");
check("single title object handled", s.title, "Cryogenic control circuit for qubit arrays");
check("single applicant object handled", s.applicant, "Quantum Edge Labs Ltd");
check("single inventor object handled", s.inventors, ["BYRON, Ada"]);
check("single classification object handled", s.cpcCodes, ["G06N10/40"]);

console.log("\n── inventor-held: an individual applicant must NOT become a company ──");
const held = M.parseExchangeDocument({
  ...solo,
  "bibliographic-data": {
    ...solo["bibliographic-data"],
    parties: {
      applicants: { applicant: { "@data-format": "original", "applicant-name": { name: { $: "BYRON, Ada" } } } },
      inventors: { inventor: { "@data-format": "original", "inventor-name": { name: { $: "BYRON, Ada" } } } },
    },
  },
});
check("person as applicant is treated as no applicant", held.applicant, null);
check("but the inventor survives for the watchlist", held.inventors, ["BYRON, Ada"]);
check("summary flags it", M.techSummary(held).includes("inventor-held"), true);

console.log("\n── looksLikeOrganisation ──");
for (const [name, want] of [
  ["Synthorai Technology Inc.", true],
  ["Quantum Edge Labs Ltd", true],
  ["Nova GmbH", true],
  ["MASSACHUSETTS INSTITUTE OF TECHNOLOGY", true],
  ["SATO, Rin", false],
  ["BYRON, Ada", false],
  ["Smith, John Paul", false],
]) check(`${JSON.stringify(name)}`, M.looksLikeOrganisation(name), want);

console.log("\n── CQL ──");
check("date range uses `within`, not a bare range",
  M.buildCql({ cpc: ["G06N"], countries: ["US"], from: "2026-07-01", to: "2026-07-26" }),
  'pd within "20260701 20260726" and (cpc=G06N) and (pn=US)');
check("cpc terms are OR-ed into one query",
  M.buildCql({ cpc: ["G06N", "B25J"], countries: [], from: "2026-07-01", to: "2026-07-26" }),
  'pd within "20260701 20260726" and (cpc=G06N or cpc=B25J)');
check("no filters -> date only",
  M.buildCql({ cpc: [], countries: [], from: "2026-07-01", to: "2026-07-26" }),
  'pd within "20260701 20260726"');
check("Range window",
  M.searchUrl("x", 1, 100).endsWith("&Range=1-100"), true);
check("second page", M.searchUrl("x", 101, 100).endsWith("&Range=101-200"), true);

console.log("\n── date + filters ──");
check("opsDate", M.opsDate("20260716"), "2026-07-16");
check("bad date -> null", M.opsDate("2026-07-16"), null);
check("null -> null", M.opsDate(null), null);
check("A01B is not deep tech", M.isDeepTechCpc(["A01B1/02"]), false);
check("unmappable document -> null", M.parseExchangeDocument({ "bibliographic-data": {} }), null);
check("inventors map to the officers shape",
  M.inventorsAsOfficers(s), [{ name: "BYRON, Ada", relationships: ["Inventor"] }]);

// ── Private-market boundary ─────────────────────────────────────────────────

console.log("\n── allowedPublications: the cap scales to the window queried ──");
check("14-day window at 8/30d -> 4", M.allowedPublications("2026-07-12", "2026-07-26", 8), 4);
check("30-day window -> 8", M.allowedPublications("2026-06-26", "2026-07-26", 8), 8);
check("365-day window -> 98", M.allowedPublications("2025-07-26", "2026-07-26", 8), 98);
check("a one-day window floors at 3, not 1 — filing twice on a Tuesday is not scale",
  M.allowedPublications("2026-07-26", "2026-07-26", 8), 3);
check("tighter setting is honoured", M.allowedPublications("2026-06-26", "2026-07-26", 3), 3);

console.log("\n── normalizeApplicant matches the SQL side ──");
check("EPO country tag", M.normalizeApplicant("RO5 INC [US]"), "ro5 inc");
check("punctuation and case", M.normalizeApplicant("SAMSUNG ELECTRONICS CO., LTD."), "samsung electronics co ltd");
check("variants converge, so counts group as one filer",
  M.normalizeApplicant("Samsung Electronics Co Ltd") === M.normalizeApplicant("SAMSUNG ELECTRONICS CO., LTD. [KR]"),
  true);
check("ampersand collapses like the SQL form",
  M.normalizeApplicant("Johnson & Johnson"), "johnson johnson");

console.log("\n── countByApplicant ──");
const batch = [
  { applicant: "Samsung Electronics Co Ltd" },
  { applicant: "SAMSUNG ELECTRONICS CO., LTD." },
  { applicant: "SAMSUNG ELECTRONICS CO LTD [KR]" },
  { applicant: "Ro5 Inc." },
  { applicant: null },              // inventor-held
  { applicant: null },
];
const counts = M.countByApplicant(batch);
check("name variants counted together", counts.get("samsung electronics co ltd"), 3);
check("the startup counted once", counts.get("ro5 inc"), 1);
check("inventor-held rows are never counted — they have no applicant to cap",
  counts.has("") || counts.size, 2);

console.log("\n── the boundary must never eat an inventor-held row ──");
// The filter predicate reproduced: no applicant means no denylist entry and no
// frequency to cap, so it passes by construction. This is the highest-value row
// in the layer and the one a corporate filter would most easily lose.
const denied = new Set(["Samsung Electronics Co Ltd"]);
const overCap = new Set(["samsung electronics co ltd"]);
const survives = (p) => {
  if (!p.applicant) return true;
  if (denied.has(p.applicant)) return false;
  if (overCap.has(M.normalizeApplicant(p.applicant))) return false;
  return true;
};
check("inventor-held survives both filters", survives({ applicant: null }), true);
check("denylisted applicant dropped", survives({ applicant: "Samsung Electronics Co Ltd" }), false);
check("over-cap variant dropped by normalised match",
  survives({ applicant: "SAMSUNG ELECTRONICS CO., LTD. [KR]" }), false);
check("the startup survives", survives({ applicant: "Ro5 Inc." }), true);

rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
