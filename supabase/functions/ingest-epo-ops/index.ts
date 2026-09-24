// =============================================================================
// Supabase Edge Function: ingest-epo-ops
//
// Patent sourcing via the European Patent Office's Open Patent Services.
//
// ── WHY EPO AND NOT USPTO ───────────────────────────────────────────────────
// USPTO's Open Data Portal and PatentsView now gate API keys behind ID.me,
// which requires a US Social Security Number or US government ID. That is not
// a rate limit or a fee — it is a barrier a non-US team cannot clear at all.
//
// EPO OPS issues credentials on ordinary business registration: an email and an
// organisation name, no identity proofing. And the thing that makes this a
// solution rather than a consolation prize — OPS serves DOCDB, EPO's WORLDWIDE
// collection. US publications are in it. `cpc=G06N and pn=US` returns US
// applications. We are not trading US coverage for accessibility.
//
// What we do give up, stated plainly:
//   * DOCDB lags USPTO direct by days to a couple of weeks. Against an 18-month
//     pre-grant publication delay this is noise.
//   * Applicant names come through EPO's normalisation, not USPTO's. Hence a
//     distinct `epo_ops` source value — see migration 20260726150000.
//   * Free-tier throughput is capped (GBs/month). Far above what this needs.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          EPO_OPS_KEY + EPO_OPS_SECRET (REQUIRED)
//            Register at https://developers.epo.org -> My Apps -> create app.
//            supabase secrets set EPO_OPS_KEY="..." EPO_OPS_SECRET="..."
//
// Deploy:  supabase functions deploy ingest-epo-ops --no-verify-jwt
// Invoke:  POST {}                          -> last 14 days, deep-tech CPC
//          POST { "from":"2026-07-01", "to":"2026-07-26" }
//          POST { "countries": ["US","GB"] }
//          POST { "cpc": ["G06N","B25J"] }  -> narrow the CPC sweep
//          POST { "maxPublicationsPer30d": 8 }  -> tighten/loosen the scale cap
//          POST { "rawSample": true }       -> dump one untouched record
//          POST { "dryRun": true }
//
// ── THE OPS JSON TRAP, WHICH WILL BITE ANYONE WHO EDITS THIS ────────────────
// OPS serialises XML to JSON by collapsing single-element lists into bare
// objects. `inventors.inventor` is an ARRAY when there are two inventors and an
// OBJECT when there is one. Every list access here goes through asArray() for
// that reason. A naive `.map()` works perfectly in testing against a
// multi-inventor record and throws on the first solo inventor in production.
//
// Text nodes are likewise wrapped: {"$": "value"}. Hence text().
//
// ── VERIFICATION STATUS ─────────────────────────────────────────────────────
// The sandbox blocks outbound HTTPS, so neither auth nor search has run against
// live OPS. Pure logic — CQL construction, the JSON-collapse handling, CPC
// symbol assembly, applicant/inventor extraction — is tested in epo.test.mjs
// against OPS's documented response shape. RUN { "rawSample": true } FIRST.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const AUTH_URL = "https://ops.epo.org/3.2/auth/accesstoken";
const SEARCH_URL = "https://ops.epo.org/3.2/rest-services/published-data/search/biblio";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 400;
const PAGE_SIZE = 100;          // OPS caps a Range window at 100
const REQUEST_DELAY_MS = 1200;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_WINDOW_DAYS = 14;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same hierarchy as the USPTO adapter — CPC is shared across offices. */
export const DEEPTECH_CPC_PREFIXES = [
  "G06N", "G06V", "G16Y", "G06F40", "G10L15", "G10L17", "B25J", "G05D1",
  "H01L", "H03K19", "G02B6", "H04L9", "G21B", "H01M", "C12N15", "G16B",
];

export const isDeepTechCpc = (codes: string[] | null | undefined): boolean =>
  Array.isArray(codes) &&
  codes.some((c) => {
    const s = String(c).toUpperCase().replace(/\s+/g, "");
    return DEEPTECH_CPC_PREFIXES.some((p) => s.startsWith(p));
  });

// ── OPS JSON helpers ────────────────────────────────────────────────────────

/**
 * OPS collapses single-element lists to bare objects. Always go through this.
 *
 * This is the single most likely source of a production-only crash in this
 * file: a record with two inventors gives an array and one with a solo
 * inventor gives an object, so code that works on every test fixture with
 * multiple parties throws on the first solo one.
 */
