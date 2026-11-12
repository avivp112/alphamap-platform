/**
 * scripts/sector_rejudge.ts — which sector marks the CURRENT classification still produces (owner, 2026-11-10).
 * For each sector mark whose company has a stored description (field_review/run_*.csv, the latest), the description is
 * classified (classifySector.ts, a few cents in all) and compared with the mark. The result is eval/sector_rejudged.csv, which
 * field_review_replay.ts reads: a mark whose sector the classification no longer gives leaves the count. Writes nothing else.
 *   npx tsx scripts/sector_rejudge.ts && npx tsx scripts/field_review_replay.ts && npx tsx scripts/field_review_status.ts
 */
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { loadSectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { buildSectorRequest, parseSectorChoice, classifyWithRetry } from "../lib/enrichment/classifySector.ts";
import { requestFor } from "../lib/enrichment/models.ts";
import { readMarks } from "../lib/enrichment/fieldReview.ts";
import { rejudgeSectorMarks } from "../lib/enrichment/sectorRejudge.ts";
import { latestDescriptions } from "../lib/enrichment/runDescriptions.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }
const model = process.env.ENRICH_MODEL ?? "claude-haiku-5-5";
const taxonomy = await loadSectorTaxonomy(createClient(url, key));
const anthropic = new Anthropic();

const stored = latestDescriptions();
const marks = readMarks().filter((m) => m.field === "sector");
console.log(`${marks.length} sector mark(s); ${new Set(marks.filter((m) => stored.has(m.company)).map((m) => m.company)).size} company(ies) with a stored description.`);
const result = await rejudgeSectorMarks(marks, (c) => stored.get(c)?.value ?? null, async (company, description) => {
  // The classification as the pipeline runs it, second look included.
  const c = await classifyWithRetry(async (feedback) => {
    const msg = await anthropic.messages.create(requestFor(buildSectorRequest(company, description, taxonomy, feedback), model) as never) as Anthropic.Message;
    const tool = msg.content.find((b) => b.type === "tool_use");
    return tool && tool.type === "tool_use" ? parseSectorChoice(tool.input, taxonomy) : null;
  }, description);
  return c ? `${c.sector_name}${c.sub_sector_name ? ` › ${c.sub_sector_name}` : ""}` : null;
});
const today = new Date().toISOString().slice(0, 10);
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync("eval/sector_rejudged.csv", "﻿" + ["id,produced,now,rejudged_at", ...result.map((r) => [r.id, r.produced ? "yes" : "no", r.now, today].map(cell).join(","))].join("\r\n") + "\r\n");
const byId = new Map(marks.map((m) => [m.id, m]));
for (const r of result.filter((x) => !x.produced)) { const m = byId.get(r.id)!; console.log(`  ${r.id.padEnd(8)} ${m.verdict.padEnd(8)} ${m.company}: ${m.value}  ← now ${r.now}`); }
console.log(`\n${result.length} judged: ${result.filter((r) => r.produced).length} still produced, ${result.filter((r) => !r.produced).length} no longer.  📝 eval/sector_rejudged.csv`);
