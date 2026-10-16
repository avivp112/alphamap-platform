#!/usr/bin/env node
/**
 * vercel_release_app.ts — runs after `npm run build` in Vercel's build
 * (vercel.json buildCommand) and ships the same dist/ to the mobile app as an
 * over-the-air update, so every production deploy reaches the website AND
 * the app. No GitLab compute minutes: it runs inside Vercel's build.
 *
 * Skips (and never fails the website deploy — vercel.json runs it as
 * `... || true`, and this script itself always exits 0):
 *   - preview deployments (VERCEL_ENV !== "production");
 *   - a commit whose SUBJECT LINE contains [skip-app] (a website-only change);
 *   - when SUPABASE_SERVICE_ROLE_KEY is not set in Vercel's environment.
 *
 * Version: web-<YYYYMMDD>-<commit sha 7>. Keeps the 5 newest releases.
 * Needs in Vercel (Production): SUPABASE_SERVICE_ROLE_KEY, plus the
 * VITE_SUPABASE_URL the website build already uses.
 */

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { releaseAppBundle } from "./lib/appRelease";

const log = (m: string) => console.log(`[app-release] ${m}`);

export function releaseVersion(sha: string, now: Date): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `web-${d}-${(sha || "local").slice(0, 7)}`;
}

export function skipReason(env: Record<string, string | undefined>): string | null {
  if (env.VERCEL_ENV !== "production") return `not a production deploy (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})`;
  // The subject line only: a commit body that merely mentions the marker
  // (as the commit introducing it did, 2026-10-16) must not skip the release.
  if ((env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n")[0].includes("[skip-app]")) return "commit marked [skip-app]";
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel (Settings → Environment Variables → Production)";
  if (!(env.SUPABASE_URL || env.VITE_SUPABASE_URL)) return "no SUPABASE_URL / VITE_SUPABASE_URL";
  return null;
}

async function main() {
  const skip = skipReason(process.env);
  if (skip) { log(`skipped: ${skip}`); return; }
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const version = releaseVersion(process.env.VERCEL_GIT_COMMIT_SHA ?? "", new Date());
  const res = await releaseAppBundle({
    supabase: createClient((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!, process.env.SUPABASE_SERVICE_ROLE_KEY!),
    distDir: join(rootDir, "dist"),
    version,
    channel: "production",
    platform: null,
    notes: (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n")[0].slice(0, 200) || null,
    dryRun: false,
    keep: 5,
    log,
  });
  log(`${res.status} ${version} (${(res.sizeBytes / 1024 / 1024).toFixed(1)} MB${res.pruned ? `, pruned ${res.pruned}` : ""})`);
}

// Only when run directly, so the helpers above can be imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => log(`FAILED (website deploy unaffected): ${e instanceof Error ? e.message : String(e)}`));
}
