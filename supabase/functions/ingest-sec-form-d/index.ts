// =============================================================================
// Supabase Edge Function: ingest-sec-form-d
//
// The INCEPTION layer. Every other source in this pipeline is downstream of a
// company already being visible: an ATS board means they are hiring, which
// means they have money and staff and a careers page. SEC Form D fires at the
// moment the money arrives — often before there is a website — and it carries
// the one field the FOMO engine has never had: the incorporation year.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          SEC_USER_AGENT  (REQUIRED — see below)
//
// Deploy:  supabase functions deploy ingest-sec-form-d --no-verify-jwt
// Invoke:  POST {}                          -> yesterday (UTC), up to 50 filings
//          POST { "date": "2026-07-24" }    -> a specific filing day
//          POST { "limit": 200 }            -> more of that day
//          POST { "dryRun": true }          -> parse and classify, write nothing
//
// ── SEC_USER_AGENT IS NOT OPTIONAL ──────────────────────────────────────────
// SEC's access policy requires a User-Agent identifying the requester with a
// contact address, and serves 403 to anything generic. Set it once:
//
//   supabase secrets set SEC_USER_AGENT="AlphaMap sourcing you@yourdomain.com"
//
// This function refuses to start without it rather than firing anonymous
// traffic at a federal system and getting the project's egress IP blocked.
// SEC also caps clients at 10 requests/second; REQUEST_DELAY_MS keeps us at
// roughly 8, sequentially.
//
// ── WHAT GETS THROWN AWAY, AND WHY THAT IS MOST OF IT ───────────────────────
// Form D is dominated by INVESTMENT FUNDS. Every VC fund files one per vehicle,
// so on a typical day the majority of filings are "Pooled Investment Fund" —
// the funds that invest in startups, not startups. Ingesting those would fill
// `startups` with fund vehicles named "XYZ Ventures IV, L.P.". They are
// excluded on SEC's own industryGroupType and on the presence of
// investmentFundInfo.
//
// Funds are no longer discarded: they are routed to vc_fund_filings, where a
// firm's successive vehicles form its raising history and the related-persons
// list is the closest thing to a public GP roster that exists. Rejected as
// companies, kept as intelligence.
//
// Tech filtering also uses SEC's taxonomy rather than keyword-matching company
// names. It is a classification the filer selected under penalty of perjury,
// which beats guessing "AI" from a name — and unlike our classify_sector_parent
// heuristics it cannot be fooled by a company called "Quantum Cleaning
// Services".
//
// ── VERIFICATION STATUS, STATED PLAINLY ─────────────────────────────────────
// The sandbox this was written in blocks outbound HTTPS to sec.gov (the proxy
// denies CONNECT), so the fetch path has NOT been exercised against the live
// service. Everything pure — index parsing, XML extraction, the tech/fund
// filters, slug handling — is tested offline against fixtures matching SEC's
// documented Form D schema, in formd.test.mjs. Treat the first live run as the
// real test, and run it with dryRun first.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// ~8 req/s against SEC's documented ceiling of 10.
const REQUEST_DELAY_MS = 120;
const FETCH_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── SEC taxonomy ────────────────────────────────────────────────────────────

/**
 * industryGroupType values we treat as in scope.
 *
 * The first three are the leaves under SEC's "Technology" parent; filers
 * sometimes submit the parent itself, so it is listed too. Biotechnology is
 * included as a deliberate judgement — it is the one Health Care leaf that is
 * consistently deep tech — and it is the obvious thing to remove if the
 * leaderboard fills with therapeutics companies.
 */
export const TECH_INDUSTRY_GROUPS = new Set([
  "technology",
  "computers",
  "telecommunications",
  "other technology",
  "biotechnology",
]);

/** Fund vehicles. The majority of Form D filings, and none of them companies. */
export const FUND_INDUSTRY_GROUPS = new Set([
  "pooled investment fund",
  "other investment fund",
]);

