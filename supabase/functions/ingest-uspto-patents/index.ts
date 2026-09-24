// =============================================================================
// Supabase Edge Function: ingest-uspto-patents
//
// The earliest layer of all. A pre-grant publication appears ~18 months after
// filing and frequently BEFORE the company incorporates, raises, or has a
// website — sometimes the assignee is still the inventors' names. It is also
// the only source in this pipeline carrying an ABSTRACT: a paragraph saying
// what the technology actually is, rather than a category code.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          PATENTSVIEW_API_KEY (REQUIRED)
//
// Deploy:  supabase functions deploy ingest-uspto-patents --no-verify-jwt
// Invoke:  POST {}                              -> last 7 days
//          POST { "from": "2026-07-01", "to": "2026-07-24" }
//          POST { "dryRun": true }              -> classify, write nothing
//          POST { "rawSample": true }           -> dump the first raw record and
//                                                  stop. Use this FIRST.
//
// ── WHY NOT THE BULK FILES, WHICH IS WHAT WAS ASKED FOR ─────────────────────
//   USPTO's weekly pre-grant full-text archives (bulkdata.uspto.gov, redbook
//   fulltext) are 1-3 GB compressed per week, expanding to tens of GB of XML
//   containing every published application. A Supabase Edge Function has on the
//   order of a hundred megabytes of memory and a wall-clock limit measured in
//   minutes. It cannot download, decompress, or stream-parse that — not slowly,
//   not in chunks; the archive is a single ZIP whose central directory has to
//   be read before any member can be extracted.
//
//   Doing bulk properly needs a different execution model: a container or VM
//   with disk, streaming the ZIP to object storage, parsing member-by-member,
//   and writing batches back. That is a worthwhile thing to build and it is not
//   an Edge Function.
//
//   So this uses the PatentsView search API instead, which exposes the same
//   pre-grant publication corpus with server-side filtering — meaning we ask
//   for G06N publications in a date range and receive hundreds of rows rather
//   than filtering millions locally. For a sourcing pipeline that wants recent
//   AI/deep-tech publications, this is strictly the better shape. The bulk path
//   only wins for a full historical backfill.
//
//   Get a key at https://patentsview.org/apis/keyrequest then:
//     supabase secrets set PATENTSVIEW_API_KEY="..."
//
// ── THE ASSIGNEE PROBLEM, WHICH IS THE INTERESTING ONE ──────────────────────
//   Many early filings have NO organisation assignee — they are filed by the
//   inventors personally, before the company exists. That is the most valuable
//   case in this entire pipeline and the one a naive importer drops.
//
//   So: when an organisation is named we create/link a startups row as usual.
//   When there is none, the publication is still stored in raw_gov_filings with
//   startup_id NULL and the inventors in `officers`. Those rows are a founder
//   watchlist — people with granted deep-tech IP and no company yet — and
//   raw_gov_filings has an index specifically for finding them
//   (idx_raw_gov_filings_unlinked).
//
// ── VERIFICATION STATUS ─────────────────────────────────────────────────────
//   Not exercised against the live API: the sandbox blocks outbound HTTPS.
//   More importantly, PatentsView's field names have changed across API
//   versions and I could not confirm the current ones. mapPublication() is
//   therefore deliberately isolated, tolerant of several plausible spellings,
//   and covered by tests. RUN WITH { "rawSample": true } FIRST — it prints one
//   untouched record so the mapping can be corrected in one place.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const ENDPOINT = "https://search.patentsview.org/api/v1/publication/";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 1500;   // PatentsView allows 45 requests/minute
const FETCH_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * CPC subclass prefixes that mark AI, deep tech and advanced hardware.
 *
 * Matched as PREFIXES because CPC is hierarchical: "G06N3/08" (backpropagation)
 * sits under "G06N3" under "G06N". Listing the parent captures every child
 * without enumerating thousands of leaves.
 */
export const DEEPTECH_CPC_PREFIXES = [
  "G06N",     // Computing arrangements based on specific computational models — the AI/ML root
  "G06V",     // Image or video recognition
  "G16Y",     // IoT
  "G06F40",   // Natural language processing
  "G10L15",   // Speech recognition
  "G10L17",   // Speaker identification
  "B25J",     // Manipulators / robotics
  "G05D1",    // Autonomous vehicle control
  "H01L",     // Semiconductor devices
  "H03K19",   // Logic circuits
  "G02B6",    // Optical waveguides / photonics
  "H04L9",    // Cryptographic mechanisms
  "G21B",     // Fusion reactors
  "H01M",     // Batteries / fuel cells
  "C12N15",   // Genetic engineering
  "G16B",     // Bioinformatics
];

