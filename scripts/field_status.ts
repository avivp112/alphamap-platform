#!/usr/bin/env node
/**
 * scripts/field_status.ts — which core field the pilot shows (owner, 2026-11-20). A field is visible only after at least 150 random audited values with accuracy above its tier's bar (Tier 1 98%, Tier 2 95%);
 * nothing else sets it. Reads eval/field_audit.json; writes eval/field_status.json and, with DRY_RUN=false, the table field_status. The old tracker (20 marks, 90%) is gone.
 *   npx tsx scripts/field_status.ts
 *   DRY_RUN=false npx tsx scripts/field_status.ts
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { pilotVisible, type FieldAudit } from "../lib/enrichment/audit.ts";
import { CORE_FIELDS, REQUIRED_ACCURACY, PILOT_MIN_AUDITED, tierOf } from "../lib/enrichment/tiers.ts";

const cum: FieldAudit = existsSync("eval/field_audit.json") ? JSON.parse(readFileSync("eval/field_audit.json", "utf8")) : {};
const out: Record<string, { tier: number; pilot_visible: boolean; audited: number; wrong: number; accuracy: number | null }> = {};
console.log(`field                        tier  audited  wrong  accuracy   needs                    pilot`);
for (const f of CORE_FIELDS) {
  const p = pilotVisible(f, cum), tier = tierOf(f) as 1 | 2;
  out[f] = { tier, pilot_visible: p.visible, audited: p.audited, wrong: p.wrong, accuracy: p.accuracy };
  console.log(`${f.padEnd(28)} ${tier}     ${String(p.audited).padStart(5)}  ${String(p.wrong).padStart(5)}  ${p.accuracy == null ? "   —   " : (p.accuracy * 100).toFixed(1).padStart(6) + "%"}   ≥${PILOT_MIN_AUDITED} and >${REQUIRED_ACCURACY[tier] * 100}%    ${p.visible ? "VISIBLE" : "hidden"}`);
}
writeFileSync("eval/field_status.json", JSON.stringify(out, null, 1) + "\n");
if (process.env.DRY_RUN === "false") {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
  createClient(url, key).from("field_status").upsert(Object.entries(out).map(([field, v]) => ({ field, tier: v.tier, pilot_visible: v.pilot_visible, audited: v.audited, wrong: v.wrong, updated_at: new Date().toISOString() })), { onConflict: "field" }).then(({ error }) => {
    if (error) { console.error(`⛔  field_status: ${error.message}`); process.exit(1); }
    console.log("✓ field_status table updated.");
  });
}
