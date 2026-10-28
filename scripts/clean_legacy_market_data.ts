#!/usr/bin/env node
/**
 * scripts/clean_legacy_market_data.ts — the owner's decision of 2026-10-27
 * for what runs before the 2026-10-26 fixes wrote (they kept no run_id, so
 * scripts/undo_run.ts cannot undo them). The rules are in
 * lib/enrichment/legacyCleanup.ts:
 *
 *   patents      everything read off the web goes (count and fields too);
 *                patents from the EPO register stay.
 *   competitors  deleted when its explanation says it came from a "similar
 *                companies" / "alternatives" list, or describes a partner,
 *                customer, investor or host platform; any other one without a
 *                verified source stays, marked unverified (labelled on the site).
 *   rounds       those the 2026-10-26 run inserted: deleted when every source
 *                is a data platform; a type no source states becomes "Unknown";
 *                the amount stays when it has a source; an acquisition,
 *                secondary or buyout row no source states is deleted. Each round's source
 *                page is fetched to look for the type, as enrichment does.
 *
 * DRY_RUN (the default) changes nothing: a report, SAMPLE=n examples per kind,
 * and a CSV of every change with the value before it (the backup).
 * DRY_RUN=false, before writing anything: registers the cleanup as a run and
 * uploads a backup of every value it will change (the original rows, the
 * investor links of rounds it deletes, the report CSV, the unread pages) to
 * the private Supabase Storage bucket "backups" — and reads it back. If that
 * fails, nothing is written. Each change is recorded in field_changes before
 * it is made; scripts/undo_run.ts undoes the run by its run_id.
 *
 * Trial on one company first (owner, 2026-10-27): COMPANY=DarkOwl DRY_RUN=false,
 * then undo that run, then a dry run of COMPANY=DarkOwl shows the same changes again.
 *
 *   npx tsx scripts/clean_legacy_market_data.ts
 *   SAMPLE=5 npx tsx scripts/clean_legacy_market_data.ts
 *   ONLY=patents,competitors,rounds   (default: all three)
 *   COMPANY=DarkOwl,Apify             (only these companies, by name or id)
 *   ROUNDS_FROM=2026-10-26T00:00:00Z ROUNDS_TO=2026-10-27T00:00:00Z   (the run's window, UTC)
 *   DRY_RUN=false npx tsx scripts/clean_legacy_market_data.ts
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { planPatentCleanup, planCompetitorCleanup, planRoundCleanup, type Page, type RoundEvidence, type StoredRound } from "../lib/enrichment/legacyCleanup.ts";
import { startupChanges, roundDeleteChange, roundUpdateChanges, type FieldChangeRow } from "../lib/enrichment/runChanges.ts";
import { classifySourceType } from "../lib/enrichment/sources.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

const DRY_RUN = process.env.DRY_RUN !== "false";
const SAMPLE = Number(process.env.SAMPLE ?? 3);
const ONLY = new Set((process.env.ONLY ?? "patents,competitors,rounds").split(",").map((s) => s.trim()));
const ROUNDS_FROM = process.env.ROUNDS_FROM ?? "2026-10-26T00:00:00Z";
const ROUNDS_TO = process.env.ROUNDS_TO ?? "2026-10-27T00:00:00Z";
const COMPANY = (process.env.COMPANY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const PAGE = 500;
const BUCKET = "backups";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

interface Row { id: string; name: string; patents: PatentList; patent_count: number | null; patent_fields: string[] | null; competitors: CompetitorList; enriched_v2_at: string | null }
type PatentList = Parameters<typeof planPatentCleanup>[0]["patents"];
type CompetitorList = Parameters<typeof planCompetitorCleanup>[0];
interface Change { company: string; startup_id: string; kind: string; detail: string; before: unknown; after: unknown }

const changes: Change[] = [];
const fieldChanges: FieldChangeRow[] = [];
const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v ?? null); return s.length > 180 ? `${s.slice(0, 177)}...` : s; };

/** A source page as plain text (no Jina: a cleanup should not spend credit). */
async function fetchPage(pageUrl: string): Promise<Page | null> {
  try {
    const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (AlphaMap data check)" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok) return null;
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|h\d|li|br)>/gi, "\n").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$").replace(/[ \t]+/g, " ");
    return { title, text };
  } catch { return null; }
}

async function startupRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("startups").select("id, name, patents, patent_count, patent_fields, competitors, enriched_v2_at").order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

