#!/usr/bin/env node
/**
 * scripts/news_event_audit.ts — the news of the written batches, read from the database (owner, 2026-11-19: Humi's "to be acquired" of 2026-05-20, taken from the page's code, was written beside the
 * announcement of 2025-01-08). REPORT ONLY: it lists
 *   1. an acquisition that two or more news items state for the same buyer with different dates (the later ones are the same purchase),
 *   2. other news of one company that are the same event (sameNewsEvent) on different days.
 * Nothing is deleted. A removal is a separate, explicit step: REMOVE="Company|url-part" DRY_RUN=false (the item goes through undo_value's list removal and is recorded in field_changes).
 *
 *   BATCHES=5,6,7 npx tsx scripts/news_event_audit.ts
 *   REMOVE="Humi|unleash.ai" npx tsx scripts/news_event_audit.ts            # shows what would go
 *   REMOVE="Humi|unleash.ai" DRY_RUN=false npx tsx scripts/news_event_audit.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { acquirerIn, buyerKey } from "../lib/enrichment/acquisition.ts";
import { sameNewsEvent } from "../lib/enrichment/newsRelevance.ts";
import { removeFromList } from "../lib/enrichment/undoValue.ts";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const DRY_RUN = process.env.DRY_RUN !== "false";
type N = { title: string; url?: string; published_date?: string | null };

const idsOf = (n: number): string[] => {
  const f = `pilot_batch_${n}.json`; if (!existsSync(f)) { console.error(`${f} is missing`); process.exit(1); }
  const j = JSON.parse(readFileSync(f, "utf8")) as { companies?: Array<{ id: string }> } | Array<{ id: string }>;
  return (Array.isArray(j) ? j : j.companies ?? []).map((c) => c.id);
};

(async () => {
  if (process.env.REMOVE) {
    const [co, part] = process.env.REMOVE.split("|");
    const { data: rows } = await db.from("startups").select("id, name, news").ilike("name", co);
    for (const r of (rows ?? []) as Array<{ id: string; name: string; news: N[] | null }>) {
      const item = (r.news ?? []).find((x) => (x.url ?? "").includes(part));
      if (!item) { console.log(`• ${r.name}: no news item with "${part}"`); continue; }
      console.log(`${DRY_RUN ? "Would remove" : "Removing"} ${r.name}: ${item.published_date} — ${item.title}  (${item.url})`);
      if (DRY_RUN) continue;
      const { next } = removeFromList("news", r.news as never, `${item.published_date} — ${item.title}`, item.url ?? null);
      const { data: run } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "remove_news", company: r.name, url: item.url } }).select("run_id").single();
      const runId = (run as { run_id: string } | null)?.run_id; if (!runId) { console.error("could not register the run — nothing changed"); process.exit(1); }
      const ch = await db.from("field_changes").insert({ startup_id: r.id, field: "news", old_value: r.news, new_value: next, source_url: item.url, run_id: runId });
      if (ch.error) { console.error(`field_changes not recorded (${ch.error.message}) — nothing changed`); process.exit(1); }
      await db.from("startups").update({ news: next }).eq("id", r.id);
      await db.from("field_provenance").delete().eq("startup_id", r.id).eq("field", `news.${item.title.slice(0, 120)}`);
      console.log(`  ✔ removed; recorded under run ${runId}`);
    }
    return;
  }
  const batches = (process.env.BATCHES ?? "5,6,7").split(",").map(Number);
  const lines: string[] = ["batch,company,kind,item_a,item_b"]; let n = 0;
  for (const b of batches) {
    const ids = idsOf(b);
    for (let i = 0; i < ids.length; i += 50) {
      const { data } = await db.from("startups").select("id, name, news").in("id", ids.slice(i, i + 50));
      for (const r of (data ?? []) as Array<{ id: string; name: string; news: N[] | null }>) {
        const news = (r.news ?? []).filter((x) => x.published_date);
        const byBuyer = new Map<string, N[]>();
        for (const x of news) { const h = acquirerIn(x.title, r.name); if (h) (byBuyer.get(buyerKey(h.acquirer)) ?? byBuyer.set(buyerKey(h.acquirer), []).get(buyerKey(h.acquirer))!).push(x); }
        const fmt = (x: N) => `${x.published_date} — ${x.title} (${x.url})`;
        for (const [, list] of byBuyer) if (new Set(list.map((x) => x.published_date)).size > 1) { n++; const s = [...list].sort((a, c) => String(a.published_date).localeCompare(String(c.published_date))); console.log(`batch ${b} · ${r.name} · the same purchase, ${list.length} items on different dates:\n   keep  ${fmt(s[0])}\n${s.slice(1).map((x) => `   later ${fmt(x)}`).join("\n")}`); lines.push([b, r.name, "same purchase, different dates", fmt(s[0]), s.slice(1).map(fmt).join(" || ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")); }
        for (let x = 0; x < news.length; x++) for (let y = x + 1; y < news.length; y++) {
          if (news[x].published_date === news[y].published_date) continue;
          if (acquirerIn(news[x].title, r.name) && acquirerIn(news[y].title, r.name)) continue;
          if (sameNewsEvent({ title: news[x].title, url: news[x].url ?? "", published_date: news[x].published_date }, { title: news[y].title, url: news[y].url ?? "", published_date: news[y].published_date })) { n++; console.log(`batch ${b} · ${r.name} · the same event on two dates:\n   ${fmt(news[x])}\n   ${fmt(news[y])}`); lines.push([b, r.name, "same event, different dates", fmt(news[x]), fmt(news[y])].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")); }
        }
      }
    }
  }
  writeFileSync("news_event_audit.csv", "﻿" + lines.join("\r\n") + "\r\n");
  console.log(n ? `\n${n} event(s) listed — news_event_audit.csv. Nothing was changed.` : "\nno event appears twice with different dates.");
})().catch((e) => { console.error(e); process.exit(1); });
