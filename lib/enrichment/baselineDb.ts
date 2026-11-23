/**
 * lib/enrichment/baselineDb.ts — a baseline's values against the database (owner, 2026-11-23: the baselines of batches 5–7 were made from the recordings with the code of the day, not from what the runs wrote).
 * Each baseline value is "present" (the database holds it), "different" (the field holds another value) or "absent" (the field/entry is empty or missing). A company name that two startups share
 * (Canopy) is looked up in every one of them. Values the check cannot judge ("notChecked") stay. Reads only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWritten, type DbCompany, type ReportRow } from "./writtenCheck.ts";
import { isCoreField } from "./tiers.ts";
import type { BaselineValue } from "./regressionGate.ts";

export interface Classified { value: BaselineValue; state: "present" | "different" | "absent" | "notChecked"; db?: string }
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const isStatus = (v: string) => /^(acquired|majority_acquired|closed)$/i.test(v.trim());
const isDate = (v: string) => /^\d{4}-\d{2}(-\d{2})?$/.test(v.trim());

function scalar(field: string, c: DbCompany): string | null {
  switch (field) {
    case "hq_city": return c.city ?? null;
    case "hq_country": return c.country ?? null;
    case "founded_year": return c.founded_year == null ? null : String(c.founded_year);
    case "description": return c.description ?? null;
    case "sector": return c.sector_name ?? c.industry ?? null;
    case "acquired": return c.status === "active" ? null : `${c.status} / ${c.acquired_by} / ${c.exit_date}`;
    default: return null;
  }
}

export async function classifyBaseline(db: SupabaseClient, values: BaselineValue[]): Promise<{ rows: Classified[]; ambiguous: string[] }> {
  const vals = values.filter((v) => isCoreField(v.field) && v.field !== "(nothing)");
  const names = [...new Set(vals.map((v) => v.company))];
  const { data: secs } = await db.from("sectors").select("id, name");
  const sectorName = new Map(((secs ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
  const byName = new Map<string, DbCompany[]>();
  for (let i = 0; i < names.length; i += 40) {
    const { data, error } = await db.from("startups").select("id, name, city, country, founded_year, founding_country, employee_range, employee_count, description, industry, sector_id, offices, founders, leadership, competitors, news, patents, status, acquired_by, exit_date").in("name", names.slice(i, i + 40));
    if (error) throw new Error(`startups: ${error.message}`);
    for (const s of (data ?? []) as Array<Record<string, unknown>>) {
      const c = { ...(s as object), sector_name: sectorName.get(s.sector_id as string) ?? null, rounds: [], headcount: [] } as unknown as DbCompany & { name: string };
      const k = fold(c.name); byName.set(k, [...(byName.get(k) ?? []), c]);
    }
  }
  const all = [...byName.values()].flat(), byId = new Map(all.map((c) => [c.id, c]));
  for (let i = 0; i < all.length; i += 50) {
    const ids = all.slice(i, i + 50).map((c) => c.id);
    const { data: rs } = await db.from("funding_rounds").select("startup_id, round_type, amount_raised, announcement_date").in("startup_id", ids);
    for (const r of (rs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(r.startup_id)?.rounds.push(r as never);
    const { data: hs } = await db.from("headcount_history").select("startup_id, employee_count, snapshot_date").in("startup_id", ids);
    for (const h of (hs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(h.startup_id)?.headcount.push(h as never);
  }
  const rows: Classified[] = [];
  for (const v of vals) {
    const cands = byName.get(fold(v.company)) ?? [];
    if (!cands.length) { rows.push({ value: v, state: "absent", db: "[company not found by name]" }); continue; }
    let present = false, judged = false;
    for (const c of cands) {
      if (v.field === "acquired") {
        const x = v.value.trim(); judged = true;
        if (isStatus(x) ? (c.status ?? "").toLowerCase() === x.toLowerCase() : isDate(x) ? (c.exit_date ?? "").startsWith(x) : fold(c.acquired_by ?? "") === fold(x) || fold(c.acquired_by ?? "").includes(fold(x)) || fold(x).includes(fold(c.acquired_by ?? "~"))) { present = true; break; }
        continue;
      }
      const w = isWritten({ company_id: c.id, company: v.company, field: v.field, after: v.value } as ReportRow, c);
      if (w === "not_checked") continue;
      judged = true; if (w === "yes") { present = true; break; }
    }
    if (present) { rows.push({ value: v, state: "present" }); continue; }
    if (!judged) { rows.push({ value: v, state: "notChecked" }); continue; }
    const held = cands.map((c) => scalar(v.field, c)).find((x) => x != null && x !== "");
    rows.push({ value: v, state: held ? "different" : "absent", db: held ?? undefined });
  }
  return { rows, ambiguous: [...byName.entries()].filter(([, c]) => c.length > 1).map(([k]) => k) };
}
