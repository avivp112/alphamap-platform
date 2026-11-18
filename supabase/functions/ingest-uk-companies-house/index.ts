// =============================================================================
// Supabase Edge Function: ingest-uk-companies-house
//
// The UK arm of the inception layer. Companies House publishes every British
// incorporation the day it happens, with the registered SIC codes and the
// director list attached — earlier and more completely than SEC Form D, which
// only fires once a company raises money.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          COMPANIES_HOUSE_API_KEY (REQUIRED)
//
// Deploy:  supabase functions deploy ingest-uk-companies-house --no-verify-jwt
// Invoke:  POST {}                            -> yesterday's incorporations
//          POST { "date": "2026-07-24" }      -> one specific day
//          POST { "from": "2026-07-01", "to": "2026-07-24" }
//          POST { "dryRun": true }            -> classify, fetch no officers,
//                                                write nothing
//          POST { "backfillEvidence": true, "limit": 20, "dryRun": true }
//                                             -> add the registry detail to pending
//                                                candidates ingested before it was kept
//          POST { "backfillEvidence": true, "moveToWatch": true }
//                                             -> also move pending candidates with no
//                                                strong signal to the watchlist
//          POST { "watchCheck": true, "limit": 40, "minAgeDays": 7, "dryRun": true }
//                                             -> surface watched candidates where
//                                                something happened at the register
//          POST { "withOfficers": false }     -> skip the per-company officer
//                                                call (1 request instead of 2)
//
// ── GET AN API KEY ──────────────────────────────────────────────────────────
//   Register a free application at https://developer.company-information.service.gov.uk
//   then:  supabase secrets set COMPANIES_HOUSE_API_KEY="..."
//
//   Auth is HTTP Basic with the key as the USERNAME and an EMPTY password —
//   not a bearer token, which is the usual first thing to get wrong.
//   Rate limit is 600 requests per five minutes, i.e. 2/second sustained.
//   REQUEST_DELAY_MS holds us under it.
//
// ── WHY SIC CODES AND NOT KEYWORDS ──────────────────────────────────────────
//   Same reasoning as Form D's industryGroupType. A SIC code is chosen by the
//   incorporator and recorded on the register; a keyword match on the company
//   name is a guess. "62012 — Business and domestic software development" is a
//   fact about what the company registered itself as doing.
//
//   The trade-off, stated: SIC codes are self-declared at incorporation and
//   often lazy. 62090 and 70229 get used as catch-alls by formation agents.
//   This filter therefore has good precision and mediocre recall — it will miss
//   real tech companies that registered under something vague. That is the
//   right way round for a queue that costs ATS requests per entry.
//
// ── VERIFICATION STATUS ─────────────────────────────────────────────────────
//   The sandbox blocks outbound HTTPS, so the fetch path has NOT run against
//   the live API. Pure logic — date handling, SIC filtering, officer mapping,
//   response mapping — is tested offline in companieshouse.test.mjs against
//   the documented advanced-search response shape. Run dryRun first.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withRunLog, countKeys } from "../_shared/run-log.ts";
import { gateUkCompany, countDirectors, type GateTier } from "../_shared/company-gate.ts";
import { mergeCandidateEvidence, DETAIL_STAMP, SIGNALS_PATH } from "../_shared/candidate-evidence.ts";
import {
  officerAppointmentsSignals, pscSignals, capitalSignals, sharedAddressSignals, buildSignalSet,
  type Signal, type SignalSet, type KnownCompanies,
} from "../_shared/candidate-signals.ts";
import { hasStrongSignal, watchEvents, promotionReason } from "../_shared/candidate-watch.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://api.company-information.service.gov.uk";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PAGE_SIZE = 100;          // advanced-search maximum
const REQUEST_DELAY_MS = 600;   // ~1.7/s against a 2/s sustained ceiling
const FETCH_TIMEOUT_MS = 20_000;
const BACKFILL_MAX = 10;        // up to 8 requests each at REQUEST_DELAY_MS: ~50 s, inside the function's time limit
const WATCH_MAX = 40;           // 2 requests each: ~50 s
const MAX_SIGNAL_DIRECTORS = 4; // appointments are read for at most this many directors
const SIGNALS_BUDGET_MS = 100_000; // after this much of a run, new candidates get their signals from the backfill instead

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * UK SIC 2007 codes that indicate a technology company.
 *
 * Grouped by why they are here, because the list is the filter and an
 * unexplained code list rots fast.
 */