export function asArray<T = Record<string, unknown>>(v: unknown): T[] {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

/** OPS wraps text nodes as {"$": "value"}. Unwrap, or pass through a string. */
export function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "$" in (v as Record<string, unknown>)) {
    const s = (v as Record<string, unknown>)["$"];
    return typeof s === "string" ? s.trim() || null : (s == null ? null : String(s));
  }
  return null;
}

/**
 * Reassemble a CPC symbol from its exploded parts.
 *
 * OPS returns classification as separate section/class/subclass/main-group/
 * subgroup elements rather than the printed symbol, so "G06N3/08" has to be put
 * back together. Anything missing a section is skipped rather than emitted as a
 * partial symbol that would silently fail every prefix match.
 */
export function cpcSymbol(pc: Record<string, unknown>): string | null {
  const section = text(pc?.section);
  if (!section) return null;
  const klass = text(pc?.["class"]) ?? "";
  const subclass = text(pc?.subclass) ?? "";
  const main = text(pc?.["main-group"]) ?? "";
  const sub = text(pc?.subgroup) ?? "";
  const head = `${section}${klass}${subclass}`;
  return main ? `${head}${main}${sub ? `/${sub}` : ""}` : head;
}

// ── Model ───────────────────────────────────────────────────────────────────

export interface OpsPublication {
  publicationNumber: string;   // "US2026012345A1"
  country: string | null;
  docNumber: string | null;
  kind: string | null;
  familyId: string | null;
  applicationNumber: string | null;
  title: string | null;
  abstract: string | null;
  publicationDate: string | null;   // YYYY-MM-DD
  applicant: string | null;         // the as-filed company name, where present
  inventors: string[];
  cpcCodes: string[];
}

/** "20260716" -> "2026-07-16". OPS dates are unpunctuated. */
export const opsDate = (d: string | null): string | null =>
  d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;

/**
 * Parse one <exchange-document>.
 *
 * Applicants arrive twice, once per @data-format: "epodoc" is EPO's normalised
 * form ("SYNTHORAI TECH INC [US]") and "original" is the name as filed. We
 * prefer original — the normalised form truncates and uppercases, which makes
 * name-matching against `startups` markedly worse.
 */
export function parseExchangeDocument(doc: Record<string, unknown>): OpsPublication | null {
  const biblio = (doc?.["bibliographic-data"] ?? {}) as Record<string, unknown>;

  // The docdb-format document-id carries the parts we key on.
  const pubRefs = asArray((biblio?.["publication-reference"] as Record<string, unknown>)?.["document-id"]);
  const docdb = pubRefs.find((d) => (d as Record<string, unknown>)?.["@document-id-type"] === "docdb")
    ?? pubRefs[0];
  const country = text((docdb as Record<string, unknown>)?.country) ?? text(doc?.["@country"]);
  const docNumber = text((docdb as Record<string, unknown>)?.["doc-number"]) ?? text(doc?.["@doc-number"]);
  const kind = text((docdb as Record<string, unknown>)?.kind) ?? text(doc?.["@kind"]);
  if (!country || !docNumber) return null;
  const publicationNumber = `${country}${docNumber}${kind ?? ""}`;

  const appRefs = asArray((biblio?.["application-reference"] as Record<string, unknown>)?.["document-id"]);
  const appDocdb = appRefs.find((d) => (d as Record<string, unknown>)?.["@document-id-type"] === "docdb")
    ?? appRefs[0];

  // Titles are per-language; prefer English, else take the first.
  const titles = asArray(biblio?.["invention-title"]);
  const title = text(titles.find((t) => (t as Record<string, unknown>)?.["@lang"] === "en") ?? titles[0]);

  const parties = (biblio?.parties ?? {}) as Record<string, unknown>;
  const applicants = asArray((parties?.applicants as Record<string, unknown>)?.applicant);
  const pickApplicant = (fmt: string) =>
    text((applicants.find((a) => (a as Record<string, unknown>)?.["@data-format"] === fmt) as
      Record<string, unknown>)?.["applicant-name"]
      ? ((applicants.find((a) => (a as Record<string, unknown>)?.["@data-format"] === fmt) as
        Record<string, unknown>)["applicant-name"] as Record<string, unknown>).name
      : null);
  const applicantRaw = pickApplicant("original") ?? pickApplicant("epodoc")
    ?? text((applicants[0] as Record<string, unknown>)?.["applicant-name"]
      ? ((applicants[0] as Record<string, unknown>)["applicant-name"] as Record<string, unknown>).name
      : null);

  const inventorRecs = asArray((parties?.inventors as Record<string, unknown>)?.inventor);
  const seen = new Set<string>();
  const inventors: string[] = [];
  for (const iv of inventorRecs) {
    const rec = iv as Record<string, unknown>;
    // Skip the epodoc duplicate of each person; original is the readable form.
    if (rec?.["@data-format"] === "epodoc" && inventorRecs.length > 1) continue;
    const n = text((rec?.["inventor-name"] as Record<string, unknown>)?.name);
    if (n && !seen.has(n)) { seen.add(n); inventors.push(n); }
  }

  const pcs = asArray((biblio?.["patent-classifications"] as Record<string, unknown>)?.["patent-classification"]);
  const cpcCodes: string[] = [];
  for (const pc of pcs) {
    const sym = cpcSymbol(pc as Record<string, unknown>);
    if (sym && !cpcCodes.includes(sym)) cpcCodes.push(sym);
  }

  // Abstract paragraphs: one <p> or several.
  const abs = doc?.abstract as Record<string, unknown> | undefined;
  const abstract = abs
    ? asArray(abs.p).map((p) => text(p)).filter(Boolean).join(" ") || null
    : null;

  return {
    publicationNumber,
    country,
    docNumber,
    kind,
    familyId: text(doc?.["@family-id"]),
    applicationNumber: text((appDocdb as Record<string, unknown>)?.["doc-number"]),
    title,
    abstract,
    publicationDate: opsDate(text((docdb as Record<string, unknown>)?.date)),
    // An applicant that is obviously a person, not a company, is treated as
    // absent so it takes the inventor-held path rather than creating a
    // `startups` row named after somebody.
    applicant: applicantRaw && looksLikeOrganisation(applicantRaw) ? applicantRaw : null,
    inventors,
    cpcCodes,
  };
}

