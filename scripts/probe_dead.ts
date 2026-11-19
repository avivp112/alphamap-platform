#!/usr/bin/env node
/**
 * scripts/probe_dead.ts — which of the addresses a run could not read are dead (the name does not resolve)? One DNS lookup each, free. The result goes to cache/read_failures.json, which a REPLAY reads
 * (owner, 2026-11-19: nine dead sites came back as fetch_failed in the replay, whose recordings had lost the cause of the failed fetch). A live run writes the same file by itself.
 *   npx tsx scripts/probe_dead.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { lookup } from "dns/promises";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
const rows = b.filter((r) => /fetch_failed|website_dead|website_unreachable|domain_unresolved|error/.test(r[h.indexOf("why")]) && r[h.indexOf("website")]);
const file = "cache/read_failures.json";
const store: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
(async () => {
  for (const r of rows) {
    let host = ""; try { host = new URL(/^https?:/.test(r[h.indexOf("website")]) ? r[h.indexOf("website")] : `https://${r[h.indexOf("website")]}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    try { await lookup(host); console.log(`${r[h.indexOf("company")].padEnd(28)} ${host.padEnd(30)} resolves — not marked`); }
    catch (e) { const code = (e as { code?: string }).code ?? ""; if (code === "ENOTFOUND") { store[host] = "dead"; console.log(`${r[h.indexOf("company")].padEnd(28)} ${host.padEnd(30)} DEAD (ENOTFOUND)`); } else console.log(`${r[h.indexOf("company")].padEnd(28)} ${host.padEnd(30)} ${code || "no answer"} — not marked`); }
  }
  mkdirSync("cache", { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 1));
  console.log(`\n${file}: ${Object.keys(store).length} site(s). A REPLAY of the batch now tells dead from failed.`);
})();