export const TECH_SIC_CODES = new Set([
  // Software and IT services — the core.
  "62011", // Ready-made interactive leisure and entertainment software
  "62012", // Business and domestic software development
  "62020", // Information technology consultancy activities
  "62030", // Computer facilities management activities
  "62090", // Other information technology service activities
  // Data, hosting, platforms.
  "63110", // Data processing, hosting and related activities
  "63120", // Web portals
  "63990", // Other information service activities n.e.c.
  // R&D — where deep tech and biotech incorporate.
  "72110", // Research and experimental development on biotechnology
  "72190", // Other research and experimental development on natural sciences and engineering
  // Hardware and electronics.
  "26110", // Manufacture of electronic components
  "26120", // Manufacture of loaded electronic boards
  "26200", // Manufacture of computers and peripheral equipment
  "26301", // Manufacture of telegraph and telephone apparatus and equipment
  "26511", // Manufacture of electronic measuring, testing etc equipment
  // Telecoms infrastructure.
  "61100", // Wired telecommunications activities
  "61200", // Wireless telecommunications activities
  "61900", // Other telecommunications activities
]);

export const isTechSic = (codes: string[] | null | undefined): boolean =>
  Array.isArray(codes) && codes.some((c) => TECH_SIC_CODES.has(String(c).trim()));

// ── Pure mapping ────────────────────────────────────────────────────────────

export interface CHCompany {
  companyNumber: string;
  companyName: string;
  dateOfCreation: string | null;   // YYYY-MM-DD
  companyStatus: string | null;
  companyType: string | null;
  sicCodes: string[];
  locality: string | null;
  /** Registered office as one line, from every part the register gives. */
  address: string | null;
  postalCode: string | null;
  /** "c/o ..." line — a formation agent's address often carries one. */
  careOf: string | null;
}

/**
 * Map one advanced-search item to our shape.
 *
 * Isolated and exported because a response-shape change is the single most
 * likely reason this breaks, and when it does the fix should be one function
 * and one test rather than a hunt through the handler.
 */
export function mapCompany(item: Record<string, unknown>): CHCompany | null {
  const companyNumber = String(item?.company_number ?? "").trim();
  const companyName = String(item?.company_name ?? "").trim();
  if (!companyNumber || !companyName) return null;
  const addr = (item?.registered_office_address ?? {}) as Record<string, unknown>;
  const part = (k: string): string | null => {
    const v = String(addr?.[k] ?? "").trim();
    return v === "" ? null : v;
  };
  const address = ["premises", "address_line_1", "address_line_2", "locality", "region", "postal_code", "country"]
    .map(part).filter((x): x is string => x !== null).join(", ");
  return {
    companyNumber,
    companyName,
    dateOfCreation: (item?.date_of_creation as string) ?? null,
    companyStatus: (item?.company_status as string) ?? null,
    companyType: (item?.company_type as string) ?? null,
    sicCodes: Array.isArray(item?.sic_codes) ? (item!.sic_codes as unknown[]).map(String) : [],
    locality: (addr?.locality as string) ?? null,
    address: address === "" ? null : address,
    postalCode: part("postal_code"),
    careOf: part("care_of"),
  };
}

/**
 * What the review card shows beyond the columns, for a UK candidate. Merged
 * into company_candidates.evidence after the ingest (merge_candidate_evidence).
 */
export function ukEvidenceExtra(c: CHCompany): Record<string, unknown> {
  return {
    address: c.address, postal_code: c.postalCode, care_of: c.careOf,
    company_status: c.companyStatus, date_of_creation: c.dateOfCreation,
  };
}

export interface CHOfficer {
  name: string;
  relationships: string[];
  /** Companies House officer fields, kept as the register spells them (snake_case, stored in jsonb). */
  appointed_on?: string;
  nationality?: string;
  country_of_residence?: string;
  /** "YYYY-MM": the register publishes the month and year of birth only. */
  born?: string;
  /** Path of the officer's other appointments, e.g. /officers/<id>/appointments. */
  appointments_url?: string;
}