/**
 * Whether an applicant name is a company rather than an individual.
 *
 * EPO records individual applicants as "SATO, RIN" — surname, comma, forename.
 * Creating a startups row for one would put a person's name in a company table
 * and then probe an ATS board for it. A comma with no corporate suffix is the
 * reliable tell; anything with a legal form is a company regardless.
 */
export function looksLikeOrganisation(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  if (/\b(inc|llc|ltd|limited|corp|corporation|gmbh|s\.?a\.?|b\.?v\.?|n\.?v\.?|plc|ag|kg|oy|ab|as|sas|srl|pte|pty|co|company|technologies|labs|university|institut|universit|research)\b\.?/i.test(n)) {
    return true;
  }
  // "SATO, RIN" — one comma, two short parts, no corporate marker.
  if (/^[^,]+,\s*[^,]+$/.test(n) && n.split(/\s+/).length <= 4) return false;
  return true;
}

// ── Query ───────────────────────────────────────────────────────────────────

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const compact = (iso: string) => iso.replace(/-/g, "");

/**
 * OPS Common Query Language.
 *
 * CPC terms are OR-ed into one query rather than issued separately: OPS bills
 * the free tier on throughput and caps requests per minute, so sixteen searches
 * returning a handful each is strictly worse than one returning a hundred.
 *
 * `pd within "A B"` is OPS's date-range form — a bare `pd=A-B` is not valid CQL
 * and returns a 400 that reads like a server error.
 */
export function buildCql(opts: { cpc: string[]; countries: string[]; from: string; to: string }): string {
  const parts: string[] = [`pd within "${compact(opts.from)} ${compact(opts.to)}"`];
  if (opts.cpc.length) parts.push(`(${opts.cpc.map((c) => `cpc=${c}`).join(" or ")})`);
  if (opts.countries.length) parts.push(`(${opts.countries.map((c) => `pn=${c}`).join(" or ")})`);
  return parts.join(" and ");
}

export function searchUrl(cql: string, start: number, size = PAGE_SIZE): string {
  const p = new URLSearchParams({ q: cql });
  return `${SEARCH_URL}?${p.toString()}&Range=${start}-${start + size - 1}`;
}

