#!/usr/bin/env node
/**
 * scripts/model_compare.ts — a model on random companies outside the golden
 * set (owner, 2026-11-02: "we have exhausted the golden set"). Writes nothing
 * to the database.
 *
 *   1. Draws SIZE (10) random companies with a website from AlphaMap — not
 *      public, not in the golden set, not in an earlier pilot draw — with a
 *      mix: at least 3 Israeli and at least 3 small / thin on data. SEED
 *      repeats a draw; ONLY=<ids> runs a given list instead.
 *   2. Runs the v2 collection for each company with each model in MODELS
 *      (default claude-haiku-5-5; "claude-haiku-4-5-20251001,claude-haiku-5-5"
 *      for both). The searches are cached per company, so every model reads
 *      the same sources — only the model differs.
 *   3. Prints per model Claude's cost per company from the tokens each call
 *      reported, the longest prompt, and the calls over 100K tokens.
 *   4. Writes model_compare.csv — per company and field, what is on file and
 *      what each model found, with its source — for the owner to mark
 *      ("נכון" / "לא נכון"); with two models, the rows where they differ
 *      come first. model_compare.json keeps everything.
 *
 *   npx tsx scripts/model_compare.ts
 *   MODELS=claude-haiku-4-5-20251001,claude-haiku-5-5 SEED=<the same seed> npx tsx scripts/model_compare.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { collectCompany, newCollectStats } from "../lib/enrichment/collect.ts";
import { loadSectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { createSearchProviderState } from "../lib/enrichment/searchProviders.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { drawPilotSample, type PilotCandidate } from "../lib/enrichment/pilotSample.ts";
import { UsageMeter, LONG_PROMPT_TOKENS, knownModel } from "../lib/enrichment/models.ts";
import { blankRow } from "../worker/enrich.ts";
import { buildProfile } from "../worker/profile.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }

const MODELS = (process.env.MODELS ?? "claude-haiku-5-5").split(",").map((m) => m.trim()).filter(Boolean);
const SIZE = Number(process.env.SIZE ?? 10);
const SEED = Number(process.env.SEED ?? Date.now() % 100000);
const ONLY = (process.env.ONLY ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const db = createClient(url, key, { auth: { persistSession: false } });

type Fields = Record<string, { value: string; source: string }>;

/** What one run found, flattened for the sheet: one value (and its source) per field. */
function flatten(c: Awaited<ReturnType<typeof collectCompany>>, name: string): Fields {
  if (c.outcome !== "collected") return { outcome: { value: c.outcome, source: "" } };
  const p = buildProfile(c, name);
  const src = (id?: string | null) => (id ? c.sourceUrlFor(id) ?? "" : "");
  const usd = (n: number | null) => (n == null ? "?" : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : `$${+(n / 1e6).toFixed(1)}M`);
  return {
    city: { value: p.overview.city?.value ?? "", source: p.overview.city?.source_url ?? "" },
    country: { value: p.overview.country?.value ?? "", source: p.overview.country?.source_url ?? "" },
    founded_year: { value: p.overview.founded_year?.value != null ? String(p.overview.founded_year.value) : "", source: p.overview.founded_year?.source_url ?? "" },
    founding_country: { value: p.overview.founding_country?.value ?? "", source: p.overview.founding_country?.source_url ?? "" },
    founders: { value: p.people.founders.map((f) => f.name).join("; "), source: "" },
    rounds: { value: p.funding.rounds.map((r) => `${r.round_type} ${usd(r.amount)} ${r.date ?? "(no date)"}`).join("; "), source: p.funding.rounds.map((r) => r.source_url ?? "").filter(Boolean).join(" ") },
    competitors: { value: c.market.competitors.map((x) => x.name).join("; "), source: c.market.competitors.map((x) => src(x.source_id)).filter(Boolean).join(" ") },
    employee_range: { value: p.overview.employee_range ?? "", source: "" },
  };
}

async function draw(): Promise<PilotCandidate[]> {
  const rows: PilotCandidate[] = [];
  const cols = "id, name, website, description, city, country, founded_year, founding_country, status";
  if (ONLY.length) {
    const { data, error } = await db.from("startups").select(cols).in("id", ONLY);
    if (error) throw error;
    return (data ?? []) as PilotCandidate[];
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select(cols).not("website", "is", null).neq("status", "ipo").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as PilotCandidate[]));
    if (!data || data.length < 1000) break;
  }
  // Not the golden set, not an earlier pilot draw.
  const golden = new Set((JSON.parse(readFileSync(join(__dir, "..", "eval", "golden_set.json"), "utf8")).companies as Array<{ name: string }>).map((g) => g.name.trim().toLowerCase()));
  const earlier = new Set<string>();
  for (const f of ["pilot_companies.json", "model_compare_companies.json"]) {
    if (existsSync(f)) for (const c of (JSON.parse(readFileSync(f, "utf8")).companies ?? []) as Array<{ id: string }>) earlier.add(c.id);
  }
  return drawPilotSample(rows.filter((r) => !golden.has(r.name.trim().toLowerCase()) && !earlier.has(r.id)), { size: SIZE, minThin: 3, minIsraeli: 3, seed: SEED });
}