// ── Pure XML helpers ────────────────────────────────────────────────────────
//
// A hand-rolled extractor rather than an XML library. Form D's primary_doc.xml
// is a shallow, fixed, namespace-free schema and the handful of fields we need
// are unambiguous, so a dependency would buy robustness we do not need against
// a shape that does not vary. It also keeps the module importable in a plain
// Node test without resolving a remote package.
//
// LIMITATION, stated rather than discovered later: the block matcher is
// non-greedy and therefore cannot handle an element nested inside another of
// the SAME name. Form D contains no such element. If SEC ever ships one, this
// silently reads the inner one — so anything added here should be checked
// against the live schema first.

const escapeTag = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // &amp; last, so "&amp;lt;" decodes to "&lt;" and not "<".
    .replace(/&amp;/gi, "&");
}

/** Inner XML of the first <name>...</name>, or null. */
export function tagBlock(xml: string, name: string): string | null {
  const m = new RegExp(`<${escapeTag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(name)}>`, "i").exec(xml);
  return m ? m[1] : null;
}

/** Inner XML of every <name>...</name>. */
export function tagBlocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${escapeTag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(name)}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Decoded text of the first <name>, trimmed. Empty becomes null. */
export function tagText(xml: string, name: string): string | null {
  const b = tagBlock(xml, name);
  if (b === null) return null;
  const t = decodeEntities(b).trim();
  return t === "" ? null : t;
}

const tagBool = (xml: string, name: string): boolean =>
  (tagText(xml, name) ?? "").toLowerCase() === "true";

