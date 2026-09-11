#!/usr/bin/env node
/**
 * backfill_news_images.ts — one-off backfill of news[].image_url for
 * articles that were enriched before that field existed on the schema.
 *
 * scripts/bulk_enrich_all.ts already populates image_url for NEW articles
 * going forward (via Tavily image search + Claude matching an image to a
 * specific article). This script instead fetches each article's own page
 * directly and reads its og:image/twitter:image share-preview tag — the
 * same signal Slack/Twitter use to unfurl link previews — for articles
 * that already exist in the DB without one. Node's own fetch() has no
 * CORS restriction (unlike a browser) and follows redirects natively, so
 * this reaches articles a browser-side or sandboxed-SQL fetch can't.
 *
 * Write strategy: fill-null by default — an article that already has an
 * image_url is left untouched; only articles missing one are attempted,
 * and only ones where a real image was actually found get written.
 *
 * Set REPLACE_EXISTING=true to also re-check articles that already have an
 * image_url — useful after bulk_enrich_all.ts (before its OpenGraph-first
 * fix) saved a Serper News search-result thumbnail as image_url, which
 * looks visibly blurry once stretched to card width in the News tab. In
 * this mode every article with a url is re-fetched and its image_url is
 * REPLACED with the freshly-fetched og:image/twitter:image — but only when
 * one is actually found; a failed fetch (bot-blocked, no og:image, etc.)
 * leaves the existing image_url untouched rather than blanking it out.
 *
 * Usage:
 *   npx tsx scripts/backfill_news_images.ts                    # dry run (default)
 *   DRY_RUN=false npx tsx scripts/backfill_news_images.ts
 *   REPLACE_EXISTING=true DRY_RUN=false npx tsx scripts/backfill_news_images.ts
 *   …re-run the same command as many times as you like — already-filled
 *   articles are skipped (unless REPLACE_EXISTING=true), so it's always
 *   safe to stop and resume.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap: load .env for local dev (same as bulk_enrich_all.ts) ───────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// This project's env vars are SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Node
// scripts) and VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (the Vite frontend)
// — the NEXT_PUBLIC_* names are accepted too as a portable fallback, since
// this isn't a Next.js project. The service-role key is strongly preferred:
// writing to startups.news likely requires bypassing RLS, since the app's
// anon client has read-only access to it.
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "❌  Missing Supabase credentials — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
    "(preferred) in .env, or VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY / NEXT_PUBLIC_* as a fallback.",
  );
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️  No SUPABASE_SERVICE_ROLE_KEY found — falling back to the anon key. " +
    "Writes will likely fail under RLS unless the anon role has UPDATE on startups.\n",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Configuration ─────────────────────────────────────────────────────────────
const DRY_RUN          = process.env.DRY_RUN !== "false"; // safe default: dry run
const REPLACE_EXISTING = process.env.REPLACE_EXISTING === "true"; // safe default: fill-null only
const BATCH_SIZE        = Number(process.env.BATCH_SIZE        ?? 25);
const FETCH_TIMEOUT_MS  = Number(process.env.FETCH_TIMEOUT_MS  ?? 5_000);
const COMPANY_DELAY_MS  = Number(process.env.COMPANY_DELAY_MS  ?? 200); // politeness gap between companies
const MAX_HTML_BYTES    = 300_000; // meta tags live in <head> — no need to read a whole article body

// ── Types ─────────────────────────────────────────────────────────────────────
interface NewsItem {
  title: string;
  url: string;
  source?: string | null;
  published_date?: string | null;
  summary?: string | null;
  image_url?: string | null;
}

interface StartupRow {
  id: string;
  name: string;
  news: NewsItem[] | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── og:image / twitter:image extraction ────────────────────────────────────────
// Matches <meta property="og:image" content="..."> (or twitter:image via
// name=) in either attribute order, single- or double-quoted.
function extractMetaContent(html: string, key: "property" | "name", value: string): string | null {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrThenContent = new RegExp(`<meta[^>]+${key}=["']${escaped}["'][^>]*content=["']([^"']+)["']`, "i");
  const contentThenAttr = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${key}=["']${escaped}["']`, "i");
  return html.match(attrThenContent)?.[1] ?? html.match(contentThenAttr)?.[1] ?? null;
}

async function fetchArticleImage(articleUrl: string): Promise<string | null> {
  let target = articleUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaMapBot/1.0; +https://alphamap.app)",
        "Accept": "text/html",
      },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    // Stream-cap the read — no need to buffer a whole (sometimes multi-MB)
    // article page just to find a <head> meta tag.
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytes += value.byteLength;
      }
      reader.cancel().catch(() => {});
    } else {
      html = (await res.text()).slice(0, MAX_HTML_BYTES);
    }

    const raw = extractMetaContent(html, "property", "og:image")
      ?? extractMetaContent(html, "name", "twitter:image")
      ?? extractMetaContent(html, "property", "twitter:image");
    if (!raw) return null;

    // Some sites use a protocol-relative or site-relative image URL —
    // resolve against the article's own (post-redirect) URL.
    return new URL(raw, res.url).toString();
  } catch {
    // Bot-blocked, timed out, DNS failure, etc. — best-effort, same as a
    // search that comes back empty; just move on to the next article.
    return null;
  }
}

// ── DB: fetch every startup with a non-empty news array ────────────────────────
// Paginated: PostgREST caps a single response at 1000 rows, which would
// silently hide companies past the first 1000 on a large table.
async function fetchAllStartupsWithNews(): Promise<StartupRow[]> {
  const PAGE = 1000;
  const all: StartupRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("startups")
      .select("id, name, news")
      .not("news", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("❌  Failed to fetch startups:", error.message);
      process.exit(1);
    }
    const batch = (data ?? []) as StartupRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(62));
  console.log("  News Image Backfill");
  console.log(`  DRY_RUN=${DRY_RUN} | REPLACE_EXISTING=${REPLACE_EXISTING} | BATCH_SIZE=${BATCH_SIZE} | FETCH_TIMEOUT_MS=${FETCH_TIMEOUT_MS}`);
  console.log("═".repeat(62) + "\n");
  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to write changes to the database.\n");
  if (REPLACE_EXISTING) console.log("⚠️  REPLACE_EXISTING=true — articles that already have an image_url will be re-fetched and overwritten when a new one is found.\n");

  const all = await fetchAllStartupsWithNews();
  const needsWork = all.filter(
    (row) => Array.isArray(row.news) && row.news.some((n) => n?.url && (REPLACE_EXISTING || !n.image_url)),
  );

  console.log(REPLACE_EXISTING
    ? `Found ${needsWork.length} companies with at least one news article to re-check (of ${all.length} total with news).\n`
    : `Found ${needsWork.length} companies with at least one news article missing an image (of ${all.length} total with news).\n`);
  if (needsWork.length === 0) {
    console.log("Nothing to do — every article already has an image_url (or none have a url at all).");
    return;
  }

  let companiesUpdated    = 0;
  let companiesFailed     = 0;
  let articlesAttempted   = 0;
  let articlesImageFound  = 0;

  const totalBatches = Math.ceil(needsWork.length / BATCH_SIZE);
  for (let i = 0; i < needsWork.length; i += BATCH_SIZE) {
    const batch = needsWork.slice(i, i + BATCH_SIZE);
    console.log(`── Batch ${Math.floor(i / BATCH_SIZE) + 1}/${totalBatches} (${batch.length} companies) ──`);

    for (const row of batch) {
      const items = row.news!;
      let changed = false;
      let foundThisCompany = 0;

      const updatedItems = await Promise.all(
        items.map(async (item) => {
          if (!item.url) return item;
          if (item.image_url && !REPLACE_EXISTING) return item;
          articlesAttempted++;
          const img = await fetchArticleImage(item.url);
          // A failed/empty fetch never blanks an existing image_url — it
          // just means this article keeps whatever it already had.
          if (img && img !== item.image_url) {
            changed = true;
            foundThisCompany++;
            articlesImageFound++;
            return { ...item, image_url: img };
          }
          return item;
        }),
      );

      if (changed) {
        if (!DRY_RUN) {
          const { error } = await supabase.from("startups").update({ news: updatedItems }).eq("id", row.id);
          if (error) {
            console.warn(`  ⚠️  ${row.name}: found ${foundThisCompany} image(s) but update failed — ${error.message}`);
            companiesFailed++;
          } else {
            console.log(`  ✅  ${row.name}: ${foundThisCompany} image(s) found and saved`);
            companiesUpdated++;
          }
        } else {
          console.log(`  ✅  ${row.name}: ${foundThisCompany} image(s) found [DRY — not saved]`);
          companiesUpdated++;
        }
      } else {
        console.log(`  ▫️  ${row.name}: no image found for any missing article`);
      }

      await sleep(COMPANY_DELAY_MS);
    }
    console.log("");
  }

  console.log("═".repeat(62));
  console.log("BACKFILL SUMMARY");
  console.log("═".repeat(62));
  console.log(`  Companies processed:         ${needsWork.length}`);
  console.log(`  Companies updated:           ${companiesUpdated}${DRY_RUN ? "  (dry run — nothing written)" : ""}`);
  if (companiesFailed > 0) console.log(`  Companies failed to save:    ${companiesFailed}`);
  console.log(`  Articles checked:            ${articlesAttempted}`);
  console.log(`  Articles with image found:   ${articlesImageFound}`);
  if (DRY_RUN) console.log("\nℹ️  DRY RUN — rerun with DRY_RUN=false to apply these writes.");
  console.log("═".repeat(62) + "\n");
}

main().catch((e) => {
  console.error("❌  Unhandled error:", e);
  process.exit(1);
});