(async () => {
  const companies = await draw();
  writeFileSync("model_compare_companies.json", JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), companies }, null, 2));
  console.log(`Model check — ${companies.length} random companies (seed ${SEED}), models: ${MODELS.join(", ")}. Nothing is written to the database.\n`);
  for (const c of companies) console.log(`  ${c.name.padEnd(32)} ${(c.website ?? "").padEnd(34)} on file: ${c.city ?? "—"}, ${c.country ?? "—"}, founded ${c.founded_year ?? "—"}`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const taxonomy = await loadSectorTaxonomy(db);
  const meters = new Map(MODELS.map((m) => [m, new UsageMeter()]));
  const found = new Map<string, Map<string, Fields>>(); // company id → model → fields

  for (const company of companies) {
    found.set(company.id, new Map());
    for (const model of MODELS) {
      console.log(`\n── ${company.name} · ${model} ──`);
      const searchState = createSearchProviderState();
      searchState.cache = openSearchCache(`model-${company.id}`); // shared by the models: the same sources
      const row = blankRow({ checkId: `model-${company.id}`, name: company.name, website: company.website, country: null, founder: null });
      try {
        const c = await collectCompany(row, [], taxonomy, {
          anthropic,
          models: { enrich: model, profile: model, funding: model, market: model },
          update: false, deepDive: true, techGate: true, articlesToRead: 4, verbose: false, seen: null,
          recordCost: (m, usage) => meters.get(model)!.add(m, usage),
        }, newCollectStats(), searchState);
        found.get(company.id)!.set(model, flatten(c, company.name));
      } catch (e) {
        console.error(`    💥  ${e instanceof Error ? e.message : String(e)}`);
        found.get(company.id)!.set(model, { outcome: { value: `error: ${e instanceof Error ? e.message : String(e)}`, source: "" } });
      } finally {
        searchState.cache?.save();
      }
    }
  }

  // ── The sheet: per company and field, on file and each model's value ──
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["company_id", "company", "field", "on_file", ...MODELS.flatMap((m) => [m, `${m} source`, `${m} mark`]), "differs"];
  const rows: string[][] = [];
  const onFile = (c: PilotCandidate, f: string) => (({ city: c.city, country: c.country, founded_year: c.founded_year, founding_country: c.founding_country } as Record<string, unknown>)[f] ?? "") as string;
  for (const company of companies) {
    const byModel = found.get(company.id)!;
    const fields = [...new Set(MODELS.flatMap((m) => Object.keys(byModel.get(m) ?? {})))];
    for (const f of fields) {
      const values = MODELS.map((m) => byModel.get(m)?.[f]?.value ?? "");
      if (values.every((v) => !v)) continue;
      const differs = MODELS.length > 1 && new Set(values).size > 1;
      rows.push([company.id, company.name, f, String(onFile(company, f) ?? ""), ...MODELS.flatMap((m) => [byModel.get(m)?.[f]?.value ?? "", byModel.get(m)?.[f]?.source ?? "", ""]), differs ? "yes" : ""]);
    }
  }
  rows.sort((a, b) => (b[b.length - 1] === "yes" ? 1 : 0) - (a[a.length - 1] === "yes" ? 1 : 0));
  writeFileSync("model_compare.csv", "﻿" + [header, ...rows].map((r) => r.map((v) => cell(String(v))).join(",")).join("\r\n") + "\r\n");
  writeFileSync("model_compare.json", JSON.stringify({ seed: SEED, models: MODELS, companies, found: Object.fromEntries([...found].map(([id, m]) => [id, Object.fromEntries(m)])), usage: Object.fromEntries([...meters].map(([m, u]) => [m, u.toJSON()])) }, null, 2));

  console.log("\n" + "═".repeat(62));
  for (const [model, u] of meters) {
    console.log(`${model}${knownModel(model) ? "" : " (no price on file — priced as Haiku 4.5)"}`);
    console.log(`  Claude: $${u.costUsd.toFixed(4)} total, $${(u.costUsd / Math.max(1, companies.length)).toFixed(4)} per company, from ${u.calls} calls' reported tokens`);
    console.log(`  tokens: in ${(u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens).toLocaleString()} (cache read ${u.cacheReadTokens.toLocaleString()}), out ${u.outputTokens.toLocaleString()}`);
    console.log(`  longest prompt: ${u.maxPromptTokens.toLocaleString()} tokens · calls over ${LONG_PROMPT_TOKENS.toLocaleString()}: ${u.callsOverLong}${u.callsOverLong ? "  ⚠️  billed at Haiku 5.5's long-prompt rate" : " ✅"}`);
  }
  const differing = rows.filter((r) => r[r.length - 1] === "yes").length;
  console.log(`\n📝  model_compare.csv — ${rows.length} value(s) to mark ("נכון" / "לא נכון")${MODELS.length > 1 ? `, ${differing} where the models differ (first)` : ""}. Re-run another model on the same companies: MODELS=<model> SEED=${SEED} npx tsx scripts/model_compare.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
