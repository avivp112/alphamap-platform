#!/usr/bin/env node
/**
 * scripts/seed_hints_from_run.ts — the rounds a run deleted because only a
 * data platform stated them, into data_hints (owner, 2026-10-29), so the next
 * enrichment of each company searches for a primary source
 * (lib/enrichment/hints.ts). Reads the run's field_changes; writes only
 * data_hints (internal: never shown, exported or served by the API).
 *
 *   RUN_ID=<cleanup run_id> npx tsx scripts/seed_hints_from_run.ts                 # report only
 *   RUN_ID=<cleanup run_id> DRY_RUN=false npx tsx scripts/seed_hints_from_run.ts   # write
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { hintsFromDeletedRounds, hintKey } from "../lib/enrichment/hints.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

const DRY_RUN = process.env.DRY_RUN !== "false";
const RUN_ID = process.env.RUN_ID?.trim();
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
if (!RUN_ID) { console.error("RUN_ID=<run_id> is required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  console.log(DRY_RUN ? "DRY_RUN — nothing is written. DRY_RUN=false to write." : "Writing hints.");
  const { data, error } = await db.from("field_changes").select("startup_id, field, old_value, new_value").eq("run_id", RUN_ID).like("field", "funding_rounds.%");
  if (error) throw error;
  const hints = hintsFromDeletedRounds((data ?? []) as Array<{ startup_id: string; field: string; old_value: unknown; new_value: unknown }>);
  const { data: names } = await db.from("startups").select("id, name").in("id", [...new Set(hints.map((h) => h.startup_id))]);
  const nameOf = new Map(((names ?? []) as Array<{ id: string; name: string }>).map((n) => [n.id, n.name]));
  console.log(`Rounds this run deleted that only a data platform stated: ${hints.length}`);
  for (const h of hints) console.log(`• ${nameOf.get(h.startup_id) ?? h.startup_id} — ${h.round_type ?? "?"} ${h.amount_raised ?? ""}${h.lead_investor ? ` (lead: ${h.lead_investor})` : ""} — ${h.source_url}`);
  if (DRY_RUN || hints.length === 0) return;

  const { error: upErr } = await db.from("data_hints").upsert(hints.map((h) => ({
    startup_id: h.startup_id, kind: "funding_round", hint_key: hintKey(h), status: "open", source_url: h.source_url,
    value: { round_type: h.round_type, amount_raised: h.amount_raised, announcement_date: h.announcement_date, lead_investor: h.lead_investor },
  })), { onConflict: "startup_id,kind,hint_key", ignoreDuplicates: true });
  if (upErr) throw upErr;
  const { count } = await db.from("data_hints").select("id", { count: "exact", head: true }).eq("status", "open");
  console.log(`\nDone. Open hints in data_hints now: ${count ?? "?"} — the next enrichment of each company searches for a primary source.`);
})().catch((e) => { console.error(e); process.exit(1); });
