/**
 * scripts/sector_check.ts — the sector classification on the examples the reviews marked wrong (eval/sector_examples.json).
 * Calls the real classification (classifySector.ts) once per example (a few cents) and prints pass / fail per company.
 *   npx tsx scripts/sector_check.ts
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for the taxonomy) and ANTHROPIC_API_KEY. Writes nothing.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { loadSectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { buildSectorRequest, parseSectorChoice, classifyWithRetry } from "../lib/enrichment/classifySector.ts";
import { requestFor } from "../lib/enrichment/models.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }
const model = process.env.ENRICH_MODEL ?? "claude-haiku-5-5";
const taxonomy = await loadSectorTaxonomy(createClient(url, key));
const anthropic = new Anthropic();
const examples = JSON.parse(readFileSync("eval/sector_examples.json", "utf8")) as Array<{ company: string; description: string; expect: string; was?: string; note?: string; noCustomers?: boolean }>;
const missing = examples.map((e) => e.expect.split(" › ")[1]).filter((n) => !taxonomy.subNames.includes(n));
if (missing.length) console.log(`⚠️  not in the database yet (run the sector migrations): ${[...new Set(missing)].join(", ")}\n`);
let pass = 0;
for (const e of examples) {
  const c = await classifyWithRetry(async (feedback) => {
    const msg = await anthropic.messages.create(requestFor(buildSectorRequest(e.company, e.description, taxonomy, feedback, { noCustomers: e.noCustomers }), model) as never) as Anthropic.Message;
    const tool = msg.content.find((b) => b.type === "tool_use");
    return tool && tool.type === "tool_use" ? parseSectorChoice(tool.input, taxonomy) : null;
  }, e.description);
  const got = c ? `${c.sector_name}${c.sub_sector_name ? ` › ${c.sub_sector_name}` : ""}` : "(none)";
  const ok = got === e.expect; if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${e.company}: ${got}${ok ? "" : `   expected ${e.expect}${e.was ? ` (was ${e.was})` : ""}`}${c?.sub_sector_names.length ? `   + ${c.sub_sector_names.join(", ")}` : ""}`);
}
console.log(`\n${pass}/${examples.length} as expected.`);
