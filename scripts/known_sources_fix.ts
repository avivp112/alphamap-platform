#!/usr/bin/env node
/**
 * scripts/known_sources_fix.ts — corrects the memory of verified sources after a run (owner, round 10): a value found wrong is removed and kept as a refused candidate
 * ("marked wrong by the owner"), so it is not remembered or written again. Each argument is  Company:field:text  — text is part of the value (empty = every value of the field);
 * `list Company` prints what the memory holds for a company.
 *
 *   npx tsx scripts/known_sources_fix.ts "Hydrostor:round:\$25M" "Promethean Particles:leader:Chief Financial" "Posteo:news:8 Best ProtonMail"
 *   npx tsx scripts/known_sources_fix.ts list Hydrostor
 */
import { loadKnown, saveKnown } from "../lib/enrichment/knownSources.ts";
import { loadGaps, saveGaps, purgeWrong } from "../lib/enrichment/knownGaps.ts";

const args = process.argv.slice(2);
const store = loadKnown(), gaps = loadGaps();
const today = new Date().toISOString().slice(0, 10);
if (args[0] === "list") {
  const q = (args[1] ?? "").toLowerCase();
  for (const list of Object.values(store)) for (const e of list) if (e.company.toLowerCase().includes(q)) console.log(`${e.company} | ${e.field} | ${e.value.slice(0, 90)} | ${e.source_url} | ${e.verified_at}${e.status && e.status !== "ok" ? ` | ${e.status}` : ""}`);
  process.exit(0);
}
if (!args.length) { console.error("Company:field:text …   or   list Company"); process.exit(1); }
const rules = args.map((a) => { const [company, field, ...rest] = a.split(":"); return { company: (company ?? "").trim().toLowerCase(), field: (field ?? "").trim(), text: rest.join(":").trim().toLowerCase() }; });
const removed = purgeWrong(store, gaps, (c, f, v) => rules.some((r) => c.toLowerCase().includes(r.company) && f === r.field && (!r.text || v.toLowerCase().includes(r.text))), today);
saveKnown(store); saveGaps(gaps);
console.log(removed.length ? `Removed ${removed.length} value(s) from the memory:\n  ${removed.join("\n  ")}` : "Nothing matched — check the company, field and text (npx tsx scripts/known_sources_fix.ts list <company>).");
