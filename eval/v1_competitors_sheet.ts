#!/usr/bin/env node
/**
 *   npx tsx eval/v1_competitors_sheet.ts                  # 30 random companies, up to 3 competitors each
 *   SIZE=30 PER_COMPANY=3 SEED=7 npx tsx eval/v1_competitors_sheet.ts
 * Reads startups.competitors (v1's, with its "how it competes" explanation) — a read only: no run, no
 * search, no model, no cost. Writes eval/review/v1_competitors_review.csv, then:
 *   SHEET=v1competitors npx tsx eval/review_sheet.ts                      # numbered rows
 *   SHEET=v1competitors MARK="1-20=y,21=n" WRITE=true npx tsx eval/review_sheet.ts
 * y = a real competitor of that company, n = not. The summary line gives v1's precision.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { toCsv } from "./reviewSheet.ts";
import { sampleV1Competitors, V1_COMPETITOR_COLUMNS, type V1Company } from "./v1Competitors.ts";

const dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(dir, "..", ".env"))) config({ path: join(dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (a read)."); process.exit(1); }
const size = Number(process.env.SIZE ?? 30), perCompany = Number(process.env.PER_COMPANY ?? 3), seed = Number(process.env.SEED ?? Date.now() % 100000);

(async () => {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const all: V1Company[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select("id, name, website, competitors").not("competitors", "is", null).range(from, from + 999);
    if (error) throw error;
    all.push(...((data ?? []) as V1Company[]));
    if (!data || data.length < 1000) break;
  }
  const rows = sampleV1Competitors(all, { size, perCompany, seed });
  console.log(`${all.length} companies carry competitors; ${new Set(rows.map((r) => r.company_id)).size} drawn at random (seed ${seed}), ${rows.length} competitor row(s).`);
  const file = join(dir, "review", "v1_competitors_review.csv");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, toCsv([...V1_COMPETITOR_COLUMNS], rows));
  console.log(`📝  ${file}\nNow: SHEET=v1competitors npx tsx eval/review_sheet.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
