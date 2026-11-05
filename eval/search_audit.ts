#!/usr/bin/env node
/**
 *   EVAL_LABEL=full56 npx tsx eval/search_audit.ts       # reads eval/v2_results_full56.json
 * Where the searches (and their cost) went, per query label. Reads a file; nothing is searched or paid.
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { auditSearches, auditText } from "./searchAudit.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const label = (process.env.EVAL_LABEL ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const file = join(__dir, `v2_results${label ? `_${label}` : ""}.json`);
if (!existsSync(file)) { console.error(`${file} not found`); process.exit(1); }
const run = JSON.parse(readFileSync(file, "utf8"));
const golden = JSON.parse(readFileSync(join(__dir, "golden_set.json"), "utf8")).companies as Array<{ id: string; name: string }>;
console.log(auditText(auditSearches(run.per_company, Object.fromEntries(golden.map((g) => [g.id, g.name])), Number(process.env.SEARCH_COST_USD ?? 0.001))));
