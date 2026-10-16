// Core of an over-the-air release for the mobile app (Capacitor live update,
// supabase/functions/app-update-check, migration 20260914000000): zip a built
// dist/, upload it to the "app-bundles" bucket, record it in app_releases,
// and prune old bundles. Used by scripts/release_app_update.ts (by hand) and
// scripts/vercel_release_app.ts (automatically on every production deploy).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createWriteStream, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { ZipArchive } from "archiver";

export const BUCKET = "app-bundles";

/**
 * Files in dist/ the app never loads: the landing page's background videos
 * and the data CSVs that sit in public/ for import scripts. Nothing in src/
 * references them; leaving them out takes a bundle from ~18 MB to ~4 MB,
 * which every phone downloads on each update.
 */
export const EXCLUDE_FROM_BUNDLE = ["**/*.mp4", "**/*.csv"];

export interface ReleaseOptions {
  supabase: SupabaseClient;
  distDir: string;
  version: string;
  channel: string;
  platform: "android" | "ios" | null;
  notes: string | null;
  dryRun: boolean;
  /** Keep this many most recent releases of the channel/platform; delete older bundles and rows. 0 = keep all. */
  keep: number;
  log?: (msg: string) => void;
}

export interface ReleaseResult {
  status: "released" | "dry_run" | "already_released";
  bundleUrl?: string;
  sizeBytes: number;
  checksum: string;
  pruned: number;
}

async function zipDist(distDir: string, outZipPath: string): Promise<void> {
  const output = createWriteStream(outZipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const closed = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.glob("**/*", { cwd: distDir, ignore: EXCLUDE_FROM_BUNDLE, dot: false });
  await archive.finalize();
  await closed;
}

export async function releaseAppBundle(o: ReleaseOptions): Promise<ReleaseResult> {
  const log = o.log ?? console.log;
  const tmpDir = mkdtempSync(join(tmpdir(), "alphamap-release-"));
  const zipPath = join(tmpDir, `${o.version}.zip`);
  try {
    await zipDist(o.distDir, zipPath);
    const zip = readFileSync(zipPath);
    const checksum = createHash("sha256").update(zip).digest("hex");
    log(`Bundle: ${(zip.length / 1024 / 1024).toFixed(2)} MB, sha256 ${checksum}`);

    const objectPath = `${o.channel}/${o.platform ?? "all"}/${o.version}.zip`;
    if (o.dryRun) {
      log(`[DRY] Would upload ${BUCKET}/${objectPath} and record version ${o.version}`);
      return { status: "dry_run", sizeBytes: zip.length, checksum, pruned: 0 };
    }

    // A redeploy of the same commit: the version is already out.
    let existing = o.supabase.from("app_releases").select("id").eq("version", o.version).eq("channel", o.channel);
    existing = o.platform ? existing.eq("platform", o.platform) : existing.is("platform", null);
    const { data: found, error: findErr } = await existing.limit(1);
    if (findErr) throw new Error(`app_releases lookup failed: ${findErr.message}`);
    if (found && found.length) {
      log(`Version ${o.version} is already released — nothing to do.`);
      return { status: "already_released", sizeBytes: zip.length, checksum, pruned: 0 };
    }

    const { error: upErr } = await o.supabase.storage
      .from(BUCKET)
      .upload(objectPath, zip, { contentType: "application/zip", upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
    const bundleUrl = o.supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;

    const { error: insErr } = await o.supabase.from("app_releases").insert({
      version: o.version, platform: o.platform, channel: o.channel, bundle_url: bundleUrl, checksum, notes: o.notes,
    });
    if (insErr) throw new Error(`app_releases insert failed: ${insErr.message}`);
    log(`Released ${o.version}: ${bundleUrl}`);

    const pruned = o.keep > 0 ? await prune(o, log) : 0;
    return { status: "released", bundleUrl, sizeBytes: zip.length, checksum, pruned };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Deletes bundles and rows beyond the `keep` newest of this channel/platform. Apps only ever fetch the newest. */
async function prune(o: ReleaseOptions, log: (m: string) => void): Promise<number> {
  let q = o.supabase.from("app_releases").select("id, version").eq("channel", o.channel).order("created_at", { ascending: false });
  q = o.platform ? q.eq("platform", o.platform) : q.is("platform", null);
  const { data, error } = await q.range(o.keep, o.keep + 199);
  if (error || !data?.length) return 0;
  const paths = data.map((r) => `${o.channel}/${o.platform ?? "all"}/${r.version}.zip`);
  const { error: rmErr } = await o.supabase.storage.from(BUCKET).remove(paths);
  if (rmErr) { log(`Prune: could not delete old bundles (${rmErr.message}) — kept their rows.`); return 0; }
  const { error: delErr } = await o.supabase.from("app_releases").delete().in("id", data.map((r) => r.id));
  if (delErr) { log(`Prune: deleted bundles but not rows (${delErr.message}).`); return 0; }
  log(`Pruned ${data.length} old release(s).`);
  return data.length;
}
