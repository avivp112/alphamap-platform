#!/usr/bin/env node
/**
 * scripts/scan_bad_recordings.ts — how many web recordings are failures of the moment (READS ONLY, free; owner, 2026-11-26): timeouts and resets, 408 / 425 / 429 / 5xx, and 401 / 402 / 403 from a search provider
 * (lib/enrichment/recorder.ts isTransientRecording). The replay now treats them as missing (a MISS) and REPLAY_FILL fetches them again; nothing is deleted here.
 *   npx tsx scripts/scan_bad_recordings.ts
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { gunzipSync } from "zlib";
import { join } from "path";
import { isTransientRecording } from "../lib/enrichment/recorder.ts";
const dir = process.env.HTTP_RECORD_DIR ?? "cache/http";
if (!existsSync(dir)) { console.error(`${dir} does not exist`); process.exit(2); }
let total = 0, bad = 0, unreadable = 0;
const by = new Map<string, number>();
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".json.gz")) continue; total++;
  try {
    const rec = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8")) as { status?: number; error?: string; finalUrl?: string };
    let host = ""; try { host = new URL(rec.finalUrl ?? "").hostname; } catch { /* an error has no address */ }
    if (!isTransientRecording(rec, host)) continue; bad++;
    const kind = rec.error ? `error: ${rec.error.slice(0, 50)}` : `status ${rec.status}`; const k = `${host || "(host not recorded)"} · ${kind}`;
    by.set(k, (by.get(k) ?? 0) + 1);
  } catch { unreadable++; }
}
console.log(`${total} recording(s) in ${dir} · ${bad} transient failure(s) · ${unreadable} unreadable`);
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(5)} × ${k}`);
console.log(bad ? "\nThe replay counts these as missing (REPLAY MISS). To fetch them again: GO=1 MAX_COST=<n> npx tsx scripts/regression.ts fill <batch> (only these requests go to the web)." : "\nNone: no recording is a failure of the moment.");
