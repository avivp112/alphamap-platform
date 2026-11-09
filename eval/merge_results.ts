#!/usr/bin/env node
/**
 *   BASE=full56 PATCH=reg4 OUT=full56m npx tsx eval/merge_results.ts
 * eval/v2_results_<PATCH>.json laid over eval/v2_results_<BASE>.json → eval/v2_results_<OUT>.json.
 * Then: RESCORE=true PIPELINE=v2 EVAL_LABEL=<OUT> npx tsx eval/run_eval.ts
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mergeRuns } from "./mergeResults.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const file = (l: string | undefined) => join(dir, `v2_results_${(l ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`);
const { BASE, PATCH, OUT } = process.env;
if (!BASE || !PATCH || !OUT) { console.error("Set BASE, PATCH and OUT (result labels)."); process.exit(1); }
for (const l of [BASE, PATCH]) if (!existsSync(file(l))) { console.error(`${file(l)} not found`); process.exit(1); }
const r = mergeRuns(JSON.parse(readFileSync(file(BASE), "utf8")), JSON.parse(readFileSync(file(PATCH), "utf8")));
writeFileSync(file(OUT), JSON.stringify(r.merged));
console.log(`${r.replaced.length} company(ies) replaced (${r.replaced.join(", ") || "—"}), ${r.added.length} added (${r.added.join(", ") || "—"}) → ${file(OUT)}`);
