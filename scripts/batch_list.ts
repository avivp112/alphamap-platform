#!/usr/bin/env node
/**
 * scripts/batch_list.ts — the companies of pilot_batch_<N>.json as name, website, country (owner, round 10), and batch<N>_companies.csv.
 *   N=6 npx tsx scripts/batch_list.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const N = process.env.N;
if (!N) { console.error("N=<batch number> is required."); process.exit(1); }
const file = `pilot_batch_${N}.json`;
if (!existsSync(file)) { console.error(`${file} does not exist (N=${N} GROUP=empty SIZE=25 npx tsx scripts/pilot_batch_pick.ts creates it).`); process.exit(1); }
const b = JSON.parse(readFileSync(file, "utf8")) as unknown;
const list = (Array.isArray(b) ? b : (b as { companies?: unknown[]; batch?: unknown[] }).companies ?? (b as { batch?: unknown[] }).batch ?? []) as Array<{ id?: string } | string>;
const ids = list.map((c) => (typeof c === "string" ? c : c.id ?? "")).filter(Boolean);
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.from("startups").select("id, name, website, country, city, description").in("id", ids);
if (error) { console.error(error.message); process.exit(1); }
const byId = new Map(((data ?? []) as Array<{ id: string; name: string; website: string | null; country: string | null; city: string | null; description: string | null }>).map((r) => [r.id, r]));
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const lines = ["n,name,website,country,id,has_description"];
ids.forEach((id, i) => {
  const r = byId.get(id);
  console.log(`${String(i + 1).padStart(2)}. ${r?.name ?? "?"}  |  ${r?.website ?? "no website"}  |  ${r?.country ?? "no country"}${(r?.description ?? "").trim() ? "  |  has a description" : ""}`);
  lines.push([String(i + 1), r?.name ?? "", r?.website ?? "", r?.country ?? "", id, (r?.description ?? "").trim() ? "yes" : "no"].map(q).join(","));
});
writeFileSync(`batch${N}_companies.csv`, "﻿" + lines.join("\r\n") + "\r\n");
console.log(`\n${ids.length} company(ies) — batch${N}_companies.csv`);
setTimeout(() => process.exit(0), 500).unref();
