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
  return {
    companyNumber,
    companyName,
    dateOfCreation: (item?.date_of_creation as string) ?? null,
    companyStatus: (item?.company_status as string) ?? null,
    companyType: (item?.company_type as string) ?? null,
    sicCodes: Array.isArray(item?.sic_codes) ? (item!.sic_codes as unknown[]).map(String) : [],
    locality: (addr?.locality as string) ?? null,
  };
}

export interface CHOfficer { name: string; relationships: string[]; }

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
    out.push({ name, relationships: role ? [role] : [] });
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

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

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
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  let from = yesterday;
  let to = yesterday;

  try {
    const b = await req.json();
    const n = Number(b?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    dryRun = b?.dryRun === true;
    if (b?.withOfficers === false) withOfficers = false;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof b?.date === "string" && iso.test(b.date)) { from = b.date; to = b.date; }
    if (typeof b?.from === "string" && iso.test(b.from)) from = b.from;
    if (typeof b?.to === "string" && iso.test(b.to)) to = b.to;
  } catch { /* defaults */ }

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
    let created = 0;

    for (const c of candidates) {
      let officers: CHOfficer[] = [];
      if (withOfficers && !dryRun) {
        await sleep(REQUEST_DELAY_MS);
        const o = await chFetch(`${API}/company/${encodeURIComponent(c.companyNumber)}/officers`, apiKey);
        // A missing officer list is not a reason to drop the company — the
        // incorporation itself is the signal.
        if (o.ok && o.body) officers = mapOfficers(o.body as Record<string, unknown>);
      }

      if (dryRun) {
        results.push({ ...c, wouldIngest: true });
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
      });

      if (error) { results.push({ name: c.companyName, ok: false, reason: error.message }); continue; }
      ingested++;
      if ((data as { created_startup?: boolean })?.created_startup) created++;
      results.push({ name: c.companyName, ok: true, sic: c.sicCodes, officers: officers.length, ...(data as Record<string, unknown>) });
    }

    return json({ from, to, dryRun, scanned, nonTech, ingested, createdStartups: created, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed" }, 500);
  }
});
