#!/usr/bin/env node
/**
 * scripts/find_in_cache.ts — does a page we recorded say something? (READS ONLY, free; owner, 2026-11-24: the date of Qnami's purchase in Quantum Design's press release.)
 * Scans the web recordings (cache/http/*.json.gz, bodies as recorded) and the per-company search caches (cache/enrich_v2/*.json) for text that matches URL (the recorded address, a substring) and
 * FIND (a regular expression the text must hold), and prints the address and the sentences around each match.
 *   URL="QD_Qnami_Press_Release" FIND="May 28|28 May|2026-05-28|28\.05\.2026" npx tsx scripts/find_in_cache.ts
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { gunzipSync } from "zlib";
import { join } from "path";
const urlPart = (process.env.URL ?? "").toLowerCase(), find = process.env.FIND ? new RegExp(process.env.FIND, "gi") : null;
if (!urlPart || !find) { console.error('URL="<part of the address>" FIND="<regex>" are required.'); process.exit(2); }
const snippets = (text: string): string[] => { const out: string[] = []; for (const m of text.matchAll(find)) { const i = m.index ?? 0; out.push(text.slice(Math.max(0, i - 140), i + 160).replace(/\s+/g, " ")); if (out.length >= 4) break; } return out; };
let files = 0, hits = 0;
const httpDir = process.env.HTTP_RECORD_DIR ?? "cache/http";
if (existsSync(httpDir)) for (const f of readdirSync(httpDir)) {
  if (!f.endsWith(".json.gz")) continue; files++;
  try {
    const rec = JSON.parse(gunzipSync(readFileSync(join(httpDir, f))).toString("utf8")) as { finalUrl?: string; body?: string };
    const fu = (rec.finalUrl ?? "").toLowerCase(); const body = Buffer.from(rec.body ?? "", "base64").toString("utf8");
    if (!(fu.includes(urlPart) || body.slice(0, 600).toLowerCase().includes(urlPart))) continue;
    const sn = snippets(body); if (!sn.length) continue; hits++;
    console.log(`\nhttp recording ${f.slice(0, 12)} · ${rec.finalUrl ?? "(no final url)"}`); for (const s of sn) console.log(`   …${s}…`);
  } catch { /* not a readable recording */ }
}
const cacheDir = process.env.SEARCH_CACHE_DIR ?? "cache/enrich_v2";
if (existsSync(cacheDir)) for (const f of readdirSync(cacheDir)) {
  if (!f.endsWith(".json")) continue; files++;
  try {
    const raw = readFileSync(join(cacheDir, f), "utf8"); if (!raw.toLowerCase().includes(urlPart)) continue;
    const data = JSON.parse(raw) as Record<string, { value: unknown }>;
    for (const [k, v] of Object.entries(data)) { if (!k.toLowerCase().includes(urlPart)) continue; const sn = snippets(typeof v.value === "string" ? v.value : JSON.stringify(v.value)); if (!sn.length) continue; hits++; console.log(`\nsearch cache ${f} · ${k.slice(0, 140)}`); for (const s of sn) console.log(`   …${s}…`); }
  } catch { /* skip */ }
}
console.log(`\n${files} file(s) scanned · ${hits} matching recording(s).${hits ? "" : " Nothing recorded for that address says it (the page may not be in the recordings)."}`);
