#!/usr/bin/env node
/**
 * release_app_update.ts — ships an over-the-air update to the AlphaMap
 * mobile app via the self-hosted Capacitor live-update mechanism (see
 * supabase/functions/app-update-check and migration 20260914000000).
 *
 * Builds the web app, zips dist/, uploads the zip to the public
 * "app-bundles" Supabase Storage bucket, and inserts a row into
 * app_releases recording that version/channel/platform's bundle URL +
 * checksum. Installed apps pick it up on their next update check (app
 * foreground) — no rebuild, no reinstall, no store review, as long as
 * you're only changing web-layer content (not native permissions/plugins).
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (RLS on both
 * app_releases and the app-bundles bucket only allows service_role writes —
 * see the migration).
 *
 * Production deploys release automatically (scripts/vercel_release_app.ts);
 * this is for a hand-made release, e.g. a beta channel or a rollback.
 *
 * Usage:
 *   VERSION=1.0.1 npx tsx scripts/release_app_update.ts                    # dry run (default)
 *   VERSION=1.0.1 DRY_RUN=false npx tsx scripts/release_app_update.ts
 *   VERSION=1.0.1 CHANNEL=beta DRY_RUN=false npx tsx scripts/release_app_update.ts
 *   VERSION=1.0.1 PLATFORM=android DRY_RUN=false npx tsx scripts/release_app_update.ts
 *
 * VERSION is required and is an opaque identifier as far as the update
 * mechanism is concerned (see app-update-check's comment) — semver is just
 * a sane convention, not a requirement. Re-releasing the same
 * (version, platform, channel) fails on the migration's unique constraint
 * rather than silently overwriting a shipped release; bump VERSION instead.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execFileSync } from "child_process";
import { releaseAppBundle } from "./lib/appRelease";

// ── Bootstrap: load .env for local dev (same as bulk_enrich_all.ts) ───────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, "..");
const envPath = join(rootDir, ".env");
if (existsSync(envPath)) config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — see supabase/functions/app-update-check.");
  process.exit(1);
}

const DRY_RUN  = process.env.DRY_RUN !== "false"; // safe default: dry run
const VERSION  = process.env.VERSION?.trim();
const CHANNEL  = process.env.CHANNEL?.trim() || "production";
const PLATFORM = process.env.PLATFORM?.trim() || null; // null = universal (both platforms)
const NOTES    = process.env.NOTES?.trim() || null;

if (!VERSION) {
  console.error("❌  VERSION is required, e.g. VERSION=1.0.1 npx tsx scripts/release_app_update.ts");
  process.exit(1);
}
if (PLATFORM && PLATFORM !== "android" && PLATFORM !== "ios") {
  console.error(`❌  PLATFORM must be "android" or "ios" (or unset for both) — got "${PLATFORM}".`);
  process.exit(1);
}

async function main() {
  console.log("═".repeat(62));
  console.log("  AlphaMap App Release");
  console.log(`  VERSION=${VERSION} | CHANNEL=${CHANNEL} | PLATFORM=${PLATFORM ?? "all"} | DRY_RUN=${DRY_RUN}`);
  console.log("═".repeat(62) + "\n");

  console.log("Building web app (npm run build)…");
  execFileSync("npm", ["run", "build"], { cwd: rootDir, stdio: "inherit" });

  const res = await releaseAppBundle({
    supabase: createClient(SUPABASE_URL!, SUPABASE_KEY!),
    distDir: join(rootDir, "dist"),
    version: VERSION!,
    channel: CHANNEL,
    platform: PLATFORM as "android" | "ios" | null,
    notes: NOTES,
    dryRun: DRY_RUN,
    keep: 0,   // a hand release never prunes
  });
  console.log(`\n${res.status === "released" ? "✅  Released." : res.status === "dry_run" ? "Dry run done — re-run with DRY_RUN=false." : "Already released."}`);
}

main().catch((e) => {
  console.error("❌  Release failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