/**
 * Officers, filtered to the ones that mean something for founder tracking.
 *
 * Corporate secretaries and formation agents are excluded: a newly incorporated
 * UK company very often lists its formation agent as an officer, and treating
 * that as a founder would attribute hundreds of unrelated companies to the same
 * three names.
 */
export function mapOfficers(payload: Record<string, unknown>): CHOfficer[] {
  const items = Array.isArray(payload?.items) ? (payload!.items as Record<string, unknown>[]) : [];
  const out: CHOfficer[] = [];
  for (const it of items) {
    const name = String(it?.name ?? "").trim();
    if (!name) continue;
    const role = String(it?.officer_role ?? "").trim();
    // Resigned officers are not current founders.
    if (it?.resigned_on) continue;
    if (/secretary/i.test(role)) continue;
    const text = (v: unknown): string | undefined => {
      const t = String(v ?? "").trim();
      return t === "" ? undefined : t;
    };
    const dob = (it?.date_of_birth ?? {}) as Record<string, unknown>;
    const year = Number(dob?.year), month = Number(dob?.month);
    const born = Number.isInteger(year) && year > 1900
      ? `${year}${Number.isInteger(month) && month >= 1 && month <= 12 ? `-${String(month).padStart(2, "0")}` : ""}`
      : undefined;
    const officer: CHOfficer = { name, relationships: role ? [role] : [] };
    const extras: Partial<CHOfficer> = {
      appointed_on: text(it?.appointed_on), nationality: text(it?.nationality),
      country_of_residence: text(it?.country_of_residence), born,
      appointments_url: text(((it?.links ?? {}) as Record<string, any>)?.officer?.appointments),
    };
    for (const [k, v] of Object.entries(extras)) if (v !== undefined) (officer as any)[k] = v;
    out.push(officer);
  }
  return out;
}

