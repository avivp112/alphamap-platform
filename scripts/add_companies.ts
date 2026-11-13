#!/usr/bin/env node
/**
 * scripts/add_companies.ts — add companies to the database from a list of names and websites (owner, 2026-11-13).
 *
 *   FILE=companies.csv npx tsx scripts/add_companies.ts                 # dry run: the report, nothing written
 *   FILE=companies.csv DRY_RUN=false npx tsx scripts/add_companies.ts   # adds the new ones
 *   ADD_LINES=27,145 ...   # lines whose name matches a company already there but which are a different company
 *   SKIP_LINES=291,411 ... # lines not to add, whatever the checks say
 *
 * ADD ONLY. A company already in the database (same website domain; or the same name with another website, which is reported and not added)
 * is left exactly as it is: nothing is reset or overwritten. (scripts/import_startups_list.ts, by contrast, syncs the whole table to a master
 * list and clears matched rows by default: do not use it for adding.) The new rows carry a name and a website only; the enrichment fills the rest,
 * and they fall in the empty group (lib/enrichment/dataGroups.ts). Every row is reported with its verdict in added_companies_<date>.csv, with
 * the ids of the rows added, so they can be removed.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseList, sortRows, summaryOf, nameKey, normalizeSite, type KnownName } from "../lib/enrichment/addCompanies.ts";
import { resolveCollision, type DbRecord } from "../lib/enrichment/sameCompany.ts";
import Anthropic from "@anthropic-ai/sdk";
import { requestFor } from "../lib/enrichment/models.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const FILE = process.env.FILE;
const DRY_RUN = process.env.DRY_RUN !== "false";
if (!FILE || !existsSync(FILE)) { console.error("FILE=<csv with a name and a website column> is required."); process.exit(1); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const { rows, problem } = parseList(readFileSync(FILE, "utf8"));
  if (problem) { console.error(`❌  ${problem}`); process.exit(1); }
  const hosts = new Set<string>(), names = new Map<string, KnownName>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select("id, name, website, country, city, industry, description").range(from, from + 999);
    if (error) throw error;
    for (const s of (data ?? []) as Array<DbRecord>) {
      const n = normalizeSite(s.website); if (n) hosts.add(n.host);
      const k = nameKey(s.name); if (k.length >= 3 && !names.has(k)) names.set(k, { id: s.id, name: s.name, website: s.website, country: s.country, city: s.city, industry: s.industry, description: s.description });
    }
    if (!data || data.length < 1000) break;
  }
  // ADD_LINES=27,145: lines of the list whose name matches a company already there but which are a different company: added.
  const addLines = new Set((process.env.ADD_LINES ?? "").split(",").map((x) => Number(x.trim())).filter(Boolean));
  let sorted = sortRows(rows, { hosts, names }, addLines);
  // SKIP_LINES=291,411: lines the owner decided not to add, whatever the checks say.
  const skipLines = new Set((process.env.SKIP_LINES ?? "").split(",").map((x) => Number(x.trim())).filter(Boolean));

  // A name that matches a company already there: the redirect and the record are checked before the owner is asked (sameCompany.ts).
  // RESOLVE=false skips this. same: not added, the address is proposed as a fix; different: added; unclear: left for the owner.
  const fixes: Array<{ id: string; name: string; old: string; next: string; why: string }> = [];
  if (process.env.RESOLVE !== "false") {
    const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
    const MODEL = process.env.MODEL ?? "claude-haiku-5-5";
    const get = async (u: string, opts: { text?: boolean } = {}) => {
      try {
        const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; AlphaMapBot/1.0)", Accept: "text/html" } });
        const body = opts.text ? (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500) : "";
        return { host: new URL(res.url).hostname, body };
      } catch { return { host: null as string | null, body: "" }; }
    };
    const cc: Record<string, string> = { br: "Brazil", pl: "Poland", cl: "Chile", co: "Colombia", mx: "Mexico", ar: "Argentina", pe: "Peru", au: "Australia", jp: "Japan", in: "India", uk: "United Kingdom", de: "Germany", fr: "France", il: "Israel", is: "Iceland" };
    for (const s of sorted) {
      if (s.verdict !== "name_already_in_database" || !s.collidesWith?.id || !s.website || skipLines.has(s.line)) continue;
      const r = await resolveCollision({
        finalHost: async (u) => (await get(u)).host, homepageText: async (u) => (await get(u, { text: true })).body,
        ask: async (req) => { if (!anthropic) return null; const msg = await anthropic.messages.create(requestFor(req, MODEL)); const t = msg.content.find((b) => b.type === "tool_use"); return t && t.type === "tool_use" ? t.input : null; },
        countryHint: (h) => cc[h.split(".").pop() ?? ""] ?? null,
      }, s.collidesWith as DbRecord, s.row.name, s.website);
      if (r.verdict === "different") { s.verdict = "new"; s.note = `another company with the same name (${r.reason})`; }
      else if (r.verdict === "same") {
        s.note = `the same company (${r.how}): ${r.reason}`;
        // An address fix is proposed only when a redirect shows where the sites lead, and it points at that final address; when the database already holds it, nothing.
        if (r.how === "redirect" && r.canonical && s.collidesWith.website && new URL(s.collidesWith.website).hostname.replace(/^www\./, "") !== new URL(r.canonical).hostname) fixes.push({ id: s.collidesWith.id!, name: s.collidesWith.name, old: s.collidesWith.website, next: r.canonical, why: r.reason });
      }
      else s.note = `unclear (${r.reason}): the database has "${s.collidesWith.name}" with ${s.collidesWith.website ?? "no website"} (${s.collidesWith.country ?? "no country"})`;
    }
  }
  console.log(`${DRY_RUN ? "DRY RUN — nothing is written.\n" : ""}${summaryOf(sorted).join("\n")}\n`);
  for (const s of sorted.filter((x) => x.verdict !== "new" && x.verdict !== "already_in_database")) console.log(`  line ${String(s.line).padStart(4)}  ${s.row.name.slice(0, 40).padEnd(40)} ${s.verdict}: ${s.note}`);
  for (const s of sorted) if (skipLines.has(s.line) && s.verdict === "new") { s.verdict = "name_already_in_database"; s.note = "skipped: the owner decided not to add it (SKIP_LINES)"; }
  if (fixes.length) {
    console.log(`\nThe same company under another address (nothing is changed here; to correct the address in the database, run the SQL below after you look):`);
    for (const f of fixes) console.log(`-- ${f.name}: ${f.old} -> ${f.next}  (${f.why})\nWITH u AS (UPDATE startups SET website = '${f.next}' WHERE id = '${f.id}' AND website = '${f.old}' AND NOT EXISTS (SELECT 1 FROM startups WHERE website = '${f.next}') RETURNING id) INSERT INTO field_changes (startup_id, field, old_value, new_value, source_url) SELECT id, 'website', to_jsonb('${f.old}'::text), to_jsonb('${f.next}'::text), 'owner decision 2026-11-13' FROM u;`);
  }
  const fresh = sorted.filter((s) => s.verdict === "new");
  const ids = new Map<string, string>();
  if (!DRY_RUN) {
    for (let i = 0; i < fresh.length; i += 200) {
      const batch = fresh.slice(i, i + 200).map((s) => ({ name: s.row.name, website: s.website! }));
      // ON CONFLICT (website) DO NOTHING: even a row that appeared in the database since the check cannot be overwritten or double-written.
      const { data, error } = await db.from("startups").upsert(batch, { onConflict: "website", ignoreDuplicates: true }).select("id, website");
      if (error) { console.error(`❌  insert failed at row ${i}: ${error.message}. Nothing after this batch was written; ${ids.size} added so far.`); break; }
      for (const r of (data ?? []) as Array<{ id: string; website: string }>) ids.set(r.website, r.id);
    }
    console.log(`\n✅  ${ids.size} companies added${ids.size < fresh.length ? ` (${fresh.length - ids.size} were already there by now and were left alone)` : ""}.`);
  } else console.log(`\n${fresh.length} would be added. Run with DRY_RUN=false to add them.`);
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = `added_companies_${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(out, "﻿" + ["line,name,website,verdict,note,id", ...sorted.map((s) => [String(s.line), s.row.name, s.website ?? s.row.website ?? "", s.verdict, s.note, s.website ? ids.get(s.website) ?? "" : ""].map(cell).join(","))].join("\r\n") + "\r\n");
  console.log(`📝  ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
