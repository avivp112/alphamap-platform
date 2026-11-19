#!/usr/bin/env node
/**
 * scripts/correct_db.ts — values in the database for which the regression gate now has a better one (owner, 2026-11-19). Nothing is written without APPROVED_BY=aviv and DRY_RUN=false.
 * It reads the gate's reports (regression/out/batch_N/pilot_report.csv, from the last gate run) and the database, and lists, per company: old value ← new value, with the source.
 * Supported: a purchase (status, buyer, date: startups.status / acquired_by / exit_date) and a round's type (funding_rounds.round_type, matched by amount).
 * Every change is recorded in field_changes under a run of its own (undo_run.ts puts it back).
 *
 *   npx tsx scripts/correct_db.ts                                   # the list
 *   APPROVED_BY=aviv DRY_RUN=false npx tsx scripts/correct_db.ts    # writes what is listed
 *   ONLY="Paradox AI,UltraVox" ...                                  # some companies only
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { writtenBatches } from "../lib/enrichment/regressionGate.ts";
import { statedRoundLabels } from "../lib/enrichment/assemble.ts";
import { roundUpdateChanges } from "../lib/enrichment/runChanges.ts";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const WRITE = process.env.DRY_RUN === "false";
if (WRITE && process.env.APPROVED_BY !== "aviv") { console.error("⛔  The database is corrected only for values the owner approved: APPROVED_BY=aviv DRY_RUN=false npx tsx scripts/correct_db.ts"); process.exit(1); }
const skip = (process.env.SKIP ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);   // "Company:column", e.g. SKIP="Dietly:acquired_by"
const infos: string[] = [];
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

interface Change { startup_id: string; company: string; table: "startups" | "funding_rounds"; id: string; column: string; old: unknown; now: unknown; source: string; quote: string }

(async () => {
  const changes: Change[] = [];
  for (const n of writtenBatches()) {
    const f = `regression/out/batch_${n}/pilot_report.csv`;
    if (!existsSync(f)) { console.log(`batch ${n}: no ${f} — run the gate first`); continue; }
    const [head, ...body] = parseCsv(readFileSync(f, "utf8"));
    const at = (c: string) => head.indexOf(c);
    const rows = body.map((r) => ({ id: r[at("company_id")], company: r[at("company")], field: r[at("field")], after: r[at("after")], source: r[at("source_url")] ?? "", quote: r[at("quote")] ?? "" }));
    for (const r of rows) {
      if (only.length && !only.includes(r.company.toLowerCase())) continue;
      if (r.field === "acquired") {
        const m = r.after.match(/^status = (\S+)(?: · Acquired by (.+?) \(([^)]*)\))?\s*$/);
        if (!m) continue;
        const { data } = await db.from("startups").select("id, status, acquired_by, exit_date").eq("id", r.id).single();
        if (!data) continue;
        const cur = data as { status: string | null; acquired_by: string | null; exit_date: string | null };
        const want: Record<string, string | null> = { status: m[1], acquired_by: m[2] ?? null, exit_date: m[3] && m[3] !== "undated" ? m[3] : null };
        for (const col of ["status", "acquired_by", "exit_date"] as const) if (want[col] != null && String(cur[col] ?? "") !== want[col]) changes.push({ startup_id: r.id, company: r.company, table: "startups", id: r.id, column: col, old: cur[col], now: want[col], source: r.source, quote: r.quote });
      }
      if (r.field === "round") {
        const m = r.after.match(/^([A-Za-z+\- ]+?) \$([\d.,]+)\s*([KMB])?\b/);
        if (!m || /^(?:Unknown|Other)$/.test(m[1])) continue;
        const amount = Number(m[2].replace(/,/g, "")) * (m[3] === "B" ? 1e9 : m[3] === "K" ? 1e3 : 1e6);
        const { data } = await db.from("funding_rounds").select("id, round_type, amount_raised, source_url").eq("startup_id", r.id);
        const same = ((data ?? []) as Array<{ id: string; round_type: string | null; amount_raised: number | null; source_url?: string | null }>).filter((x) => x.amount_raised != null && Math.abs(x.amount_raised - amount) / amount <= 0.01);
        if (!same.length) infos.push(`${r.company} · round ${m[1].trim()} $${m[2]}${m[3] ?? "M"}: the database has no round of this amount (rounds on file: ${((data ?? []) as Array<{ round_type: string | null; amount_raised: number | null }>).map((x) => `${x.round_type} ${x.amount_raised}`).join(", ") || "none"})`);
        for (const x of same) if (fold(x.round_type ?? "") === fold(m[1])) infos.push(`${r.company} · round ${m[1].trim()} $${m[2]}${m[3] ?? "M"}: the database already has this type (${x.round_type}) — type nothing to correct`);
        for (const x of same) if (!/^(?:Unknown|Other)$/i.test(x.round_type ?? "") && fold(x.round_type ?? "") !== fold(m[1])) infos.push(`${r.company} · round $${m[2]}${m[3] ?? "M"}: the database says ${x.round_type}, the gate says ${m[1].trim()} — not changed (only Unknown / Other are corrected)`);
        // The type stands on the source that states it: a round of the right type whose address is another page than the one whose quote says the type (Paradox: siliconangle for the amount, prnewswire for "Series C").
        for (const x of same) if (fold(x.round_type ?? "") === fold(m[1]) && r.source && x.source_url !== r.source && statedRoundLabels(r.quote).includes(m[1].trim())) changes.push({ startup_id: r.id, company: r.company, table: "funding_rounds", id: x.id, column: "source_url", old: x.source_url ?? null, now: r.source, source: r.source, quote: r.quote });
        for (const x of (data ?? []) as Array<{ id: string; round_type: string | null; amount_raised: number | null }>) {
          if (x.amount_raised == null || Math.abs(x.amount_raised - amount) / amount > 0.01) continue;
          if (fold(x.round_type ?? "") === fold(m[1]) || !/^(?:Unknown|Other)$/i.test(x.round_type ?? "")) continue;
          changes.push({ startup_id: r.id, company: r.company, table: "funding_rounds", id: x.id, column: "round_type", old: x.round_type, now: m[1].trim(), source: r.source, quote: r.quote });
        }
      }
    }
  }
  for (const i of infos) console.log(`ℹ️  ${i}`);
  for (let i = changes.length - 1; i >= 0; i--) if (skip.includes(`${changes[i].company}:${changes[i].column}`.toLowerCase())) { console.log(`• skipped (SKIP): ${changes[i].company} ${changes[i].column}`); changes.splice(i, 1); }
  if (!changes.length) { console.log("nothing in the database has a better value in the gate's reports."); return; }
  for (const c of changes) console.log(`${c.company} · ${c.table === "startups" ? c.column : `round ${c.column}`}: ${JSON.stringify(c.old)} ← ${JSON.stringify(c.now)}\n     ${c.source}${c.quote ? `\n     "${c.quote.slice(0, 160)}"` : ""}`);
  if (!WRITE) { console.log(`\n${changes.length} change(s) listed — nothing written. After the owner approves: APPROVED_BY=aviv DRY_RUN=false npx tsx scripts/correct_db.ts`); return; }
  const { data: run, error } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "correct_db", changes: changes.length } }).select("run_id").single();
  if (error || !run) { console.error(`could not register the run (${error?.message}) — nothing changed`); process.exit(1); }
  const runId = (run as { run_id: string }).run_id;
  for (const c of changes) {
    const rec = c.table === "startups"
      ? { startup_id: c.startup_id, field: c.column, old_value: c.old, new_value: c.now, source_url: c.source || null, run_id: runId }
      : roundUpdateChanges(c.startup_id, c.id, { [c.column]: c.old }, { [c.column]: c.now }, runId)[0];
    const ch = await db.from("field_changes").insert(rec);
    if (ch.error) { console.error(`✗ ${c.company} ${c.column}: field_changes not recorded (${ch.error.message}) — not changed`); continue; }
    const up = await db.from(c.table).update({ [c.column]: c.now }).eq("id", c.id);
    console.log(up.error ? `✗ ${c.company} ${c.column}: ${up.error.message}` : `✔ ${c.company} ${c.column} corrected`);
  }
  console.log(`recorded under run ${runId}`);
  // The proof: the rows as they are now.
  const ids = [...new Set(changes.filter((c) => c.table === "startups").map((c) => c.startup_id))];
  if (ids.length) {
    const { data } = await db.from("startups").select("name, status, acquired_by, exit_date").in("id", ids);
    console.log("\nstartups now:"); for (const x of (data ?? []) as Array<{ name: string; status: string | null; acquired_by: string | null; exit_date: string | null }>) console.log(`  ${x.name.padEnd(14)} status=${x.status} acquired_by=${x.acquired_by} exit_date=${x.exit_date}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