/** Incorporation year from the creation date, for founded_year. */
export function yearOf(date: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export function techSummary(c: CHCompany, officerCount: number): string {
  const parts: string[] = [`UK SIC ${c.sicCodes.join(", ") || "none"}`];
  if (c.dateOfCreation) parts.push(`incorporated ${c.dateOfCreation}`);
  if (c.locality) parts.push(`in ${c.locality}`);
  if (c.companyType) parts.push(c.companyType);
  if (officerCount) parts.push(`${officerCount} ${officerCount === 1 ? "director" : "directors"}`);
  return parts.join("; ");
}

export function searchUrl(from: string, to: string, startIndex: number, size = PAGE_SIZE): string {
  const p = new URLSearchParams({
    incorporated_from: from,
    incorporated_to: to,
    size: String(size),
    start_index: String(startIndex),
  });
  return `${API}/advanced-search/companies?${p.toString()}`;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ── Fetching ────────────────────────────────────────────────────────────────

async function chFetch(url: string, apiKey: string) {
  // Basic auth, key as username, EMPTY password.
  const auth = btoa(`${apiKey}:`);
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
}



// ── Signals: who the directors and owners are, and what was filed ───────────

async function knownByChNumber(supabase: SupabaseClient, numbers: string[]): Promise<KnownCompanies> {
  const known: KnownCompanies = new Map();
  const list = [...new Set(numbers.filter(Boolean))].slice(0, 200);
  if (list.length === 0) return known;
  const { data } = await supabase
    .from("company_identifiers").select("value, startups(id, name)")
    .eq("kind", "ch_number").in("value", list);
  for (const row of (data ?? []) as Array<Record<string, any>>) {
    const st = Array.isArray(row.startups) ? row.startups[0] : row.startups;
    if (st?.id && st?.name) known.set(String(row.value), { id: st.id, name: st.name });
  }
  return known;
}

/**
 * Companies House facts about one candidate: each director's other
 * appointments, who controls it (PSC), share allotments (SH01), and whether its
 * registered address is shared with other candidates. At most
 * MAX_SIGNAL_DIRECTORS + 2 requests, REQUEST_DELAY_MS apart. A 404 on PSC or
 * filing history is normal for a company a day old and gives no signal.
 */
async function collectUkSignals(
  supabase: SupabaseClient, apiKey: string, companyNumber: string,
  officers: Array<Record<string, any>>, address: string | null, candidateId: string,
): Promise<SignalSet> {
  const num = encodeURIComponent(companyNumber);
  const directors = officers
    .filter((o) => /director/i.test((o.relationships ?? []).join(" ")) && typeof o.appointments_url === "string")
    .slice(0, MAX_SIGNAL_DIRECTORS);

  const get = async (url: string) => {
    const r = await chFetch(url, apiKey);
    await sleep(REQUEST_DELAY_MS);
    return r.ok ? (r.body as Record<string, unknown>) : null;
  };
  const appts: Array<{ o: Record<string, any>; body: Record<string, unknown> | null }> = [];
  for (const o of directors) appts.push({ o, body: await get(`${API}${o.appointments_url}?items_per_page=50`) });
  const psc = await get(`${API}/company/${num}/persons-with-significant-control`);
  const capital = await get(`${API}/company/${num}/filing-history?category=capital&items_per_page=25`);

  const numbers: string[] = [];
  for (const a of appts) for (const i of (Array.isArray(a.body?.items) ? a.body!.items as any[] : [])) numbers.push(String(i?.appointed_to?.company_number ?? ""));
  for (const i of (Array.isArray(psc?.items) ? psc!.items as any[] : [])) numbers.push(String(i?.identification?.registration_number ?? ""));
  const known = await knownByChNumber(supabase, numbers);

  const items: Signal[] = [];
  for (const a of appts) items.push(...officerAppointmentsSignals(String(a.o.name), a.body, companyNumber, known, a.o.appointments_url));
  items.push(...pscSignals(psc, known, companyNumber));
  items.push(...capitalSignals(capital, companyNumber));
  if (address) {
    const { count } = await supabase.from("company_candidates").select("id", { count: "exact", head: true })
      .eq("evidence->>address", address).neq("id", candidateId);
    items.push(...sharedAddressSignals(count ?? 0, address));
  }
  return buildSignalSet(items, new Date().toISOString());
}


// ── Watchlist: UK candidates with no strong signal wait for an event ────────

/**
 * Re-read the register for candidates in 'watching' (checked at most every
 * minAgeDays) and surface the ones where something happened: a share
 * allotment, a new share class or articles, a third director, or the same name
 * in another source (watchEvents). Two requests each. A surfaced candidate gets
 * the events in evidence.watch_events and promoted_reason, then goes to 'pending'.
 * Nothing is rejected here: a candidate with no event is only marked checked.
 */
async function watchCheck(
  supabase: SupabaseClient, apiKey: string, limit: number, minAgeDays: number, dryRun: boolean,
): Promise<Response> {
  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000).toISOString();
  const { data: rows, error } = await supabase
    .from("company_candidates")
    .select("id, name, entity_number, evidence")
    .eq("source", "uk_companies_house").eq("status", "watching")
    .not("entity_number", "is", null)
    .or(`watch_checked_at.is.null,watch_checked_at.lt.${cutoff}`)
    .order("watch_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return json({ error: `company_candidates: ${error.message}` }, 500);

  const results: Array<Record<string, unknown>> = [];
  let promoted = 0, quiet = 0, failed = 0;
  for (const row of rows ?? []) {
    const number = encodeURIComponent(String(row.entity_number));
    const history = await chFetch(`${API}/company/${number}/filing-history?items_per_page=50`, apiKey);
    await sleep(REQUEST_DELAY_MS);
    if (history.status === 429) { results.push({ name: row.name, error: "rate limited, stopped" }); break; }
    const off = await chFetch(`${API}/company/${number}/officers`, apiKey);
    await sleep(REQUEST_DELAY_MS);
    if (off.status === 429) { results.push({ name: row.name, error: "rate limited, stopped" }); break; }
    if (!history.ok && history.status !== 404) { failed++; results.push({ name: row.name, error: `HTTP ${history.status}` }); continue; }

    const officersNow = off.ok && off.body ? mapOfficers(off.body as Record<string, unknown>) : null;
    const startOfficers = ((row.evidence as Record<string, unknown> | null)?.officers ?? []) as Array<{ relationships?: string[] }>;
    const { data: cross } = await supabase.rpc("candidate_cross_source_matches", { p_candidate_id: row.id });
    const events = watchEvents({
      companyNumber: String(row.entity_number),
      filingHistory: history.ok ? (history.body as Record<string, unknown>) : null,
      directorsNow: officersNow ? countDirectors(officersNow) : null,
      directorsAtStart: countDirectors(startOfficers as never),
      crossSource: (cross ?? []) as Array<{ source: string; name: string; status: string }>,
    });

    if (events.length === 0) {
      quiet++;
      if (!dryRun) await supabase.from("company_candidates").update({ watch_checked_at: new Date().toISOString() }).eq("id", row.id).eq("status", "watching");
      results.push({ name: row.name, events: [] });
      continue;
    }
    if (!dryRun) {
      // Events first (the merge reaches a watching candidate), then the move to review.
      await supabase.rpc("merge_candidate_evidence", { p_candidate_id: row.id, p_extra: { watch_events: events } });
      const { error: pErr } = await supabase.rpc("promote_candidate", { p_candidate_id: row.id, p_reason: promotionReason(events) });
      if (pErr) { failed++; results.push({ name: row.name, error: pErr.message }); continue; }
    }
    promoted++;
    results.push({ name: row.name, events: events.map((e) => e.kind), reason: promotionReason(events) });
  }
  return json({ watchCheck: true, dryRun, found: rows?.length ?? 0, promoted, quiet, failed, results });
}

// ── Backfill: candidates already waiting for review ─────────────────────────

/**
 * Read the company profile and officers again for pending candidates that were
 * ingested before the registry detail was kept, and add it to their evidence.
 * Two requests per candidate, REQUEST_DELAY_MS apart (the register allows 600
 * per five minutes). A candidate is read once: DETAIL_STAMP marks it. Writes
 * nothing for a decided candidate (the update is conditional on pending).
 */
async function backfillEvidence(
  supabase: SupabaseClient, apiKey: string, limit: number, dryRun: boolean, withOfficers: boolean, moveToWatch: boolean,
): Promise<Response> {
  const { data: rows, error } = await supabase
    .from("company_candidates")
    .select("id, name, entity_number, evidence")
    .eq("source", "uk_companies_house").eq("status", "pending")
    .not("entity_number", "is", null)
    .filter(SIGNALS_PATH, "is", null)
    .order("first_seen_at", { ascending: false })
    .limit(limit);
  if (error) return json({ error: `company_candidates: ${error.message}` }, 500);

  const results: Array<Record<string, unknown>> = [];
  let updated = 0, notFound = 0, failed = 0;
  for (const row of rows ?? []) {
    const number = encodeURIComponent(String(row.entity_number));
    const now = new Date().toISOString();
    // Detail already kept (ingested after stage 1, or backfilled): only the signals are missing.
    const hasDetail = Boolean((row.evidence as Record<string, unknown> | null)?.[DETAIL_STAMP]);
    let profile: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: null };
    if (!hasDetail) {
      profile = await chFetch(`${API}/company/${number}`, apiKey);
      await sleep(REQUEST_DELAY_MS);
    }
    if (profile.status === 429) { results.push({ name: row.name, error: "rate limited, stopped" }); break; }

    let extra: Record<string, unknown> = {};
    let officers: Array<Record<string, unknown>> | undefined;
    if (hasDetail) {
      /* nothing to fetch */
    } else if (profile.ok && profile.body) {
      const body = profile.body as Record<string, unknown>;
      // A profile spells the company type "type"; the advanced search spells it "company_type".
      const c = mapCompany({ ...body, company_type: body.company_type ?? body.type });
      if (c) extra = ukEvidenceExtra(c);
      if (withOfficers) {
        const o = await chFetch(`${API}/company/${number}/officers`, apiKey);
        await sleep(REQUEST_DELAY_MS);
        if (o.status === 429) { results.push({ name: row.name, error: "rate limited, stopped" }); break; }
        if (o.ok && o.body) officers = mapOfficers(o.body as Record<string, unknown>) as unknown as Array<Record<string, unknown>>;
      }
    } else if (profile.status === 404) {
      notFound++;            // gone from the register: stamp it so it is not asked again
    } else {
      failed++;
      results.push({ name: row.name, error: `HTTP ${profile.status}` });
      continue;              // not stamped: the next run tries again
    }

    let merged = mergeCandidateEvidence(row.evidence as Record<string, unknown>, extra, officers, now);
    // Signals: not for a company that is gone from the register (404), and only once the detail is in.
    const signals = profile.status === 404
      ? buildSignalSet([], now)
      : await collectUkSignals(supabase, apiKey, String(row.entity_number),
          (merged.officers ?? []) as Array<Record<string, any>>, (merged.address as string | undefined) ?? null, String(row.id));
    merged = { ...merged, signals };
    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("company_candidates").update({ evidence: merged })
        .eq("id", row.id).eq("status", "pending");
      if (upErr) { failed++; results.push({ name: row.name, error: upErr.message }); continue; }
    }
    // Only on request: a candidate already in the queue moves out of it to the watchlist.
    const toWatch = moveToWatch && !hasStrongSignal(signals.items);
    if (toWatch && !dryRun) await supabase.rpc("watch_candidate", { p_candidate_id: row.id });
    updated++;
    results.push({ name: row.name, ok: true, address: extra.address ?? null, officers: officers?.length ?? 0, signals: signals.items.map((i) => ({ level: i.level, text: i.text })), ...(moveToWatch ? { watching: toWatch } : {}) });
  }
  return json({ backfill: true, dryRun, found: rows?.length ?? 0, updated, notFound, failed, results });
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(withRunLog("uk_companies_house", countKeys("ingested"), async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const startedAt = Date.now();

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const apiKey = Deno.env.get("COMPANIES_HOUSE_API_KEY")?.trim();
  if (!apiKey) {
    return json({
      error: "COMPANIES_HOUSE_API_KEY is not set.",
      fix: 'Register at https://developer.company-information.service.gov.uk then: supabase secrets set COMPANIES_HOUSE_API_KEY="..."',
    }, 500);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  let withOfficers = true;
  let backfill = false;
  let watch = false;
  let moveToWatch = false;
  let minAgeDays = 7;
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  let from = yesterday;
  let to = yesterday;

  try {
    const b = await req.json();
    const n = Number(b?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    dryRun = b?.dryRun === true;
    if (b?.withOfficers === false) withOfficers = false;
    backfill = b?.backfillEvidence === true;
    watch = b?.watchCheck === true;
    moveToWatch = b?.moveToWatch === true;
    const age = Number(b?.minAgeDays);
    if (Number.isFinite(age) && age >= 0) minAgeDays = Math.floor(age);
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof b?.date === "string" && iso.test(b.date)) { from = b.date; to = b.date; }
    if (typeof b?.from === "string" && iso.test(b.from)) from = b.from;
    if (typeof b?.to === "string" && iso.test(b.to)) to = b.to;
  } catch { /* defaults */ }

  // POST { "backfillEvidence": true, "limit": 20 } — see backfillEvidence().
  if (backfill) return await backfillEvidence(supabase, apiKey, Math.min(limit, BACKFILL_MAX), dryRun, withOfficers, moveToWatch);
  // POST { "watchCheck": true, "limit": 40, "minAgeDays": 7, "dryRun": true } — see watchCheck().
  if (watch) return await watchCheck(supabase, apiKey, Math.min(limit, WATCH_MAX), minAgeDays, dryRun);

  try {
    const candidates: CHCompany[] = [];
    let startIndex = 0;
    let totalHits: number | null = null;
    let scanned = 0;
    let nonTech = 0;

    // Advanced search cannot filter by "any of these SIC codes" in one call, so
    // we page the day's incorporations and filter here. A day is typically
    // 1,500-2,500 UK incorporations; `limit` bounds how many QUALIFYING ones we
    // take, and the page loop stops as soon as we have them.
    while (candidates.length < limit) {
      const res = await chFetch(searchUrl(from, to, startIndex), apiKey);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return json({ error: `Companies House rejected the API key (${res.status}). Basic auth uses the key as USERNAME with an empty password.` }, 502);
        }
        return json({ error: `Companies House returned ${res.status}`, url: searchUrl(from, to, startIndex) }, 502);
      }
      const body = res.body as Record<string, unknown>;
      const items = Array.isArray(body?.items) ? (body!.items as Record<string, unknown>[]) : [];
      totalHits = totalHits ?? Number(body?.hits ?? 0);
      if (items.length === 0) break;

      for (const raw of items) {
        scanned++;
        const c = mapCompany(raw);
        if (!c) continue;
        if (!isTechSic(c.sicCodes)) { nonTech++; continue; }
        candidates.push(c);
        if (candidates.length >= limit) break;
      }

      startIndex += items.length;
      if (totalHits !== null && startIndex >= totalHits) break;
      await sleep(REQUEST_DELAY_MS);
    }

    if (candidates.length === 0) {
      return json({ from, to, scanned, nonTech, ingested: 0, note: "no tech-SIC incorporations in range" });
    }

    const results: Array<Record<string, unknown>> = [];
    let ingested = 0;
    const tiers: Record<GateTier, number> = { reject: 0, queue: 0, alert: 0 };

    for (const c of candidates) {
      // Quality gate (_shared/company-gate.ts). First without officers, as if
      // the company had a founding team: if it is rejected on SIC codes, name
      // or type, no officer list can save it, so that request is skipped.
      const twoDirectors = [{ name: "", relationships: ["director"] }, { name: "", relationships: ["director"] }];
      const preGate = gateUkCompany({ name: c.companyName, sicCodes: c.sicCodes, companyType: c.companyType, officers: twoDirectors });

      let officers: CHOfficer[] = [];
      if (withOfficers && preGate.tier !== "reject") {
        await sleep(REQUEST_DELAY_MS);
        const o = await chFetch(`${API}/company/${encodeURIComponent(c.companyNumber)}/officers`, apiKey);
        if (o.ok && o.body) officers = mapOfficers(o.body as Record<string, unknown>);
      }
      // Unknown officers reject (no_officer_data): "missing is better than wrong".
      const gate = preGate.tier === "reject"
        ? preGate
        : gateUkCompany({ name: c.companyName, sicCodes: c.sicCodes, companyType: c.companyType, officers });
      tiers[gate.tier]++;

      if (dryRun) {
        results.push({ name: c.companyName, sic: c.sicCodes, officers: officers.length, gate });
        ingested++;
        continue;
      }

      const { data, error } = await supabase.rpc("ingest_gov_entity_filing", {
        p_source: "uk_companies_house",
        p_accession: c.companyNumber,          // the registry's own document id
        p_entity_name: c.companyName,
        p_filing_date: c.dateOfCreation ?? to,
        p_entity_number: c.companyNumber,
        p_form_type: c.companyType,
        p_year_of_inc: yearOf(c.dateOfCreation),
        p_jurisdiction: c.locality,
        p_country: "United Kingdom",
        p_codes: c.sicCodes,
        p_officers: officers,
        p_tech_summary: techSummary(c, officers.length),
        p_raw: c,
        // A new company becomes a review candidate (queue/alert) or nothing
        // (reject) — never a startups row directly (20261016000000).
        p_gate: gate,
      });

      if (error) { results.push({ name: c.companyName, ok: false, reason: error.message }); continue; }
      ingested++;
      // Address and status for the review card. Additive and non-fatal: the
      // candidate already exists, the card just shows less without it.
      const candidateId = (data as Record<string, unknown> | null)?.candidate_id as string | null | undefined;
      let evidenceError: string | undefined;
      let watching = false;
      if (candidateId) {
        const extra: Record<string, unknown> = { ...ukEvidenceExtra(c), [DETAIL_STAMP]: new Date().toISOString() };
        // Signals cost up to 6 requests: past the budget the backfill collects them instead.
        if (Date.now() - startedAt < SIGNALS_BUDGET_MS) {
          extra.signals = await collectUkSignals(supabase, apiKey, c.companyNumber,
            officers as unknown as Array<Record<string, any>>, c.address, candidateId);
        }
        const { error: mergeError } = await supabase.rpc("merge_candidate_evidence", { p_candidate_id: candidateId, p_extra: extra });
        if (mergeError) evidenceError = mergeError.message;
        // No strong signal: the candidate waits on the watchlist instead of the review queue.
        const set = extra.signals as SignalSet | undefined;
        if (!mergeError && set && !hasStrongSignal(set.items)) {
          const { data: moved } = await supabase.rpc("watch_candidate", { p_candidate_id: candidateId });
          watching = moved === true;
        }
      }
      results.push({ name: c.companyName, ok: true, sic: c.sicCodes, officers: officers.length, gate, ...(data as Record<string, unknown>), ...(watching ? { watching } : {}), ...(evidenceError ? { evidenceError } : {}) });
    }

    return json({ from, to, dryRun, scanned, nonTech, ingested, gate: tiers, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed" }, 500);
  }
}));