// ── The private-market boundary ─────────────────────────────────────────────
//
// Patents are the only source here that skews CORPORATE: two weeks of deep-tech
// CPC across US+GB returns ~3,000 publications led by IBM, Samsung, Qualcomm
// and universities. Nothing downstream catches them — classify_company_archetype
// fails open (no funding rows means venture_backed, and Samsung has no funding
// rows in this database), and startups.industry is NULL for patent rows so the
// sector escape hatch passes them too. Without a filter here, Samsung enters
// board_discovery_candidates and spends ATS probe budget.
//
// Two filters, because neither is sufficient:
//
//   NAME DENYLIST (patent_excluded_applicants) — high precision, and zero
//   recall for the incumbent nobody thought to list.
//
//   FREQUENCY CAP (below) — lower precision, excellent recall, and it maintains
//   itself. An applicant filing forty publications a fortnight is not a startup
//   whether or not anyone added them to a list, and that stays true as new
//   incumbents appear. This is the half that keeps working.

/** Publications per applicant per 30 days above which a filer is not a startup. */
export const DEFAULT_MAX_PUBS_PER_30D = 8;

/**
 * Scale the cap to the window actually queried.
 *
 * A flat "10 per run" would mean something different for a fortnight than for a
 * year. Normalising to a rate keeps the threshold meaningful whatever `from`
 * and `to` are, and the floor of 3 stops a one-day window from excluding a
 * company for filing twice on a Tuesday.
 */
export function allowedPublications(from: string, to: string, per30d = DEFAULT_MAX_PUBS_PER_30D): number {
  const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86_400_000);
  return Math.max(3, Math.ceil((days / 30) * per30d));
}

