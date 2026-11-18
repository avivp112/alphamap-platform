import { supabase, type InvestorRow, type StartupListRow } from "./supabase";
import { fetchCrmCompanies } from "./supabase";
import type { CrmCompany } from "./crm";
import { clampConviction, noteMentions, refKey, type AlphaRef } from "./alpha";

// Data calls behind "Your Alpha": the Bench and the Journal (migrations
// 20261203000000_alpha_bench, 20261203000100_alpha_notes). Everything is private
// to the signed-in user by RLS.

// ── The Bench ────────────────────────────────────────────────────────────────

export interface BenchRow { id: string; ref: AlphaRef; conviction: number | null; createdAt: string }

export async function fetchBench(): Promise<BenchRow[]> {
  const { data, error } = await supabase.from("alpha_bench").select("id, entity_type, entity_id, conviction, created_at").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    ref: { type: r.entity_type as AlphaRef["type"], id: r.entity_id as string },
    conviction: (r.conviction as number | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Puts a company on the bench. Already there is not an error. A full bench raises the database's own message. */
export async function addToBench(ref: AlphaRef): Promise<void> {
  const { error } = await supabase.from("alpha_bench").insert({ entity_type: ref.type, entity_id: ref.id });
  if (error && error.code !== "23505") throw error;
}

export async function removeFromBench(id: string): Promise<void> {
  const { error } = await supabase.from("alpha_bench").delete().eq("id", id);
  if (error) throw error;
}

export async function setBenchConviction(id: string, conviction: number | null): Promise<void> {
  const { error } = await supabase.from("alpha_bench").update({ conviction: clampConviction(conviction) }).eq("id", id);
  if (error) throw error;
}

// ── Companies, resolved for display ──────────────────────────────────────────

export interface AlphaEntity {
  ref: AlphaRef;
  name: string;
  website: string | null;
  /** "Fintech · Series A", whatever the record has. */
  subtitle: string | null;
  /** Where the full record lives. */
  href: string;
  /** Latest funding round on record, for a startup. */
  lastRound: { type: string | null; date: string | null } | null;
  /** Startup/investor record timestamp, or the CRM entry's, for the freshness line. */
  updatedAt: string | null;
  crm: Pick<CrmCompany, "id" | "stage" | "next_step" | "next_step_date" | "notes"> | null;
}

function fromStartup(s: StartupListRow): AlphaEntity {
  return {
    ref: { type: "startup", id: s.id }, name: s.name, website: s.website,
    subtitle: [s.sector_parent || s.industry, s.latest_round_type].filter(Boolean).join(" · ") || null,
    href: `/startups?company=${s.id}`,
    lastRound: s.latest_round_type || s.latest_round_date ? { type: s.latest_round_type ?? null, date: s.latest_round_date ?? null } : null,
    updatedAt: s.updated_at, crm: null,
  };
}

function fromInvestor(i: InvestorRow): AlphaEntity {
  return {
    ref: { type: "investor", id: i.id }, name: i.name, website: i.website,
    subtitle: [i.firm_type ? i.firm_type.toUpperCase() : null, i.headquarters].filter(Boolean).join(" · ") || null,
    href: "/vcs", lastRound: null, updatedAt: i.updated_at, crm: null,
  };
}

function fromCrm(c: CrmCompany): AlphaEntity {
  return {
    ref: { type: "crm", id: c.id }, name: c.name, website: c.startup?.website ?? c.website,
    subtitle: null, href: `/crm/${c.id}`, lastRound: null, updatedAt: c.updated_at,
    crm: { id: c.id, stage: c.stage, next_step: c.next_step, next_step_date: c.next_step_date, notes: c.notes },
  };
}

/** Resolves refs to display records. A ref whose record is gone is left out. */
export async function resolveEntities(refs: AlphaRef[], knownCrm?: CrmCompany[]): Promise<Map<string, AlphaEntity>> {
  const out = new Map<string, AlphaEntity>();
  const ids = (t: AlphaRef["type"]) => Array.from(new Set(refs.filter((r) => r.type === t).map((r) => r.id)));
  const [startupIds, investorIds, crmIds] = [ids("startup"), ids("investor"), ids("crm")];
  const [s, i, c] = await Promise.all([
    startupIds.length ? supabase.from("startups_search").select("*").in("id", startupIds) : Promise.resolve({ data: [], error: null }),
    investorIds.length ? supabase.from("investors").select("*").in("id", investorIds) : Promise.resolve({ data: [], error: null }),
    crmIds.length ? (knownCrm ? Promise.resolve(knownCrm) : fetchCrmCompanies()) : Promise.resolve([] as CrmCompany[]),
  ]);
  if (s.error) throw s.error;
  if (i.error) throw i.error;
  for (const row of (s.data ?? []) as StartupListRow[]) { const e = fromStartup(row); out.set(refKey(e.ref), e); }
  for (const row of (i.data ?? []) as InvestorRow[]) { const e = fromInvestor(row); out.set(refKey(e.ref), e); }
  for (const row of c as CrmCompany[]) { if (crmIds.includes(row.id)) { const e = fromCrm(row); out.set(refKey(e.ref), e); } }
  return out;
}

export { fromCrm as entityFromCrm, fromStartup as entityFromStartup, fromInvestor as entityFromInvestor };

// ── The Journal ──────────────────────────────────────────────────────────────

export interface AlphaNote { id: string; body: string; createdAt: string; updatedAt: string; links: AlphaRef[] }

export async function fetchNotes(limit = 200): Promise<AlphaNote[]> {
  const { data, error } = await supabase.from("alpha_notes")
    .select("id, body, created_at, updated_at, alpha_note_links(entity_type, entity_id)")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id as string, body: n.body as string, createdAt: n.created_at as string, updatedAt: n.updated_at as string,
    links: ((n.alpha_note_links ?? []) as Array<{ entity_type: AlphaRef["type"]; entity_id: string }>).map((l) => ({ type: l.entity_type, id: l.entity_id })),
  }));
}

async function writeLinks(noteId: string, body: string): Promise<void> {
  const refs = noteMentions(body);
  if (refs.length === 0) return;
  const { error } = await supabase.from("alpha_note_links").insert(refs.map((r) => ({ note_id: noteId, entity_type: r.type, entity_id: r.id })));
  if (error) throw error;
}

export async function createNote(body: string): Promise<string> {
  const text = body.trim();
  const { data, error } = await supabase.from("alpha_notes").insert({ body: text }).select("id").single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  try { await writeLinks(id, text); } catch (e) { await supabase.from("alpha_notes").delete().eq("id", id); throw e; }
  return id;
}

export async function updateNote(id: string, body: string): Promise<void> {
  const text = body.trim();
  const { error } = await supabase.from("alpha_notes").update({ body: text }).eq("id", id);
  if (error) throw error;
  const del = await supabase.from("alpha_note_links").delete().eq("note_id", id);
  if (del.error) throw del.error;
  await writeLinks(id, text);
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from("alpha_notes").delete().eq("id", id);
  if (error) throw error;
}
