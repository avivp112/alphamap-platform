#!/usr/bin/env node
/**
 * discover_competitors.ts — Auto-discover and add untracked competitors
 *
 * Every startup's `competitors` JSONB array (name, website, how_it_competes,
 * startup_id) can name companies that aren't yet tracked in `startups`
 * (startup_id IS NULL). This script finds those, ranks them by how many of
 * our own startups mention them, and runs each one through the SAME
 * tech/public classification + insertion pipeline used by the "Add Startup"
 * button (the ingest-startup edge function) — so a candidate is only added
 * if it independently passes the exact same rules a human-triggered add
 * would enforce:
 *   1. Must be a tech company             (INDUSTRY_RULE)
 *   2. Must not already exist in our DB   (website-uniqueness check, 409)
 *   3. Must be a private company          (PRIVACY_RULE)
 *
 * Pipeline:
 *   1. Fetch every startup + its competitors array (paginated).
 *   2. Build a domain/name index of currently-tracked startups, then walk
 *      every competitor entry with startup_id IS NULL:
 *        - if it actually matches a tracked startup (just never got
 *          cross-linked), patch startup_id in place — free, no LLM cost.
 *        - otherwise, fold it into a global candidate pool, deduped by
 *          website domain (falls back to normalized name), tracking a
 *          mention count and which startups referenced it.
 *   3. Drop candidates already recorded in rejected_competitor_candidates
 *      (a prior run already determined they're public or non-tech — no
 *      point re-spending research budget on them).
 *   4. Rank by mention count (a competitor named by 5 of our startups is a
 *      much higher-value add than one named by a single startup) and cap to
 *      BATCH_SIZE.
 *   5. For each candidate (sequential, rate-limited): call ingest-startup
 *      with { company_name, website } — the website hint anchors its
 *      searches and disambiguates generic names.
 *        - success            → cross-link every mentioning startup's
 *                                competitor entry to the new startup_id.
 *        - 409 (dup website)  → the existing_id in the response IS the
 *                                right target; cross-link to it instead of
 *                                inserting (no rejection recorded).
 *        - 422 PRIVACY_RULE   → persist a rejection (reason: public_company).
 *        - 422 INDUSTRY_RULE  → persist a rejection (reason: not_tech).
 *        - anything else      → log and move on; not persisted, so it's
 *                                retried on the next run.
 *
 * Usage:
 *   npx tsx scripts/discover_competitors.ts                       # dry run (default)
 *   DRY_RUN=false BATCH_SIZE=25 npx tsx scripts/discover_competitors.ts
 *   …then re-run the same command — processed candidates are either now
 *   tracked startups, cross-linked to an existing one, or recorded as
 *   rejected, so each run naturally works through what's left.
 *
 * Env vars:
 *   DRY_RUN       default "true"  — preview only, no writes, no edge-function calls
 *   BATCH_SIZE    default 25      — max candidates to process per run
 *   MIN_MENTIONS  default 1       — skip candidates named by fewer startups than this
 *   DELAY_MS      default 20000   — pause between edge-function calls (it runs 5
 *                                   searches + a Claude call per candidate, same
 *                                   cost profile as bulk_enrich_all.ts per company)
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap: load .env for local dev ─────────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Configuration ────────────────────────────────────────────────────────
const DRY_RUN      = process.env.DRY_RUN !== "false"; // safe default: dry run
const BATCH_SIZE    = Number(process.env.BATCH_SIZE ?? 25);
const MIN_MENTIONS  = Number(process.env.MIN_MENTIONS ?? 1);
const DELAY_MS       = Number(process.env.DELAY_MS ?? 20_000);

// ── Env-var guard ────────────────────────────────────────────────────────
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase       = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Types ────────────────────────────────────────────────────────────────
interface Competitor {
  name: string;
  website: string | null;
  how_it_competes: string;
  startup_id: string | null;
}

interface StartupRow {
  id: string;
  name: string;
  website: string | null;
  competitors: Competitor[] | null;
}

interface Candidate {
  name: string;
  website: string | null;
  domain: string | null;
  mentionCount: number;
  mentionedBy: Array<{ startupId: string; startupName: string }>;
}

// ── Shared helpers (match import_startups_list.ts / bulk_enrich_all.ts) ───
function sanitize(s: string): string {
  return s.replace(/﻿/g, "").replace(/ /g, " ").replace(/�/g, "").trim();
}

function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function normalizeName(name: string): string {
  return sanitize(name).toLowerCase().replace(/\s+/g, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllPaginated<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) { console.error("❌  fetch failed:", error.message); process.exit(1); }
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Patches a single competitor entry (matched by domain, falling back to
// name) on one host startup's row to point at targetId. Used both for the
// free "already tracked, just never linked" pass and after a successful
// insert/dup-match in the main loop.
async function crossLinkOne(hostStartupId: string, domain: string | null, name: string, targetId: string): Promise<boolean> {
  const { data: row, error } = await supabase
    .from("startups")
    .select("competitors")
    .eq("id", hostStartupId)
    .maybeSingle();
  if (error || !row || !Array.isArray(row.competitors)) return false;

  let changed = false;
  const patched = (row.competitors as Competitor[]).map((c) => {
    if (c.startup_id) return c;
    const cDomain = websiteDomain(c.website);
    const matches = domain ? cDomain === domain : normalizeName(c.name || "") === normalizeName(name);
    if (matches) { changed = true; return { ...c, startup_id: targetId }; }
    return c;
  });
  if (!changed) return false;

  const { error: updErr } = await supabase.from("startups").update({ competitors: patched }).eq("id", hostStartupId);
  if (updErr) { console.warn(`    ⚠️  Cross-link write failed for ${hostStartupId}: ${updErr.message}`); return false; }
  return true;
}

async function crossLinkCandidate(candidate: Candidate, targetId: string): Promise<number> {
  let linked = 0;
  for (const m of candidate.mentionedBy) {
    if (await crossLinkOne(m.startupId, candidate.domain, candidate.name, targetId)) linked++;
  }
  return linked;
}

async function main() {
  const startedAt = new Date().toISOString();
  const bar = "═".repeat(62);
  console.log(`╔${bar}╗`);
  console.log(`║${"  AlphaMap — Competitor Discovery Run".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(Math.max(0, 62 - 2 - startedAt.length))}║`);
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | BATCH_SIZE=${String(BATCH_SIZE).padEnd(6)} | MIN_MENTIONS=${String(MIN_MENTIONS).padEnd(3)} | DELAY=${DELAY_MS / 1000}s${" ".padEnd(4)}║`);
  console.log(`╚${bar}╝\n`);

  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to call ingest-startup and write to the database.\n");

  // ── 1. Fetch all startups + their competitors ────────────────────────────
  const startups = await fetchAllPaginated<StartupRow>((from, to) =>
    supabase.from("startups").select("id, name, website, competitors").order("name").range(from, to),
  );

  const trackedByDomain = new Map<string, StartupRow>();
  const trackedByName   = new Map<string, StartupRow>();
  for (const s of startups) {
    const d = websiteDomain(s.website);
    if (d && !trackedByDomain.has(d)) trackedByDomain.set(d, s);
    if (!trackedByName.has(normalizeName(s.name))) trackedByName.set(normalizeName(s.name), s);
  }

  // ── 2. Walk every competitor entry ────────────────────────────────────────
  const candidates = new Map<string, Candidate>();
  let totalEntries = 0;
  let alreadyLinked = 0;
  let freeLinksMade = 0;

  for (const s of startups) {
    if (!Array.isArray(s.competitors)) continue;
    for (const c of s.competitors) {
      totalEntries++;
      if (c.startup_id) { alreadyLinked++; continue; }

      const name = sanitize(c.name || "");
      if (!name) continue;
      const domain = websiteDomain(c.website);

      // Already tracked under a different row — just never cross-linked.
      const existing = (domain && trackedByDomain.get(domain)) || trackedByName.get(normalizeName(name));
      if (existing) {
        alreadyLinked++;
        if (!DRY_RUN) {
          if (await crossLinkOne(s.id, domain, name, existing.id)) freeLinksMade++;
        }
        continue;
      }

      const key = domain ?? `name:${normalizeName(name)}`;
      const found = candidates.get(key);
      if (found) {
        found.mentionCount++;
        found.mentionedBy.push({ startupId: s.id, startupName: s.name });
      } else {
        candidates.set(key, {
          name,
          website: c.website ?? null,
          domain,
          mentionCount: 1,
          mentionedBy: [{ startupId: s.id, startupName: s.name }],
        });
      }
    }
  }

  console.log("── Extraction " + "─".repeat(48));
  console.log(`  Startups scanned:              ${startups.length}`);
  console.log(`  Competitor entries seen:       ${totalEntries}`);
  console.log(`  Already tracked/linked:        ${alreadyLinked}${DRY_RUN ? "" : ` (${freeLinksMade} newly cross-linked this run, free)`}`);
  console.log(`  Distinct untracked candidates: ${candidates.size}`);

  // ── 3. Drop candidates already recorded as rejected ──────────────────────
  const { data: rejectedRows, error: rejErr } = await supabase
    .from("rejected_competitor_candidates")
    .select("domain, name");
  if (rejErr) { console.error("❌  Failed to load rejected_competitor_candidates:", rejErr.message); process.exit(1); }

  const rejectedDomains = new Set((rejectedRows ?? []).filter((r) => r.domain).map((r) => r.domain as string));
  const rejectedNames   = new Set((rejectedRows ?? []).filter((r) => !r.domain).map((r) => normalizeName(r.name)));

  let skippedRejected = 0;
  const eligible = [...candidates.values()].filter((c) => {
    const isRejected = c.domain ? rejectedDomains.has(c.domain) : rejectedNames.has(normalizeName(c.name));
    if (isRejected) skippedRejected++;
    return !isRejected;
  });

  // ── 4. Rank by mention count, apply MIN_MENTIONS, cap to BATCH_SIZE ──────
  const ranked = eligible
    .filter((c) => c.mentionCount >= MIN_MENTIONS)
    .sort((a, b) => b.mentionCount - a.mentionCount);
  const queue = ranked.slice(0, BATCH_SIZE);

  console.log(`  Already rejected (skipped):    ${skippedRejected}`);
  console.log(`  Eligible (>= ${MIN_MENTIONS} mention(s)):     ${ranked.length}`);
  console.log(`  Queued this run (BATCH_SIZE):  ${queue.length}\n`);

  if (queue.length === 0) {
    console.log("🏁  Nothing to process — queue is empty.\n");
    return;
  }

  // ── 5. Process the queue ──────────────────────────────────────────────────
  const tally = { inserted: 0, foundExisting: 0, rejectedPublic: 0, rejectedNonTech: 0, errors: 0, crossLinked: 0 };

  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    console.log(`[${i + 1}/${queue.length}] "${c.name}"${c.domain ? ` (${c.domain})` : ""} — mentioned by ${c.mentionCount} startup(s): ${c.mentionedBy.map((m) => m.startupName).slice(0, 3).join(", ")}${c.mentionedBy.length > 3 ? ", …" : ""}`);

    if (DRY_RUN) {
      console.log(`    [DRY] Would call ingest-startup with { company_name: "${c.name}", website: ${c.website ? `"${c.website}"` : "null"} }`);
    } else {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-startup`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ company_name: c.name, website: c.website ?? undefined }),
        });
        const json = await res.json();

        if (res.ok && json.success) {
          console.log(`    ✅  Inserted: ${json.startup.name} (${json.startup.id})`);
          tally.inserted++;
          const linked = await crossLinkCandidate(c, json.startup.id);
          tally.crossLinked += linked;
          console.log(`    🔗  Cross-linked ${linked}/${c.mentionCount} mention(s)`);
        } else if (res.status === 409 && json.existing_id) {
          console.log(`    ↪️   Already exists (${json.error}) — cross-linking to existing row instead`);
          tally.foundExisting++;
          const linked = await crossLinkCandidate(c, json.existing_id);
          tally.crossLinked += linked;
          console.log(`    🔗  Cross-linked ${linked}/${c.mentionCount} mention(s)`);
        } else if (res.status === 422 && json.rule_violated === "PRIVACY_RULE") {
          console.log(`    🚫  Rejected — public company: ${json.error}`);
          tally.rejectedPublic++;
          const { error: insErr } = await supabase.from("rejected_competitor_candidates").insert({
            name: c.name, website: c.website, domain: c.domain,
            reason: "public_company", detail: json.reason ?? json.error, mention_count: c.mentionCount,
          });
          if (insErr && insErr.code !== "23505") console.warn(`    ⚠️  Failed to persist rejection: ${insErr.message}`);
        } else if (res.status === 422 && json.rule_violated === "INDUSTRY_RULE") {
          console.log(`    🚫  Rejected — not a tech company: ${json.error}`);
          tally.rejectedNonTech++;
          const { error: insErr } = await supabase.from("rejected_competitor_candidates").insert({
            name: c.name, website: c.website, domain: c.domain,
            reason: "not_tech", detail: json.reason ?? json.error, mention_count: c.mentionCount,
          });
          if (insErr && insErr.code !== "23505") console.warn(`    ⚠️  Failed to persist rejection: ${insErr.message}`);
        } else {
          console.warn(`    ⚠️  Unexpected response (${res.status}): ${json.error ?? "unknown error"}`);
          tally.errors++;
        }
      } catch (err) {
        console.error(`    ❌  Request failed: ${String(err)}`);
        tally.errors++;
      }
    }

    if (!DRY_RUN && i < queue.length - 1) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s…`);
      await sleep(DELAY_MS);
    }
  }

  // ── 6. Final summary ──────────────────────────────────────────────────────
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const mm = Math.floor(elapsedMs / 60_000);
  const ss = Math.floor((elapsedMs % 60_000) / 1000);

  console.log(`\n${bar}`);
  console.log("COMPETITOR DISCOVERY SUMMARY");
  console.log(bar);
  console.log(`  Candidates processed:   ${queue.length} of ${ranked.length} eligible`);
  console.log(`  ✅  Inserted:            ${tally.inserted}`);
  console.log(`  ↪️   Found existing:      ${tally.foundExisting}  (already tracked under a different competitor mention)`);
  console.log(`  🚫  Rejected (public):   ${tally.rejectedPublic}`);
  console.log(`  🚫  Rejected (non-tech): ${tally.rejectedNonTech}`);
  console.log(`  ❌  Errors:              ${tally.errors}  (not persisted — retried next run)`);
  console.log(`  🔗  Cross-links made:    ${tally.crossLinked + freeLinksMade}  (${freeLinksMade} free + ${tally.crossLinked} from this run's inserts/matches)`);
  console.log(`  ⏱️   Elapsed:             ${mm}m ${ss}s`);

  if (DRY_RUN) {
    console.log(`\n  ℹ️  DRY RUN — rerun with DRY_RUN=false to apply.`);
  }
  if (ranked.length > queue.length) {
    console.log(`\n  ▶️  ~${ranked.length - queue.length} more eligible candidates queued for a future run (raise BATCH_SIZE or re-run).`);
  } else {
    console.log(`\n  🏁  All eligible candidates from this pass have been processed.`);
  }
  console.log(bar + "\n");

  if (!DRY_RUN && tally.errors > 0 && tally.inserted === 0 && tally.foundExisting === 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
