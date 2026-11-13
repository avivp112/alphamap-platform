#!/usr/bin/env node
/**
 * scripts/tech_gate_check.ts — the "is this a technology company?" check (techGate.ts, the owner's definition) on named companies, with the reason
 * for each. Reads the homepage as a real run does. Writes nothing; about $0.001 a company.
 *
 *   NAMES="Hydrostor,Grind" npx tsx scripts/tech_gate_check.ts      # companies by name (from the database)
 *   FILE=not_enriched.csv npx tsx scripts/tech_gate_check.ts        # every row of that report whose why is not_technology
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runTechGate, shouldSkipAsNonTech } from "../lib/enrichment/techGate.ts";
import { createSearchProviderState, readPageCached } from "../lib/enrichment/searchProviders.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL ?? "claude-haiku-5-5";

let names = (process.env.NAMES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (process.env.FILE) {
  const lines = readFileSync(process.env.FILE, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean);
  names = lines.map((l) => l.split(",")).filter((c) => c[2] === "not_technology").map((c) => c[0]);
}
if (!names.length) { console.error("NAMES=… or FILE=not_enriched.csv"); process.exit(1); }

const state = createSearchProviderState();
for (const name of names) {
  const { data } = await db.from("startups").select("name, website, description, industry").eq("name", name).limit(1);
  const row = data?.[0];
  if (!row?.website) { console.log(`${name}: not in the database or no website`); continue; }
  const text = ((await readPageCached(row.website, state))?.text ?? "").replace(/\s+/g, " ").trim();
  const { verdict } = await runTechGate(name, text, row.description, row.industry, { client: anthropic, model: MODEL });
  const label = !verdict ? "NO VERDICT" : shouldSkipAsNonTech(verdict) ? "REJECTED (not technology)" : verdict.is_tech_company ? "technology" : `not technology, but only ${verdict.confidence} confidence → goes on to the full check`;
  console.log(`${name.padEnd(26)} ${label}\n    ${verdict?.reason ?? ""}${text ? "" : "  [homepage unreadable]"}`);
}