function tagNumber(xml: string, name: string): number | null {
  const t = tagText(xml, name);
  if (t === null) return null;
  // Filers submit "5,000,000" and "$5000000" as well as bare digits.
  const n = Number(t.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ── Form D model ────────────────────────────────────────────────────────────

export interface FormDOfficer { name: string; relationships: string[]; }

export interface FormD {
  submissionType: string | null;
  cik: string | null;
  entityName: string | null;
  jurisdiction: string | null;
  yearOfInc: number | null;
  /** true when the issuer declared incorporation within the last five years. */
  withinFiveYears: boolean;
  /** true when the entity does not legally exist yet — earlier than early. */
  yetToBeFormed: boolean;
  industryGroup: string | null;
  isFund: boolean;
  /** SEC investmentFundType: 'Venture Capital Fund', 'Private Equity Fund', ... */
  fundType: string | null;
  officers: FormDOfficer[];
  totalOffering: number | null;
  totalSold: number | null;
  dateOfFirstSale: string | null;
}

/**
 * Parse a Form D primary_doc.xml.
 *
 * Pure and exported so the whole taxonomy can be regression-tested against real
 * document shapes with no network and no database.
 *
 * Returns null only when the document has no issuer name — without one there is
 * nothing to key an entity on and nothing worth storing.
 */
export function parseFormD(xml: string): FormD | null {
  const issuer = tagBlock(xml, "primaryIssuer") ?? "";
  const entityName = tagText(issuer, "entityName");
  if (!entityName) return null;

  // Scope <value> to the yearOfInc block: the element name is generic and
  // reading it from the whole document would pick up whatever came first.
  const yearBlock = tagBlock(issuer, "yearOfInc") ?? "";
  const yearRaw = tagNumber(yearBlock, "value");

  const offering = tagBlock(xml, "offeringData") ?? "";
  const industryBlock = tagBlock(offering, "industryGroup") ?? "";
  const industryGroup = tagText(industryBlock, "industryGroupType");

  // Two independent tells for a fund, because either alone has been seen to
  // miss: the declared industry group, and the presence of the fund-specific
  // sub-block that only a pooled vehicle fills in.
  const fundInfo = tagBlock(industryBlock, "investmentFundInfo");
  const isFund =
    FUND_INDUSTRY_GROUPS.has((industryGroup ?? "").toLowerCase()) ||
    fundInfo !== null;
  const fundType = fundInfo ? tagText(fundInfo, "investmentFundType") : null;

  const officers: FormDOfficer[] = [];
  for (const person of tagBlocks(tagBlock(xml, "relatedPersonsList") ?? "", "relatedPersonInfo")) {
    const nameBlock = tagBlock(person, "relatedPersonName") ?? "";
    const name = [
      tagText(nameBlock, "firstName"),
      tagText(nameBlock, "middleName"),
      tagText(nameBlock, "lastName"),
    ].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const relBlock = tagBlock(person, "relatedPersonRelationshipList") ?? "";
    officers.push({
      name,
      relationships: tagBlocks(relBlock, "relationship")
        .map((r) => decodeEntities(r).trim())
        .filter(Boolean),
    });
  }

  const amounts = tagBlock(offering, "offeringSalesAmounts") ?? "";

  return {
    submissionType: tagText(xml, "submissionType"),
    cik: tagText(issuer, "cik"),
    entityName,
    jurisdiction: tagText(issuer, "jurisdictionOfInc"),
    yearOfInc: yearRaw,
    withinFiveYears: tagBool(yearBlock, "withinFiveYears"),
    yetToBeFormed: tagBool(yearBlock, "yetToBeFormed"),
    industryGroup,
    isFund,
    fundType,
    officers,
    totalOffering: tagNumber(amounts, "totalOfferingAmount"),
    totalSold: tagNumber(amounts, "totalAmountSold"),
    dateOfFirstSale: tagText(tagBlock(offering, "typeOfFiling") ?? "", "dateOfFirstSale"),
  };
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export type RejectReason = "fund" | "not_tech" | "too_old" | "no_name";

/**
 * Whether a parsed filing belongs in the pipeline.
 *
 * Order matters for the reported reason, not the outcome: funds are checked
 * first because "not_tech" would be a misleading label for a venture fund whose
 * industry group happens to be blank.
 */
export function classifyFiling(f: FormD | null): { eligible: boolean; reason?: RejectReason } {
  if (!f || !f.entityName) return { eligible: false, reason: "no_name" };
  if (f.isFund) return { eligible: false, reason: "fund" };
  if (!TECH_INDUSTRY_GROUPS.has((f.industryGroup ?? "").toLowerCase())) {
    return { eligible: false, reason: "not_tech" };
  }
  // An inception layer wants inceptions. A twenty-year-old company raising a
  // late round files exactly the same document, and it is not what this is for.
  // yetToBeFormed passes: an entity that does not legally exist yet is earlier
  // than early, and is precisely the catch worth having.
  if (!f.withinFiveYears && !f.yetToBeFormed) return { eligible: false, reason: "too_old" };
  return { eligible: true };
}

/** Short human digest. Derived only — never a substitute for the columns. */
export function techSummary(f: FormD): string {
  const parts: string[] = [];
  if (f.industryGroup) parts.push(`SEC industry: ${f.industryGroup}`);
  if (f.yetToBeFormed) parts.push("entity not yet formed at filing");
  else if (f.yearOfInc) parts.push(`incorporated ${f.yearOfInc}`);
  if (f.jurisdiction) parts.push(`in ${f.jurisdiction}`);
  if (f.totalOffering !== null) {
    const sold = f.totalSold !== null ? `, ${f.totalSold.toLocaleString("en-US")} sold` : "";
    parts.push(`offering ${f.totalOffering.toLocaleString("en-US")}${sold}`);
  }
  if (f.officers.length) parts.push(`${f.officers.length} related ${f.officers.length === 1 ? "person" : "people"}`);
  return parts.join("; ");
}

// ── Daily index ─────────────────────────────────────────────────────────────

export interface IndexRow {
  formType: string;
  companyName: string;
  cik: string;
  dateFiled: string;   // YYYYMMDD
  fileName: string;    // edgar/data/<cik>/<accession>.txt
  accession: string;   // 0001234567-26-000123
}

/**
 * Parse SEC's form.YYYYMMDD.idx, keeping only Form D and its amendments.
 *
 * The file is nominally fixed-width, but column positions have shifted over the
 * years and company names run long enough to collide with them. Anchoring on
 * the two unambiguous fields instead — a numeric CIK and an 8-digit date, each
 * separated by two or more spaces — survives that.
 */
export function parseDailyIndex(text: string): IndexRow[] {
  const out: IndexRow[] = [];
  const line = /^(\S+)\s{2,}(.+?)\s{2,}(\d+)\s{2,}(\d{8})\s{2,}(\S+)\s*$/;
  for (const raw of text.split(/\r?\n/)) {
    const m = line.exec(raw);
    if (!m) continue;
    const [, formType, companyName, cik, dateFiled, fileName] = m;
    // "D" and "D/A" only. Startswith would also catch "DEF 14A".
    if (formType !== "D" && formType !== "D/A") continue;
    const accession = (fileName.split("/").pop() ?? "").replace(/\.txt$/i, "");
    if (!accession) continue;
    out.push({ formType, companyName: companyName.trim(), cik, dateFiled, fileName, accession });
  }
  return out;
}

/** SEC files daily indexes under a quarter directory. */
export const quarterOf = (month: number): number => Math.floor((month - 1) / 3) + 1;

export function dailyIndexUrl(date: Date): string {
  const y = date.getUTCFullYear();
  const q = quarterOf(date.getUTCMonth() + 1);
  const stamp = `${y}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${stamp}.idx`;
}

export function primaryDocUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, "")}/${accession.replace(/-/g, "")}/primary_doc.xml`;
}

/** YYYYMMDD -> YYYY-MM-DD, for the date column. */
export const isoDate = (yyyymmdd: string): string =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

// ── Fetching ────────────────────────────────────────────────────────────────

async function secFetch(url: string, userAgent: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, {
    headers: {
      // SEC's policy: identify yourself with a contact address.
      "User-Agent": userAgent,
      "Accept-Encoding": "gzip, deflate",
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : "" };
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const userAgent = Deno.env.get("SEC_USER_AGENT")?.trim();
  if (!userAgent || !userAgent.includes("@")) {
    return json({
      error: "SEC_USER_AGENT is not set, or carries no contact address. SEC serves 403 to generic agents.",
      fix: 'supabase secrets set SEC_USER_AGENT="AlphaMap sourcing you@yourdomain.com"',
    }, 500);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  // Default to yesterday UTC: today's index does not exist until SEC publishes
  // it after close, so defaulting to today would 404 for most of the day.
  let target = new Date(Date.now() - 86_400_000);
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    dryRun = body?.dryRun === true;
    if (typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      target = new Date(`${body.date}T00:00:00Z`);
      if (Number.isNaN(target.getTime())) return json({ error: `invalid date: ${body.date}` }, 400);
    }
  } catch {
    /* no body — defaults */
  }

  const indexUrl = dailyIndexUrl(target);

  try {
    const idx = await secFetch(indexUrl, userAgent);
    if (!idx.ok) {
      // Weekends and federal holidays have no index. That is a normal outcome,
      // not a failure, and must not look like one to the cron.
      const weekendish = idx.status === 403 || idx.status === 404;
      return json({
        date: indexUrl.match(/form\.(\d{8})\.idx/)?.[1] ?? null,
        indexUrl,
        filings: 0,
        note: weekendish
          ? `no daily index for this date (${idx.status}) — weekend, holiday, or not yet published`
          : `SEC returned ${idx.status}`,
      }, weekendish ? 200 : 502);
    }

    const rows = parseDailyIndex(idx.body).slice(0, limit);
    if (rows.length === 0) {
      return json({ indexUrl, filings: 0, note: "no Form D filings in this day's index" });
    }

    const results: Array<Record<string, unknown>> = [];
    const rejected: Record<string, number> = {};
    let ingested = 0;
    let createdStartups = 0;
    let fundsSeen = 0;
    let fundsRecorded = 0;
    const fundErrors: string[] = [];

    for (const row of rows) {
      await sleep(REQUEST_DELAY_MS);

      const docUrl = primaryDocUrl(row.cik, row.accession);
      let parsed: FormD | null = null;
      try {
        const doc = await secFetch(docUrl, userAgent);
        if (!doc.ok) {
          results.push({ entity: row.companyName, accession: row.accession, ok: false, reason: `doc ${doc.status}` });
          continue;
        }
        parsed = parseFormD(doc.body);
      } catch (e) {
        results.push({
          entity: row.companyName, accession: row.accession, ok: false,
          reason: e instanceof Error ? e.message : "fetch failed",
        });
        continue;
      }

      const verdict = classifyFiling(parsed);
      if (!verdict.eligible) {
        rejected[verdict.reason ?? "unknown"] = (rejected[verdict.reason ?? "unknown"] ?? 0) + 1;

        // Funds are rejected as COMPANIES but kept as INTELLIGENCE. On the
        // live 24 July run they were 150 of 200 documents — the largest single
        // category, and the raising history of the firms that fund everything
        // else this pipeline looks for. They go to vc_fund_filings, which has
        // no startups FK and cannot leak into the ATS probe queue.
        if (verdict.reason === "fund" && parsed) {
          fundsSeen++;
          if (!dryRun) {
            const { error: fundErr } = await supabase.rpc("record_fund_filing", {
              p_accession: row.accession,
              p_cik: parsed.cik ?? row.cik,
              p_form_type: row.formType,
              p_fund_name: parsed.entityName,
              p_filing_date: isoDate(row.dateFiled),
              p_fund_type: parsed.fundType,
              p_industry_group: parsed.industryGroup,
              p_year_of_inc: parsed.yearOfInc,
              p_jurisdiction: parsed.jurisdiction,
              p_total_offering: parsed.totalOffering,
              p_total_sold: parsed.totalSold,
              p_managers: parsed.officers,
              p_raw: parsed,
            });
            if (fundErr) fundErrors.push(`${parsed.entityName}: ${fundErr.message}`);
            else fundsRecorded++;
          }
        }
        continue;
      }
      const f = parsed as FormD;

      if (dryRun) {
        ingested++;
        results.push({
          entity: f.entityName, accession: row.accession, industryGroup: f.industryGroup,
          yearOfInc: f.yearOfInc, officers: f.officers.length, summary: techSummary(f), wouldIngest: true,
        });
        continue;
      }

      // One RPC per filing: the startups upsert and the filing insert have to
      // land in the same transaction, and startups.slug's partial unique index
      // cannot be targeted through PostgREST's onConflict.
      const { data, error } = await supabase.rpc("ingest_form_d_filing", {
        p_accession: row.accession,
        p_cik: f.cik ?? row.cik,
        p_form_type: row.formType,
        p_entity_name: f.entityName,
        p_filing_date: isoDate(row.dateFiled),
        p_year_of_inc: f.yearOfInc,
        p_jurisdiction: f.jurisdiction,
        p_industry_group: f.industryGroup,
        p_officers: f.officers,
        p_tech_summary: techSummary(f),
        p_total_offering: f.totalOffering,
        p_total_sold: f.totalSold,
        p_raw: f,
      });

      if (error) {
        results.push({ entity: f.entityName, accession: row.accession, ok: false, reason: error.message });
        continue;
      }

      ingested++;
      if ((data as { created_startup?: boolean })?.created_startup) createdStartups++;
      results.push({
        entity: f.entityName, accession: row.accession, ok: true,
        industryGroup: f.industryGroup, ...(data as Record<string, unknown>),
      });
    }

    return json({
      indexUrl,
      dryRun,
      formDInIndex: parseDailyIndex(idx.body).length,
      examined: rows.length,
      ingested,
      createdStartups,
      // Funds are not companies, but they are not noise either.
      fundsSeen,
      fundsRecorded,
      ...(fundErrors.length ? { fundErrors } : {}),
      // The interesting number: on a normal day most filings are funds.
      rejected,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed" }, 500);
  }
});
