#!/usr/bin/env node
/**
 * scripts/retry_failed.ts — the companies of a batch a run could not read or finish (owner, batch 7: eight sites "unreadable" and one company over ten minutes, with ten companies
 * running together), as an ids line for a second, gentler live pass.
 *   npx tsx scripts/retry_failed.ts 7            → prints the ids and the command; RETRY_WHY=domain_unresolved,error (the default) says which outcomes
 * Reads pilot_batch_<N>.json and not_enriched.csv. Writes nothing.
 */
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const n = process.argv[2] ?? process.env.BATCH_NO;
if (!n || !existsSync(`pilot_batch_${n}.json`) || !existsSync("not_enriched.csv")) { console.error("usage: retry_failed.ts <batch number> (needs pilot_batch_<N>.json and not_enriched.csv)"); process.exit(1); }
const why = new Set((process.env.RETRY_WHY ?? "domain_unresolved,error").split(",").map((x) => x.trim()).filter(Boolean));
const batch = JSON.parse(readFileSync(`pilot_batch_${n}.json`, "utf8")) as { companies?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
const list = Array.isArray(batch) ? batch : batch.companies ?? [];
const [head, ...rows] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
const at = (c: string) => head.indexOf(c);
const names = new Map(rows.filter((r) => why.has(r[at("why")])).map((r) => [r[at("company")], r[at("why")]]));
const picked = list.filter((c) => names.has(c.name));
console.error(`${picked.length} company(ies) of batch ${n} with outcome ${[...why].join(" / ")}: ${picked.map((c) => `${c.name} (${names.get(c.name)})`).join(", ")}`);
console.log(picked.map((c) => c.id).join(","));