export const isDeepTechCpc = (codes: string[] | null | undefined): boolean =>
  Array.isArray(codes) &&
  codes.some((c) => {
    const s = String(c).toUpperCase().replace(/\s+/g, "");
    return DEEPTECH_CPC_PREFIXES.some((p) => s.startsWith(p));
  });

// ── Pure mapping ────────────────────────────────────────────────────────────

export interface Publication {
  publicationNumber: string;
  applicationNumber: string | null;
  title: string | null;
  abstract: string | null;
  publicationDate: string | null;   // YYYY-MM-DD
  assignee: string | null;          // organisation, when there is one
  inventors: string[];
  cpcCodes: string[];
}

/** First non-empty value among several candidate keys. */
function pick(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

/**
 * Map one API record to our shape.
 *
 * THIS IS THE FUNCTION MOST LIKELY TO NEED CORRECTING. PatentsView has renamed
 * fields between API versions (assignee_organization vs assignee_org_name,
 * nested objects vs flattened prefixes), so each field accepts the spellings I
 * could find evidence for. If a live record maps to nulls, fix it here — the
 * rest of the function reads only the Publication interface.
 */
export function mapPublication(rec: Record<string, unknown>): Publication | null {
  const publicationNumber = pick(rec, "publication_number", "document_number", "pgpub_id", "publication_id");
  if (!publicationNumber) return null;

  const assignees = asArray(rec.assignees ?? rec.assignee ?? []);
  const assignee =
    pick(rec, "assignee_organization", "assignee_org_name") ??
    (assignees.map((a) => pick(a, "assignee_organization", "assignee_org_name", "organization", "name"))
      .find((v) => v && v.trim()) ?? null);

  const inventorRecs = asArray(rec.inventors ?? rec.inventor ?? []);
  const inventors = inventorRecs
    .map((i) => {
      const full = pick(i, "inventor_name", "name");
      if (full) return full;
      const first = pick(i, "inventor_name_first", "first_name", "given_name");
      const last = pick(i, "inventor_name_last", "last_name", "family_name");
      return [first, last].filter(Boolean).join(" ").trim() || null;
    })
    .filter((n): n is string => Boolean(n));

  const cpcRecs = asArray(rec.cpc_current ?? rec.cpc_at_issue ?? rec.cpcs ?? []);
  const cpcCodes = cpcRecs
    .map((c) => pick(c, "cpc_group_id", "cpc_subgroup_id", "cpc_group", "group_id", "cpc_subclass_id"))
    .filter((c): c is string => Boolean(c));
  // Some responses flatten CPC to a bare array of strings.
  if (cpcCodes.length === 0 && Array.isArray(rec.cpc_current)) {
    for (const c of rec.cpc_current as unknown[]) if (typeof c === "string") cpcCodes.push(c);
  }

  return {
    publicationNumber,
    applicationNumber: pick(rec, "application_number", "appl_id", "application_id"),
    title: pick(rec, "patent_title", "title", "invention_title"),
    abstract: pick(rec, "patent_abstract", "abstract"),
    publicationDate: pick(rec, "publication_date", "date_published", "pub_date"),
    assignee,
    inventors,
    cpcCodes,
  };
}

/** Inventors as the officers shape, so founder tracking reads one format. */
export const inventorsAsOfficers = (p: Publication) =>
  p.inventors.map((name) => ({ name, relationships: ["Inventor"] }));

export function techSummary(p: Publication): string {
  const parts: string[] = [];
  if (p.cpcCodes.length) parts.push(`CPC ${p.cpcCodes.slice(0, 4).join(", ")}`);
  if (p.publicationDate) parts.push(`published ${p.publicationDate}`);
  if (!p.assignee) parts.push("no organisation assignee — inventor-held");
  if (p.inventors.length) parts.push(`${p.inventors.length} ${p.inventors.length === 1 ? "inventor" : "inventors"}`);
  return parts.join("; ");
}

export function buildQueryUrl(from: string, to: string, offset: number, size = PAGE_SIZE): string {
  // Server-side date window; CPC is filtered locally because the prefix list is
  // long and _or-ing sixteen _begins clauses makes the query fragile.
  const q = { _and: [{ _gte: { publication_date: from } }, { _lte: { publication_date: to } }] };
  const f = [
    "publication_number", "application_number", "patent_title", "patent_abstract",
    "publication_date", "assignees.assignee_organization",
    "inventors.inventor_name_first", "inventors.inventor_name_last",
    "cpc_current.cpc_group_id",
  ];
  const o = { size, offset };
  const p = new URLSearchParams({ q: JSON.stringify(q), f: JSON.stringify(f), o: JSON.stringify(o) });
  return `${ENDPOINT}?${p.toString()}`;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const apiKey = Deno.env.get("PATENTSVIEW_API_KEY")?.trim();
  if (!apiKey) {
    // rawSample without a key runs the mapping over a SYNTHETIC record. That
    // separates "the function is broken" from "the key is missing" — you can
    // confirm the deploy landed and the mapping executes — but it is explicitly
    // NOT evidence about PatentsView's real response shape, which is the only
    // thing rawSample exists to discover. PatentsView has no unauthenticated
    // endpoint, so there is no honest way to answer that question without a key.
    let wantsSample = false;
    try { wantsSample = (await req.clone().json())?.rawSample === true; } catch { /* no body */ }
    if (wantsSample) {
      const synthetic = {
        publication_number: "US20260123456A1",
        application_number: "18/123456",
        patent_title: "Sparse attention routing for transformer inference",
        patent_abstract: "A method for reducing inference cost in transformer models...",
        publication_date: "2026-07-16",
        assignees: [{ assignee_organization: "Synthorai Technology Inc" }],
        inventors: [{ inventor_name_first: "Rin", inventor_name_last: "Sato" }],
        cpc_current: [{ cpc_group_id: "G06N3/08" }],
      };
      return json({
        synthetic: true,
        warning: "PATENTSVIEW_API_KEY is not set, so this is a FIXTURE, not a live record. It proves the deploy and the mapping code run. It proves nothing about PatentsView's actual field names — which is the whole reason to use rawSample. Re-run with a key before trusting the mapping.",
        fix: 'Request a free key at https://patentsview.org/apis/keyrequest then: supabase secrets set PATENTSVIEW_API_KEY="..."',
        firstRecord: synthetic,
        mappedAs: mapPublication(synthetic),
        deepTechMatch: isDeepTechCpc(mapPublication(synthetic)!.cpcCodes),
      });
    }
    return json({
      error: "PATENTSVIEW_API_KEY is not set.",
      fix: 'Request one at https://patentsview.org/apis/keyrequest then: supabase secrets set PATENTSVIEW_API_KEY="..."',
      note: 'POST { "rawSample": true } without a key to at least confirm the deploy and mapping code run against a fixture.',
    }, 500);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  let rawSample = false;
  let to = ymd(new Date());
  let from = ymd(new Date(Date.now() - 7 * 86_400_000));
  try {
    const b = await req.json();
    const n = Number(b?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    dryRun = b?.dryRun === true;
    rawSample = b?.rawSample === true;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof b?.from === "string" && iso.test(b.from)) from = b.from;
    if (typeof b?.to === "string" && iso.test(b.to)) to = b.to;
  } catch { /* defaults */ }

  try {
    const kept: Publication[] = [];
    let offset = 0;
    let scanned = 0;
    let offTopic = 0;
    let unmappable = 0;

    while (kept.length < limit) {
      const url = buildQueryUrl(from, to, offset);
      const res = await fetch(url, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        return json({
          error: `PatentsView returned ${res.status}`,
          hint: res.status === 403
            ? "the API key was rejected — PatentsView sends it as the X-Api-Key header, not a bearer token"
            : "check the query shape with { rawSample: true }",
          url,
        }, 502);
      }
      const body = await res.json() as Record<string, unknown>;
      const records = asArray(body?.publications ?? body?.patents ?? body?.data ?? []);

      // The escape hatch: dump one untouched record so the mapping below can be
      // corrected against reality instead of guessed at twice.
      if (rawSample) {
        return json({
          note: "raw first record, unmapped. Correct mapPublication() against this, then re-run without rawSample.",
          totalHits: body?.total_hits ?? body?.count ?? null,
          responseKeys: Object.keys(body ?? {}),
          firstRecord: records[0] ?? null,
          mappedAs: records[0] ? mapPublication(records[0]) : null,
        });
      }

      if (records.length === 0) break;

      for (const rec of records) {
        scanned++;
        const p = mapPublication(rec);
        if (!p) { unmappable++; continue; }
        if (!isDeepTechCpc(p.cpcCodes)) { offTopic++; continue; }
        kept.push(p);
        if (kept.length >= limit) break;
      }

      offset += records.length;
      if (records.length < PAGE_SIZE) break;
      await sleep(REQUEST_DELAY_MS);
    }

    if (unmappable > 0 && kept.length === 0) {
      return json({
        error: `every record failed to map (${unmappable} of ${scanned}) — the API shape has almost certainly changed`,
        fix: "re-run with { rawSample: true } and correct mapPublication()",
      }, 502);
    }

    if (kept.length === 0) {
      return json({ from, to, scanned, offTopic, ingested: 0, note: "no deep-tech CPC publications in range" });
    }

    const results: Array<Record<string, unknown>> = [];
    let ingested = 0;
    let created = 0;
    let inventorHeld = 0;

    for (const p of kept) {
      if (dryRun) {
        results.push({ ...p, abstract: p.abstract?.slice(0, 120) ?? null, wouldIngest: true });
        ingested++;
        if (!p.assignee) inventorHeld++;
        continue;
      }

      // No organisation assignee means an inventor-held filing — the earliest
      // signal there is. It is stored with entity_name set to the publication's
      // own title-holder placeholder ONLY when an organisation exists; without
      // one we cannot create a startups row, so entity resolution is skipped
      // via p_unlinked and the publication is written unlinked for the
      // founder watchlist.
      //
      // Routed through the RPC rather than a raw upsert (as this used to be):
      // a raw upsert's ON CONFLICT would blindly overwrite officers/title/
      // abstract on every re-ingest, so a later re-parse that came back with
      // zero inventors would silently wipe a previously-captured inventor
      // list. ingest_gov_entity_filing's ON CONFLICT never lets an empty
      // officers array overwrite a populated one — see
      // 20260726220000_gov_entity_resolution_and_unlinked_fix.sql.
      if (!p.assignee) {
        inventorHeld++;
        const { data, error } = await supabase.rpc("ingest_gov_entity_filing", {
          p_source: "uspto_patent",
          p_accession: p.publicationNumber,
          p_entity_name: p.inventors[0] ? `${p.inventors[0]} (inventor-held)` : "Unassigned publication",
          p_filing_date: p.publicationDate ?? to,
          p_entity_number: p.applicationNumber,
          p_country: "United States",
          p_codes: p.cpcCodes,
          p_title: p.title,
          p_abstract: p.abstract,
          p_officers: inventorsAsOfficers(p),
          p_tech_summary: techSummary(p),
          p_raw: p,
          p_unlinked: true,
        });
        if (error) results.push({ publication: p.publicationNumber, ok: false, reason: error.message });
        else {
          ingested++;
          results.push({
            publication: p.publicationNumber, ok: true, assignee: null,
            inventors: p.inventors.length, title: p.title, ...(data as Record<string, unknown>),
          });
        }
        continue;
      }

      const { data, error } = await supabase.rpc("ingest_gov_entity_filing", {
        p_source: "uspto_patent",
        p_accession: p.publicationNumber,
        p_entity_name: p.assignee,
        p_filing_date: p.publicationDate ?? to,
        p_entity_number: p.applicationNumber,
        p_country: "United States",
        p_codes: p.cpcCodes,
        p_title: p.title,
        p_abstract: p.abstract,
        p_officers: inventorsAsOfficers(p),
        p_tech_summary: techSummary(p),
        p_raw: p,
      });

      if (error) { results.push({ publication: p.publicationNumber, ok: false, reason: error.message }); continue; }
      ingested++;
      if ((data as { created_startup?: boolean })?.created_startup) created++;
      results.push({ publication: p.publicationNumber, ok: true, assignee: p.assignee, title: p.title, ...(data as Record<string, unknown>) });
    }

    return json({
      from, to, dryRun, scanned, offTopic, unmappable,
      ingested, createdStartups: created,
      // The founder-watchlist count: publications with no company behind them.
      inventorHeld,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed" }, 500);
  }
});
