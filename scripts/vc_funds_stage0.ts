#!/usr/bin/env node
/**
 * scripts/vc_funds_stage0.ts — funds project, stage 0 (READ ONLY, no cost, writes nothing to the database).
 *
 * Reads every investor name that already appears in a round (funding_rounds.lead_investor / investors[]), the
 * investors table and — when given — Aviv's input list, and writes CSVs to cache/vc_funds/ (git-ignored):
 *
 *   investor_names.csv        one row per exact_key: raw variants, rounds, rounds led, startups, first/last date
 *   ambiguous_clusters.csv    loose_keys shared by several exact_keys ("Index" / "Index Ventures" / "Index Capital") — a human decides
 *   list_coverage.csv         per entity of the input list: found in rounds? how many? (see MATCH below)
 *   frequent_not_in_list.csv  names with many rounds that are not on the list
 *
 *   INPUT=funds_input.csv  npx tsx scripts/vc_funds_stage0.ts
 *
 * MATCH (rule 7): an input entity is matched to rounds only through its DOMAIN: the domain is looked up in the investors
 * table (investors.website) and that row's exact name key is counted. A name-only hit is reported as "name_only_estimate",
 * never as a match. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (select only).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { investorKey, hostOf, ambiguousClusters, splitLeadInvestors, looksLikePerson, looksLikeAngelGroup } from "../lib/funds/investorNames.ts";

if (existsSync(".env")) config({ path: ".env" });
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) { console.error(`Missing env var: ${k}`); process.exit(1); }
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OUT = "cache/vc_funds"; mkdirSync(OUT, { recursive: true });
const MIN_ROUNDS_UNLISTED = Number(process.env.MIN_ROUNDS_UNLISTED ?? 5);

async function all<T>(table: string, cols: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
const csv = (rows: Record<string, unknown>[]): string => {
  if (!rows.length) return "";
  const h = Object.keys(rows[0]);
  const q = (v: unknown) => { const s = v == null ? "" : Array.isArray(v) ? v.join(" | ") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [h.join(","), ...rows.map((r) => h.map((c) => q(r[c])).join(","))].join("\n") + "\n";
};
const parseCsv = (t: string): string[][] => { // minimal RFC4180
  const out: string[][] = []; let row: string[] = [], f = "", inq = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (inq) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') inq = false; else f += c; }
    else if (c === '"') inq = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(Boolean)) out.push(row); row = []; }
    else f += c; }
  if (f || row.length) { row.push(f); if (row.some(Boolean)) out.push(row); }
  return out;
};

interface Round { id: string; startup_id: string; lead_investor: string | null; investors: string[] | null; announcement_date: string | null; round_type: string | null }
interface Inv { id: string; name: string; website: string | null; firm_type: string | null }
interface Agg { variants: Set<string>; rounds: Set<string>; led: Set<string>; startups: Set<string>; first: string | null; last: string | null; loose: string; r24: number }

const main = async () => {
  const [rounds, invs] = await Promise.all([
    all<Round>("funding_rounds", "id,startup_id,lead_investor,investors,announcement_date,round_type"),
    all<Inv>("investors", "id,name,website,firm_type"),
  ]);
  const agg = new Map<string, Agg>();
  const since24 = new Date(); since24.setMonth(since24.getMonth() - 24); const cut24 = since24.toISOString().slice(0, 10);
  for (const r of rounds) {
    const leads = new Set(splitLeadInvestors(r.lead_investor).map((n) => investorKey(n).exact_key));
    const names = [...splitLeadInvestors(r.lead_investor), ...(r.investors ?? [])].filter((n) => !!n && !!n.trim());
    const seen = new Set<string>();
    for (const n of names) {
      const k = investorKey(n); if (!k.exact_key || seen.has(k.exact_key)) continue; seen.add(k.exact_key);
      const a = agg.get(k.exact_key) ?? { variants: new Set(), rounds: new Set(), led: new Set(), startups: new Set(), first: null, last: null, loose: k.loose_key, r24: 0 };
      a.variants.add(n.trim()); a.rounds.add(r.id); a.startups.add(r.startup_id);
      if (leads.has(k.exact_key)) a.led.add(r.id);
      const d = r.announcement_date; if (d) { if (!a.first || d < a.first) a.first = d; if (!a.last || d > a.last) a.last = d; if (d >= cut24) a.r24++; }
      agg.set(k.exact_key, a);
    }
  }
  const invByHost = new Map<string, Inv[]>(); const invKeys = new Set<string>();
  for (const i of invs) { invKeys.add(investorKey(i.name).exact_key); const h = hostOf(i.website); if (h) invByHost.set(h, [...(invByHost.get(h) ?? []), i]); }

  // entity_class: individuals and angel groups get no entity (owner, 2026-11-26). "individual" is set only for a rarely-seen name that looks like a person and is not in
  // investors; a frequent one (Kleiner Perkins looks like a person too) stays possible_individual for the manual pass over the 100-200 most frequent names.
  const RARE = Number(process.env.RARE_ROUNDS ?? 3);
  const classOf = (exact_key: string, a: Agg): string => {
    const v = [...a.variants][0];
    if (looksLikeAngelGroup(v)) return "angel_group";
    if (invKeys.has(exact_key) || !looksLikePerson(v)) return "institution_candidate";
    return a.rounds.size <= RARE ? "individual" : "possible_individual";
  };
  const rows = [...agg].map(([exact_key, a]) => ({
    exact_key, entity_class: classOf(exact_key, a), loose_key: a.loose, raw_variants: [...a.variants].slice(0, 6), rounds: a.rounds.size, rounds_led: a.led.size, startups: a.startups.size,
    first_round: a.first, last_round: a.last, rounds_24m: a.r24, in_investors_table: invKeys.has(exact_key),
  })).sort((x, y) => y.rounds - x.rounds);
  writeFileSync(`${OUT}/investor_names.csv`, csv(rows));

  const clusters = ambiguousClusters([...agg.keys()].map(investorKey).map((k) => ({ ...k, loose_key: agg.get(k.exact_key)!.loose })));
  writeFileSync(`${OUT}/ambiguous_clusters.csv`, csv(clusters.map((c) => ({ loose_key: c.loose_key, exact_keys: c.exact_keys, rounds_by_key: c.exact_keys.map((e) => `${e}=${agg.get(e)?.rounds.size ?? 0}`) }))));

  const listed = new Set<string>(); const cover: Record<string, unknown>[] = [];
  const input = process.env.INPUT && existsSync(process.env.INPUT) ? parseCsv(readFileSync(process.env.INPUT, "utf8").replace(/^﻿/, "")) : null;
  if (input) {
    const [head, ...body] = input; const at = (n: string) => head.map((h) => h.trim().toLowerCase()).indexOf(n);
    for (const r of body) {
      const name = r[at("name")]?.trim() ?? "", site = r[at("website")]?.trim() ?? "", host = hostOf(site);
      const byDomain = host ? invByHost.get(host) ?? [] : [];
      const keys = new Set(byDomain.map((i) => investorKey(i.name).exact_key));
      keys.forEach((k) => listed.add(k));
      const nk = investorKey(name).exact_key; const nameHit = agg.get(nk);
      const domainRounds = new Set<string>(); keys.forEach((k) => agg.get(k)?.rounds.forEach((x) => domainRounds.add(x)));
      const status = keys.size && domainRounds.size ? "domain_matched_in_rounds" : keys.size ? "domain_in_investors_table_no_rounds" : nameHit ? "name_only_estimate" : "not_found";
      if (status === "name_only_estimate") listed.add(nk);
      cover.push({ name, website: site, status, rounds_by_domain: domainRounds.size, rounds_name_only_estimate: status === "name_only_estimate" ? nameHit!.rounds.size : "", investors_rows_for_domain: byDomain.map((i) => i.name) });
    }
    writeFileSync(`${OUT}/list_coverage.csv`, csv(cover));
  }
  const unlisted = rows.filter((r) => r.rounds >= MIN_ROUNDS_UNLISTED && !listed.has(r.exact_key) && r.entity_class !== "individual" && r.entity_class !== "angel_group");
  writeFileSync(`${OUT}/frequent_not_in_list.csv`, csv(unlisted));

  const tally = (s: string) => cover.filter((c) => c.status === s).length;
  console.log(`rounds read: ${rounds.length}; investors rows: ${invs.length}; distinct investor names (exact_key): ${agg.size}; ambiguous clusters: ${clusters.length}`);
  if (input) console.log(`input list: ${cover.length} — domain_matched ${tally("domain_matched_in_rounds")}, domain_in_table_no_rounds ${tally("domain_in_investors_table_no_rounds")}, name_only_estimate ${tally("name_only_estimate")}, not_found ${tally("not_found")}`);
  console.log(`names with >= ${MIN_ROUNDS_UNLISTED} rounds not on the list${input ? "" : " (no INPUT: every name)"}: ${unlisted.length}\nwritten to ${OUT}/`);
};
main().catch((e) => { console.error(e); process.exit(1); });
