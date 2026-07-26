// =============================================================================
// Regression tests for the extract-job-signals taxonomy.
//
// Run:  node supabase/functions/extract-job-signals/taxonomy.test.mjs
//
// extractSignals is pure, so it can be tested without a database, a network or
// Deno. Two things are in the way and both are handled below: the module
// imports supabase-js from an https: URL, which Node's ESM loader rejects
// outright, and it calls Deno.serve at import time. So we strip the remote
// import (nothing at module scope needs it — createClient is only ever called
// inside the handler) and stub Deno. esbuild then just removes the types.
//
// EVERY title marked "real" below was observed in production data. They are
// here because the taxonomy got them wrong once, and the cost of that was not
// a bad metric — it was OpenAI and Harvey climbing above companies with a
// fortieth of their headcount.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "taxonomy-"));
const bundle = join(dir, "taxonomy.mjs");
const stripped = join(dir, "index.ts");
const src = new URL("./index.ts", import.meta.url).pathname;

// Drop the https: import; leave every other line byte-identical so what we
// test is the real taxonomy and not a copy that can drift from it.
const source = readFileSync(src, "utf8");
const withoutRemoteImport = source.replace(/^import\s+.*?from\s+"https:\/\/[^"]+";\s*$/m, "");
if (withoutRemoteImport === source) {
  console.error("expected a remote import to strip — has index.ts changed shape?");
  process.exit(1);
}
writeFileSync(stripped, withoutRemoteImport);

execFileSync("npx", [
  "--yes", "esbuild@0.21.5", stripped,
  "--bundle", "--format=esm",
  `--outfile=${bundle}`, "--log-level=warning",
], { stdio: "inherit" });

globalThis.Deno = { serve() {}, env: { get: () => undefined } };
const { extractSignals } = await import(bundle);

let failed = 0;
const has = (title, type, value) =>
  extractSignals(title).some((s) => s.signal_type === type && s.signal_value === value);

function expect(title, type, value, want) {
  const got = has(title, type, value);
  const ok = got === want;
  if (!ok) failed++;
  const verb = want ? "emits" : "does NOT emit";
  console.log(`${ok ? "PASS" : "FAIL"}  ${verb} ${type}/${value}  <- ${JSON.stringify(title)}`);
}

console.log("── Vercel: 'Greenfield' is a sales TERRITORY, not engineering (real) ──");
for (const t of [
  "Account Executive- Startups, Greenfield",
  "Account Executive-Startups, Greenfield (EMEA)",
  "Commercial Account Executive, Greenfield",
]) {
  expect(t, "keyword", "Greenfield", false);
  expect(t, "keyword", "Sales Org", true); // the scaled-org reading must survive
}

console.log("\n── OpenAI: 'Stealth' is anti-counterfeiting tech, not stealth mode (real) ──");
for (const t of [
  "Secure Manufacturing & Stealth Investigator",
  "Secure Manufacturing & Stealth Partner, Marketing",
]) {
  expect(t, "keyword", "Stealth", false);
}

console.log("\n── ...but the genuine early-stage senses still land ──");
expect("Founding Engineer, Stealth Mode", "keyword", "Stealth", true);
expect("Backend Engineer (in stealth)", "keyword", "Stealth", true);
expect("Product Designer, Stealth Startup", "keyword", "Stealth", true);
expect("Senior Engineer — Greenfield Platform Build", "keyword", "Greenfield", true);
expect("Founding Engineer", "seniority", "Founding", true);
expect("Zero to One Product Manager", "keyword", "Zero to One", true);

console.log("\n── Suppression is scoped: it must not eat unrelated keywords ──");
expect("Account Executive, Remote", "keyword", "Remote", true);
expect("Account Executive - Greenfield, Remote", "keyword", "Remote", true);

console.log("\n── 'Founding Account Executive' keeps its seniority signal ──");
// A scaled-org KEYWORD is present, but seniority is deliberately not suppressed:
// the first commercial hire at a startup really is titled this.
expect("Founding Account Executive", "seniority", "Founding", true);
expect("Founding Account Executive", "keyword", "Sales Org", true);

console.log("\n── 'First X' must mean headcount, not ordinal rank ──");
expect("First Line Manager", "seniority", "First Hire", false);
expect("First Level Support Rep", "seniority", "First Hire", false);
expect("First Party Data Engineer", "seniority", "First Hire", false);
expect("First Sales Hire", "seniority", "First Hire", true);
expect("First Engineer", "seniority", "First Hire", true);
expect("First Product Manager", "seniority", "First Hire", true);

console.log("\n── Previously-established behaviour must not regress ──");
expect("Founding Senior Engineer", "seniority", "Founding", true);
expect("Founding Senior Engineer", "seniority", "Senior", false); // one seniority only
expect("Lead Generation Specialist", "seniority", "Lead", false);
expect("Senior JavaScript Engineer", "tech_stack", "Java", false);
expect("Enterprise Account Executive - Central", "keyword", "Territory Org", true);
expect("Enterprise Solutions Engineer, East", "keyword", "Enterprise GTM", true);

rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
