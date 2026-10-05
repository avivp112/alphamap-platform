#!/usr/bin/env node
/**
 * scripts/backfill_round_dates.ts — dates funding rounds that were stored
 * without an announcement_date, so the Funding Timeline chart (which needs
 * at least two rounds with a date and an amount) appears for companies
 * already enriched.
 *
 * For each undated round that has a source_url, the source article is read
 * via Jina Reader (free — no Claude call) and dated with the same rule the
 * enrichment pipeline uses (lib/enrichment/assemble.ts
 * announcementDateFromSource): only when the article itself announces THIS
 * round (a raise verb plus the round's type or amount in its title/lead),
 * using the article's own publication date. An article that merely mentions
 * an older round is never used. Rounds that can't be dated stay undated.
 *
 *   npx tsx scripts/backfill_round_dates.ts                  # dry run (default)
 *   DRY_RUN=false npx tsx scripts/backfill_round_dates.ts    # write dates
 *   LIMIT=50 DELAY_MS=3000 ...                               # batch size / pacing
 */

import { pathToFileURL } from "url";
import { initV1Context, supabase } from "./bulk_enrich_all.ts";
import { announcementDateFromSource } from "../lib/enrichment/assemble.ts";
import { cleanArticleText } from "../lib/enrichment/articles.ts";
import type { LabeledSource } from "../lib/enrichment/sources.ts";

const DRY_RUN = process.env.DRY_RUN !== "false";
const LIMIT = Number(process.env.LIMIT ?? 100_000);
// Jina's free tier is rate-limited; ~3s between reads stays well inside it.
const DELAY_MS = Number(process.env.DELAY_MS ?? 3000);

interface UndatedRound { id: string; startup_id: string; round_type: string | null; amount_raised: number | null; source_url: string }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readArticle(url: string): Promise<{ title?: string; content: string } | null> {
  try {
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const raw = await res.text();
    const title = raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    return { title, content: cleanArticleText(raw) };
  } catch {
    return null;
  }
}

async function main() {
  await initV1Context();
  const rounds: UndatedRound[] = [];
  for (let from = 0; rounds.length < LIMIT; from += 1000) {
    const { data, error } = await supabase
      .from("funding_rounds")
      .select("id, startup_id, round_type, amount_raised, source_url")
      .is("announcement_date", null)
      .not("source_url", "is", null)
      .order("created_at")
      .range(from, from + 999);
    if (error) { console.error(`❌  fetch failed: ${error.message}`); process.exit(1); }
    rounds.push(...((data ?? []) as UndatedRound[]));
    if (!data || data.length < 1000) break;
  }
  const queue = rounds.slice(0, LIMIT);
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}${queue.length} undated round(s) with a source URL.\n`);

  let dated = 0, unreadable = 0, notAnnouncement = 0;
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    const article = await readArticle(r.source_url);
    if (!article) {
      unreadable++;
      console.log(`  [${i + 1}/${queue.length}] ${r.round_type ?? "?"} — source unreadable: ${r.source_url}`);
    } else {
      const source: LabeledSource = {
        url: r.source_url, title: article.title, content: article.content,
        provider: "jina", query_label: "backfill", source_id: "S1", source_type: "news",
      };
      const iso = announcementDateFromSource({
        round_type: r.round_type ?? "Other",
        amount_raised: r.amount_raised != null ? { value: r.amount_raised, source_id: "S1", evidence_quote: "" } : undefined,
      }, source);
      if (!iso) {
        notAnnouncement++;
        console.log(`  [${i + 1}/${queue.length}] ${r.round_type ?? "?"} — not this round's announcement, left undated: ${r.source_url}`);
      } else {
        dated++;
        console.log(`  [${i + 1}/${queue.length}] ${r.round_type ?? "?"} → ${iso}  (${r.source_url})`);
        if (!DRY_RUN) {
          const { error } = await supabase.from("funding_rounds").update({ announcement_date: iso }).eq("id", r.id).is("announcement_date", null);
          if (error) console.warn(`    ⚠️  update failed: ${error.message}`);
        }
      }
    }
    if (i < queue.length - 1) await sleep(DELAY_MS);
  }

  if (!DRY_RUN && dated > 0) {
    const { error } = await supabase.rpc("refresh_startups_search");
    console.log(error ? `⚠️  startups_search refresh failed: ${error.message}` : "🔄  startups_search refreshed");
  }
  console.log(`\nDated ${dated} | not an announcement ${notAnnouncement} | unreadable ${unreadable}${DRY_RUN ? "  (dry run — nothing written; DRY_RUN=false to apply)" : ""}`);
}

const isDirectlyInvoked = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectlyInvoked) main().catch((e) => { console.error("💥", e); process.exit(1); });