(async () => {
  console.log(DRY_RUN ? "DRY_RUN — nothing is written. DRY_RUN=false to apply." : "Writing changes.");
  const startups = (await startupRows()).filter((s) => !COMPANY.length || COMPANY.includes(s.name.toLowerCase()) || COMPANY.includes(s.id));
  if (COMPANY.length) console.log(`Only: ${startups.map((s) => s.name).join(", ") || "(no company matched)"}`);
  const byId = new Map(startups.map((s) => [s.id, s]));
  const startupPatches = new Map<string, Record<string, unknown>>();
  const patchOf = (id: string) => startupPatches.get(id) ?? startupPatches.set(id, {}).get(id)!;

  // ── Patents and competitors ──────────────────────────────────────────────
  for (const s of startups) {
    if (ONLY.has("patents")) {
      const p = planPatentCleanup(s);
      if (Object.keys(p.patch).length) {
        Object.assign(patchOf(s.id), p.patch);
        changes.push({ company: s.name, startup_id: s.id, kind: "patents_removed", detail: p.removed.join("; ") || "count/fields only", before: { patents: s.patents, patent_count: s.patent_count, patent_fields: s.patent_fields }, after: p.patch });
      }
    }
    if (ONLY.has("competitors")) {
      const c = planCompetitorCleanup(s.competitors, s.name);
      if (c.changes.length) {
        patchOf(s.id).competitors = c.competitors;
        for (const ch of c.changes) changes.push({ company: s.name, startup_id: s.id, kind: `competitor_${ch.action}`, detail: ch.name, before: ch.explanation, after: ch.action === "marked_unverified" ? "(shown, labelled Unverified)" : "(deleted)" });
      }
    }
  }

  // ── Rounds the 2026-10-26 run inserted ───────────────────────────────────
  const roundPlans: Array<{ round: StoredRound & { startup_id: string; created_at: string }; plan: ReturnType<typeof planRoundCleanup> }> = [];
  let pagesRead = 0, pagesFailed = 0;
  const unread: Array<{ company: string; startup_id: string; round_id: string; round_type: string | null; amount_raised: number | null; urls: string[] }> = [];
  if (ONLY.has("rounds")) {
    const inRun = new Set(startups.filter((s) => s.enriched_v2_at && s.enriched_v2_at >= ROUNDS_FROM && s.enriched_v2_at < ROUNDS_TO).map((s) => s.id));
    const { data: rounds, error } = await db.from("funding_rounds").select("*").gte("created_at", ROUNDS_FROM).lt("created_at", ROUNDS_TO);
    if (error) throw error;
    // Only rounds of companies that run wrote (enriched_v2_at in the window) — not other ingesters' rounds of that day.
    const ofRun = ((rounds ?? []) as Array<StoredRound & { startup_id: string; created_at: string }>).filter((r) => inRun.has(r.startup_id));
    console.log(`Rounds created ${ROUNDS_FROM} … ${ROUNDS_TO}${COMPANY.length ? " (these companies)" : ""}: ${ofRun.length}`);
    const evidence = new Map<string, RoundEvidence[]>();
    for (const sid of new Set(ofRun.map((r) => r.startup_id))) {
      const { data: prov } = await db.from("field_provenance").select("field, source_url, evidence_quote").eq("startup_id", sid).like("field", "funding_rounds.%");
      for (const p of (prov ?? []) as Array<{ field: string; source_url: string | null; evidence_quote: string | null }>) {
        const [, id, column] = p.field.split(".");
        evidence.set(id, [...(evidence.get(id) ?? []), { column, source_url: p.source_url, evidence_quote: p.evidence_quote }]);
      }
    }
    const urls = [...new Set(ofRun.flatMap((r) => [r.source_url, ...(evidence.get(r.id) ?? []).map((e) => e.source_url)]).filter((u): u is string => !!u && classifySourceType(u) !== "aggregator_snippet"))];
    const pages = new Map<string, Page | null>();
    for (let i = 0; i < urls.length; i += 4) {
      await Promise.all(urls.slice(i, i + 4).map(async (u) => { const p = await fetchPage(u); pages.set(u, p); p ? pagesRead++ : pagesFailed++; }));
      process.stdout.write(`\r  source pages read: ${pagesRead}, unreadable: ${pagesFailed} / ${urls.length}`);
    }
    if (urls.length) console.log("");
    for (const r of ofRun) {
      // A round whose source page could not be opened: listed, to read again once enrichment may run (owner, 2026-10-27).
      const own = [r.source_url, ...(evidence.get(r.id) ?? []).map((e) => e.source_url)].filter((u): u is string => !!u && pages.has(u));
      const failed = [...new Set(own.filter((u) => pages.get(u) === null))];
      if (failed.length) unread.push({ company: byId.get(r.startup_id)?.name ?? r.startup_id, startup_id: r.startup_id, round_id: r.id, round_type: r.round_type, amount_raised: r.amount_raised, urls: failed });
      const plan = planRoundCleanup(r, evidence.get(r.id) ?? [], pages);
      if (plan.action === "keep") continue;
      roundPlans.push({ round: r, plan });
      const company = byId.get(r.startup_id)?.name ?? r.startup_id;
      const label = `${r.round_type ?? "?"} ${r.amount_raised ?? ""} (${r.source_url ?? "no source"})`;
      if (plan.action === "delete") changes.push({ company, startup_id: r.startup_id, kind: plan.reason === "round_event_not_stated" ? "round_deleted_event_unstated" : "round_deleted_platform_only", detail: label, before: r, after: "(deleted)" });
      else changes.push({ company, startup_id: r.startup_id, kind: plan.patch.round_type ? "round_type_unstated" : "round_amount_unsourced", detail: `${label} — ${plan.notes.join("; ")}`, before: { round_type: r.round_type, amount_raised: r.amount_raised }, after: plan.patch });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const kinds = new Map<string, Change[]>();
  for (const c of changes) kinds.set(c.kind, [...(kinds.get(c.kind) ?? []), c]);
  const LABEL: Record<string, string> = {
    patents_removed: "Patents read off the web — removed",
    competitor_deleted_listing: "Competitors from a similar/alternatives list — deleted",
    competitor_deleted_relationship: "Competitors that are a partner/customer/investor/platform — deleted",
    competitor_marked_unverified: "Competitors without a verified source — kept, labelled \"Unverified\" on the site",
    round_deleted_platform_only: "Rounds whose only source is a data platform — deleted",
    round_deleted_event_unstated: "Acquisition / secondary / buyout rows no source states — deleted (as Unknown they would count as equity)",
    round_type_unstated: "Round types no source states — set to Unknown",
    round_amount_unsourced: "Round amounts with no source — removed",
  };
  for (const [kind, list] of kinds) {
    console.log(`\n── ${LABEL[kind] ?? kind}: ${list.length} (${new Set(list.map((c) => c.startup_id)).size} companies) ──`);
    for (const c of list.slice(0, SAMPLE)) console.log(`• ${c.company} — ${short(c.detail)}${kind.startsWith("competitor_") ? `\n    "${short(c.before)}"` : ""}`);
  }
  if (unread.length) {
    console.log(`\n⚠️  Rounds whose source page could not be opened (judged from the stored quotes alone) — kept in the backup as unread_sources.json, to read again:`);
    for (const u of unread) console.log(`   • ${u.company} — ${u.round_type ?? "?"} ${u.amount_raised ?? ""} — ${u.urls.join(" ")}`);
  }

  const cell = (v: unknown) => `"${String(typeof v === "string" ? v : JSON.stringify(v ?? null)).replace(/"/g, '""')}"`;
  const out = `clean_legacy_market_data_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  writeFileSync(out, ["company,startup_id,change,detail,before,after", ...changes.map((c) => [c.company, c.startup_id, c.kind, c.detail, c.before, c.after].map(cell).join(","))].join("\n"));
  console.log(`\nCompanies ${DRY_RUN ? "to change" : "changed"}: ${new Set(changes.map((c) => c.startup_id)).size} · every change with its value before: ${out}`);
  if (DRY_RUN) return;

  // ── Write, recorded as a run so it can be undone ─────────────────────────
  const { data: run, error: runErr } = await db.from("enrichment_runs").insert({
    pipeline: "v2", run_kind: "bulk", dry_run: false,
    thresholds: { script: "clean_legacy_market_data", ONLY: [...ONLY], ROUNDS_FROM, ROUNDS_TO, COMPANY },
  }).select("run_id").single();
  if (runErr || !run) throw new Error(`could not register the cleanup in enrichment_runs (${runErr?.message ?? "no row"}) — nothing written`);
  const runId = (run as { run_id: string }).run_id;

  // The investor links a deleted round takes with it (ON DELETE CASCADE): kept so an undo puts them back.
  const deletedIds = roundPlans.filter((p) => p.plan.action === "delete").map((p) => p.round.id);
  const links = new Map<string, Array<Record<string, unknown>>>();
  if (deletedIds.length) {
    const { data, error } = await db.from("funding_round_investors").select("*").in("round_id", deletedIds);
    if (error) throw new Error(`could not read the investor links of the rounds to delete (${error.message}) — nothing written`);
    for (const l of (data ?? []) as Array<Record<string, unknown>>) links.set(l.round_id as string, [...(links.get(l.round_id as string) ?? []), l]);
  }

  // The backup, in a permanent place, before any write — and read back.
  const backup = {
    run_id: runId, created_at: new Date().toISOString(), rules: "lib/enrichment/legacyCleanup.ts",
    startups: [...startupPatches.keys()].map((id) => byId.get(id)),
    rounds: roundPlans.map((p) => ({ ...p.round, _investor_links: links.get(p.round.id) ?? [] })),
  };
  const folder = `clean_legacy_market_data/${runId}`;
  const { error: bucketErr } = await db.storage.createBucket(BUCKET, { public: false });
  if (bucketErr && !/already exists/i.test(bucketErr.message)) throw new Error(`backup bucket: ${bucketErr.message} — nothing written`);
  const files: Array<[string, string, string]> = [
    ["before.json", JSON.stringify(backup), "application/json"],
    ["report.csv", readFileSync(out, "utf8"), "text/csv"],
    ["unread_sources.json", JSON.stringify(unread, null, 2), "application/json"],
  ];
  for (const [name, body, type] of files) {
    const { error } = await db.storage.from(BUCKET).upload(`${folder}/${name}`, new Blob([body], { type }), { upsert: false, contentType: type });
    if (error) throw new Error(`backup upload ${name}: ${error.message} — nothing written`);
    const { data: back, error: readErr } = await db.storage.from(BUCKET).download(`${folder}/${name}`);
    if (readErr || !back || (await back.text()) !== body) throw new Error(`backup ${name} did not read back identical — nothing written`);
  }
  console.log(`\n💾  Backup saved and read back: Supabase Storage → ${BUCKET}/${folder}/ (before.json, report.csv, unread_sources.json)`);

  // Each change is recorded before it is made; a write that fails takes its record back out.
  const record = async (rows: FieldChangeRow[]) => {
    if (!rows.length) return [] as string[];
    const { data, error } = await db.from("field_changes").insert(rows).select("id");
    if (error) throw new Error(`field_changes insert failed (${error.message}) — stopped; what was written so far is undoable by run_id ${runId}`);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  };
  const unrecord = async (ids: string[]) => { if (ids.length) await db.from("field_changes").delete().in("id", ids); };
  let written = 0, failed = 0;
  for (const [id, patch] of startupPatches) {
    const ids = await record(startupChanges(id, byId.get(id) as unknown as Record<string, unknown>, patch, runId));
    const { error } = await db.from("startups").update(patch).eq("id", id);
    if (error) { console.warn(`  ⚠️  ${byId.get(id)?.name}: ${error.message}`); await unrecord(ids); failed++; continue; }
    written++;
    if (written % 200 === 0) process.stdout.write(`\r  companies written: ${written}/${startupPatches.size}`);
  }
  for (const { round, plan } of roundPlans) {
    if (plan.action === "delete") {
      const { capital_type: _generated, ...row } = round as unknown as Record<string, unknown>;
      const ids = await record([roundDeleteChange(round.startup_id, round.id, { ...row, _investor_links: links.get(round.id) ?? [] }, runId)]);
      const { error } = await db.from("funding_rounds").delete().eq("id", round.id);
      if (error) { console.warn(`  ⚠️  round ${round.id}: ${error.message}`); await unrecord(ids); failed++; }
    } else if (plan.action === "update") {
      const ids = await record(roundUpdateChanges(round.startup_id, round.id, round as unknown as Record<string, unknown>, plan.patch, runId));
      const { error } = await db.from("funding_rounds").update(plan.patch).eq("id", round.id);
      if (error) { console.warn(`  ⚠️  round ${round.id}: ${error.message}`); await unrecord(ids); failed++; }
    }
  }
  await db.from("enrichment_runs").update({ finished_at: new Date().toISOString(), companies_count: startupPatches.size }).eq("run_id", runId);
  if (roundPlans.length) await db.rpc("refresh_startups_search").then(() => undefined, () => undefined);
  console.log(`\nDone${failed ? ` — ${failed} write(s) failed, listed above, not recorded` : ""}. run_id ${runId}`);
  console.log(`  undo: RUN_ID=${runId} npx tsx scripts/undo_run.ts   (DRY_RUN=false to undo for real)`);
  console.log("  check: run this script again without DRY_RUN=false — it should find 0 changes left.");
})().catch((e) => { console.error(e); process.exit(1); });