/** Match the SQL side of normalisation so counts group the same way. */
export const normalizeApplicant = (name: string): string =>
  name.toLowerCase()
    .replace(/\[[a-z]{2}\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Count publications per normalised applicant within a batch. */
export function countByApplicant(pubs: { applicant: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of pubs) {
    if (!p.applicant) continue;   // inventor-held rows are never capped
    const k = normalizeApplicant(p.applicant);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function techSummary(p: OpsPublication): string {
  const parts: string[] = [];
  if (p.cpcCodes.length) parts.push(`CPC ${p.cpcCodes.slice(0, 4).join(", ")}`);
  if (p.publicationDate) parts.push(`published ${p.publicationDate}`);
  if (p.country) parts.push(`${p.country} publication`);
  if (!p.applicant) parts.push("no corporate applicant — inventor-held");
  if (p.inventors.length) parts.push(`${p.inventors.length} ${p.inventors.length === 1 ? "inventor" : "inventors"}`);
  return parts.join("; ");
}

export const inventorsAsOfficers = (p: OpsPublication) =>
  p.inventors.map((name) => ({ name, relationships: ["Inventor"] }));

// ── Auth ────────────────────────────────────────────────────────────────────
// Module scope: an Edge Function isolate is reused across invocations, so a
// token fetched on one request is usually still valid on the next. OPS tokens
// last 20 minutes; refresh at 18 to stay clear of the edge.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(key: string, secret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${key}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OPS auth returned ${res.status} — check EPO_OPS_KEY/EPO_OPS_SECRET are the Consumer Key and Secret from developers.epo.org (not an app name)`);
  }
  const body = await res.json() as { access_token?: string; expires_in?: string };
  if (!body?.access_token) throw new Error("OPS auth returned no access_token");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + 18 * 60_000 };
  return cachedToken.value;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const opsKey = Deno.env.get("EPO_OPS_KEY")?.trim();
  const opsSecret = Deno.env.get("EPO_OPS_SECRET")?.trim();
  if (!opsKey || !opsSecret) {
    return json({
      error: "EPO_OPS_KEY / EPO_OPS_SECRET are not set.",
      fix: 'Register free at https://developers.epo.org (email + organisation, no identity proofing), create an app, then: supabase secrets set EPO_OPS_KEY="..." EPO_OPS_SECRET="..."',
    }, 500);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  let rawSample = false;
  let cpc = DEEPTECH_CPC_PREFIXES;
  let countries = ["US", "GB"];
  let maxPubsPer30d = DEFAULT_MAX_PUBS_PER_30D;
  let to = ymd(new Date());
  let from = ymd(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000));
  try {
    const b = await req.json();
    const n = Number(b?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    dryRun = b?.dryRun === true;
    rawSample = b?.rawSample === true;
    if (Array.isArray(b?.cpc) && b.cpc.length) cpc = b.cpc.map(String);
    if (Array.isArray(b?.countries)) countries = b.countries.map(String);
    const mp = Number(b?.maxPublicationsPer30d);
    if (Number.isFinite(mp) && mp > 0) maxPubsPer30d = Math.floor(mp);
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof b?.from === "string" && iso.test(b.from)) from = b.from;
    if (typeof b?.to === "string" && iso.test(b.to)) to = b.to;
  } catch { /* defaults */ }

  const cql = buildCql({ cpc, countries, from, to });

  try {
    const token = await getToken(opsKey, opsSecret);
    const opsGet = (url: string) => fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const kept: OpsPublication[] = [];
    let start = 1;
    let scanned = 0;
    let offTopic = 0;
    let unmappable = 0;
    let totalHits: number | null = null;

    while (kept.length < limit) {
      const res = await opsGet(searchUrl(cql, start));
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return json({
          error: `OPS returned ${res.status}`,
          cql,
          hint: res.status === 400
            ? "CQL rejected — OPS uses `pd within \"YYYYMMDD YYYYMMDD\"`, not a bare range"
            : res.status === 403
            ? "quota exhausted or credentials rejected"
            : undefined,
          body: body.slice(0, 400),
        }, 502);
      }
      const payload = await res.json() as Record<string, unknown>;
      const world = (payload?.["ops:world-patent-data"] ?? {}) as Record<string, unknown>;
      const search = (world?.["ops:biblio-search"] ?? {}) as Record<string, unknown>;
      totalHits = totalHits ?? Number(text(search?.["@total-result-count"]) ?? search?.["@total-result-count"] ?? 0);
      const result = (search?.["ops:search-result"] ?? {}) as Record<string, unknown>;
      const docs = asArray(result?.["exchange-documents"])
        .flatMap((d) => asArray((d as Record<string, unknown>)?.["exchange-document"]));

      if (rawSample) {
        return json({
          note: "raw first record, unmapped. Correct parseExchangeDocument() against this if the mapping is wrong, then re-run without rawSample.",
          cql,
          totalHits,
          topLevelKeys: Object.keys(payload ?? {}),
          firstRecord: docs[0] ?? null,
          mappedAs: docs[0] ? parseExchangeDocument(docs[0] as Record<string, unknown>) : null,
        });
      }

      if (docs.length === 0) break;

      for (const d of docs) {
        scanned++;
        const p = parseExchangeDocument(d as Record<string, unknown>);
        if (!p) { unmappable++; continue; }
        if (!isDeepTechCpc(p.cpcCodes)) { offTopic++; continue; }
        kept.push(p);
        if (kept.length >= limit) break;
      }

      start += docs.length;
      if (docs.length < PAGE_SIZE) break;
      if (totalHits !== null && start > totalHits) break;
      await sleep(REQUEST_DELAY_MS);
    }

    if (unmappable > 0 && kept.length === 0) {
      return json({
        error: `every record failed to map (${unmappable} of ${scanned}) — the response shape is not what parseExchangeDocument expects`,
        fix: 'run with { "rawSample": true } and correct the mapping',
        cql,
      }, 502);
    }
    if (kept.length === 0) {
      return json({ cql, totalHits, scanned, offTopic, ingested: 0, note: "no deep-tech publications in range" });
    }

    // ── Private-market boundary ─────────────────────────────────────────────
    // Applied AFTER fetching, because both filters need the whole batch: the
    // denylist is one round trip for every distinct applicant rather than one
    // per publication, and the frequency cap is meaningless per-record.
    const distinctApplicants = [...new Set(
      kept.map((p) => p.applicant).filter((a): a is string => Boolean(a)),
    )];

    const denied = new Set<string>();
    if (distinctApplicants.length > 0) {
      // One RPC per distinct applicant would be hundreds of round trips. Ask
      // the database which of these names it considers out of scope in a
      // single call instead.
      const { data: verdicts, error: denyErr } = await supabase
        .rpc("filter_excluded_applicants", { p_names: distinctApplicants });
      if (denyErr) {
        return json({
          error: `denylist lookup failed: ${denyErr.message}`,
          hint: "migration 20260726160000 (patent_excluded_applicants) may not be applied",
        }, 500);
      }
      for (const row of (verdicts ?? []) as { name: string }[]) denied.add(row.name);
    }

    // Historical counts, so an incumbent already over the cap is dropped
    // without having to re-observe them from scratch every run.
    const historical = new Map<string, number>();
    if (distinctApplicants.length > 0) {
      const { data: hist } = await supabase
        .rpc("count_patent_publications", { p_names: distinctApplicants, p_since: from });
      for (const row of (hist ?? []) as { normalized: string; publications: number }[]) {
        historical.set(row.normalized, Number(row.publications) || 0);
      }
    }

    const cap = allowedPublications(from, to, maxPubsPer30d);
    const inBatch = countByApplicant(kept);
    const overCap = new Set<string>();
    for (const [norm, n] of inBatch) {
      if (n + (historical.get(norm) ?? 0) > cap) overCap.add(norm);
    }

    const excluded = { denylisted: 0, overCap: 0 };
    const excludedNames = new Set<string>();
    const inScope = kept.filter((p) => {
      // Inventor-held publications bypass both filters by construction: there
      // is no applicant to deny, and an individual cannot be a conglomerate.
      // These are the highest-value rows in this layer and must never be lost
      // to a corporate filter.
      if (!p.applicant) return true;
      if (denied.has(p.applicant)) {
        excluded.denylisted++; excludedNames.add(p.applicant); return false;
      }
      if (overCap.has(normalizeApplicant(p.applicant))) {
        excluded.overCap++; excludedNames.add(p.applicant); return false;
      }
      return true;
    });

    if (dryRun) {
      return json({
        cql, totalHits, dryRun: true, scanned, offTopic,
        cap, capWindowDays: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000),
        excluded,
        excludedApplicants: [...excludedNames].slice(0, 40),
        wouldIngest: inScope.length,
        inventorHeld: inScope.filter((p) => !p.applicant).length,
        sample: inScope.slice(0, 25).map((p) => ({
          publication: p.publicationNumber, applicant: p.applicant,
          inventors: p.inventors.length, cpc: p.cpcCodes.slice(0, 3), title: p.title,
        })),
      });
    }

    if (inScope.length === 0) {
      return json({
        cql, totalHits, scanned, offTopic, cap, excluded, ingested: 0,
        note: "every publication in range was out of the private-market boundary",
      });
    }

    const results: Array<Record<string, unknown>> = [];
    let ingested = 0;
    let created = 0;
    let inventorHeld = 0;

    for (const p of inScope) {
      // No corporate applicant means an inventor-held filing — the earliest
      // signal in this whole pipeline. Stored unlinked, with the inventors, as
      // a founder watchlist. Deliberately NOT given a startups row: there is no
      // company to create yet, and inventing one named after a person would
      // corrupt the entity table and send the ATS prober after a human.
      //
      // Routed through the RPC rather than a raw upsert (as this used to be):
      // a raw upsert's ON CONFLICT would blindly overwrite officers/title/
      // abstract on every re-ingest, so a later re-parse that came back with
      // zero inventors would silently wipe a previously-captured inventor
      // list. ingest_gov_entity_filing's ON CONFLICT never lets an empty
      // officers array overwrite a populated one — see
      // 20260726220000_gov_entity_resolution_and_unlinked_fix.sql.
      if (!p.applicant) {
        inventorHeld++;
        const { data, error } = await supabase.rpc("ingest_gov_entity_filing", {
          p_source: "epo_ops",
          p_accession: p.publicationNumber,
          p_entity_name: p.inventors[0] ? `${p.inventors[0]} (inventor-held)` : "Unassigned publication",
          p_filing_date: p.publicationDate ?? to,
          p_entity_number: p.applicationNumber,
          p_country: p.country === "GB" ? "United Kingdom" : "United States",
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
            publication: p.publicationNumber, ok: true, applicant: null,
            inventors: p.inventors.length, ...(data as Record<string, unknown>),
          });
        }
        continue;
      }

      const { data, error } = await supabase.rpc("ingest_gov_entity_filing", {
        p_source: "epo_ops",
        p_accession: p.publicationNumber,
        p_entity_name: p.applicant,
        p_filing_date: p.publicationDate ?? to,
        p_entity_number: p.applicationNumber,
        p_country: p.country === "GB" ? "United Kingdom" : "United States",
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
      results.push({ publication: p.publicationNumber, ok: true, applicant: p.applicant, ...(data as Record<string, unknown>) });
    }

    return json({
      cql, totalHits, from, to, scanned, offTopic, unmappable,
      // The private-market boundary, reported rather than silent: a run that
      // drops 90% of what it fetched should say so on the face of the result.
      cap, excluded,
      ingested, createdStartups: created,
      inventorHeld,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed", cql }, 500);
  }
});
