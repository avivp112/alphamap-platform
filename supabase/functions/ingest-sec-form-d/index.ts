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
// Invoke:  POST {}                          -> worker: every open business day
//                                              (last 7 + backfill), newest first,
//                                              ALL Form D / D/A filings, until a
//                                              100 s budget is spent
//          POST { "date": "2026-07-24" }    -> that day only
//          POST { "date": ..., "dryRun": true, "limit": 20 } -> classify, write nothing
//
// ── SCHEDULE (fixed 2026-10-16) ─────────────────────────────────────────────
// EDGAR builds a day's index from about 22:00 New York time, so the old
// 00:10 UTC run (20:10 in New York) asked for an index that did not exist yet
// and logged "empty" every night. It also read only the first 50 Form D
// filings of the day's alphabetical index. Now pg_cron calls the worker every
// 10 minutes 04:00-13:50 UTC (20261019000000); sec_form_d_days tracks which
// days are done and sec_form_d_seen which filings, so each run carries on
// where the last one stopped and a missed day is caught up automatically.
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
import { withRunLog, countKeys } from "../_shared/run-log.ts";
import { gateFormD, secIndustryScope, type GateTier } from "../_shared/company-gate.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Wall-clock budget per invocation, under Supabase's Edge Function limit
// (150 s on the free plan). The worker stops between filings when it is
// spent; the next scheduled run carries on where this one stopped.
const TIME_BUDGET_MS = 100_000;
// Business days re-checked on every run, so a day missed for any reason —
// index not published yet, an outage, a run killed mid-day — is caught up.
const CATCH_UP_DAYS = 7;
// Filings per invocation. Edge Functions also cap CPU time per request, and
// every document is parsed in-process; 150 keeps well clear of it. At 60
// runs a day that is ~9,000 filings, against ~300 Form D on a normal day.
const MAX_PER_RUN = 150;
// A business day whose index is still missing after this many days was a
// federal holiday (EDGAR publishes nothing), not a day still to come.
const NO_INDEX_AFTER_DAYS = 3;
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

export type RejectReason = "fund" | "not_tech" | "no_name";

/**
 * Whether a parsed filing is stored at all. Industry scope is the gate's
 * (secIndustryScope in _shared/company-gate.ts): the technology groups, plus
 * health / energy / hardware groups when the name says deep tech. Everything
 * else (real estate, banks, oil & gas, restaurants...) is not stored.
 *
 * Funds are checked first because "not_tech" would be a misleading label for
 * a venture fund whose industry group happens to be blank.
 *
 * Age no longer rejects (it did until 2026-10-16): a tech company over five
 * years old raising a round is a real deal. gateFormD sends it to the review
 * queue without a "new company" alert instead.
 */
export function classifyFiling(f: FormD | null): { eligible: boolean; reason?: RejectReason } {
  if (!f || !f.entityName) return { eligible: false, reason: "no_name" };
  if (f.isFund) return { eligible: false, reason: "fund" };
  if (!secIndustryScope(f.industryGroup, f.entityName)) return { eligible: false, reason: "not_tech" };
  return { eligible: true };
}

/** Incorporated within five years or not yet formed — Form D's own flags. */
export const isNewCompany = (f: FormD): boolean => f.withinFiveYears || f.yetToBeFormed;

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

// ── Which days to process ───────────────────────────────────────────────────

export type DayStatus = "pending" | "waiting" | "in_progress" | "complete" | "no_index";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Mon–Fri dates in the `n` days before `now` (UTC), newest first. EDGAR publishes no index on weekends. */
export function recentBusinessDays(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(isoDay(d));
  }
  return out;
}

/**
 * Days to work on, newest first: every recent business day not yet complete
 * (or confirmed index-less), plus any older day still open — the backfill
 * seeded by migration 20261019000000, or a day a killed run left half done.
 */
export function planDays(recent: string[], known: Array<{ index_date: string; status: DayStatus }>): string[] {
  const status = new Map(known.map((k) => [k.index_date, k.status]));
  const days = new Set<string>();
  for (const d of recent) {
    const st = status.get(d);
    if (st !== "complete" && st !== "no_index") days.add(d);
  }
  for (const k of known) if (k.status === "pending" || k.status === "waiting" || k.status === "in_progress") days.add(k.index_date);
  return [...days].sort().reverse();
}

/** A missing index: still to come (`waiting`) or a holiday (`no_index`). */
export function missingIndexStatus(day: string, now: Date): DayStatus {
  const ageDays = (now.getTime() - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  return ageDays > NO_INDEX_AFTER_DAYS ? "no_index" : "waiting";
}

// ── Handler ─────────────────────────────────────────────────────────────────
//
// POST {}                       -> worker: every open day (see planDays),
//                                  newest first, every Form D and D/A in it,
//                                  until the time budget is spent
// POST { "date": "2026-07-24" } -> that day only (re-reads filings already
//                                  done only with "reprocess": true)
// POST { "date": ..., "dryRun": true, "limit": 20 } -> parse and classify, write nothing

type Outcome = "company" | "fund" | "not_tech" | "no_name" | "doc_missing";

Deno.serve(withRunLog("sec_form_d", countKeys("ingested", "fundsRecorded"), async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const started = Date.now();

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

  let dryRun = false, reprocess = false;
  let limit = MAX_PER_RUN;
  let onlyDate: string | null = null;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
    reprocess = body?.reprocess === true;
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_PER_RUN);
    if (typeof body?.date === "string") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(`${body.date}T00:00:00Z`))) {
        return json({ error: `invalid date: ${body.date}` }, 400);
      }
      onlyDate = body.date;
    }
  } catch {
    /* no body — worker mode */
  }
  if (dryRun && !onlyDate) return json({ error: "dryRun needs a date" }, 400);

  const now = new Date();
  let days: string[];
  if (onlyDate) {
    days = [onlyDate];
  } else {
    const recent = recentBusinessDays(now, CATCH_UP_DAYS);
    const { data: known, error } = await supabase
      .from("sec_form_d_days")
      .select("index_date, status")
      .or(`index_date.gte.${recent[recent.length - 1]},status.in.(pending,waiting,in_progress)`);
    if (error) return json({ error: `sec_form_d_days: ${error.message}` }, 500);
    days = planDays(recent, (known ?? []) as Array<{ index_date: string; status: DayStatus }>);
  }

  const setDay = async (day: string, patch: Record<string, unknown>) => {
    if (dryRun) return;
    const { error } = await supabase.from("sec_form_d_days")
      .upsert({ index_date: day, last_attempt_at: new Date().toISOString(), ...patch }, { onConflict: "index_date" });
    if (error) console.error(`sec_form_d_days ${day}: ${error.message}`);
  };

  const summary: Array<Record<string, unknown>> = [];
  const results: Array<Record<string, unknown>> = [];
  const rejected: Record<string, number> = {};
  const tiers: Record<GateTier, number> = { reject: 0, queue: 0, alert: 0 };
  const fundErrors: string[] = [];
  let ingested = 0, fundsSeen = 0, fundsRecorded = 0, fundsSkipped = 0, examined = 0;
  let stopReason: string | null = null;

  try {
    for (const day of days) {
      if (stopReason) break;
      if (Date.now() - started > TIME_BUDGET_MS) { stopReason = "time budget spent"; break; }

      const indexUrl = dailyIndexUrl(new Date(`${day}T00:00:00Z`));
      const idx = await secFetch(indexUrl, userAgent);
      if (!idx.ok) {
        if (idx.status === 403 || idx.status === 404) {
          // Not published yet (EDGAR builds a day's index from ~22:00 ET), or a holiday.
          const status = missingIndexStatus(day, now);
          await setDay(day, { status, note: `index ${idx.status}` });
          summary.push({ date: day, status, note: `no index yet (${idx.status})` });
          continue;
        }
        summary.push({ date: day, error: `SEC returned ${idx.status} for the index` });
        stopReason = `SEC index ${idx.status}`;
        break;
      }

      const all = parseDailyIndex(idx.body);
      let todo = all;
      if (!reprocess && !dryRun && all.length > 0) {
        const { data: seen, error } = await supabase
          .from("sec_form_d_seen").select("accession").eq("index_date", day).range(0, 9999);
        if (error) return json({ error: `sec_form_d_seen: ${error.message}` }, 500);
        const done = new Set((seen ?? []).map((r: { accession: string }) => r.accession));
        todo = all.filter((r) => !done.has(r.accession));
      }
      await setDay(day, { status: todo.length ? "in_progress" : "complete", filings_total: all.length,
        ...(todo.length ? {} : { completed_at: new Date().toISOString() }) });

      let doneHere = 0;
      for (const row of todo) {
        if (examined >= limit) { stopReason = "limit reached"; break; }
        if (Date.now() - started > TIME_BUDGET_MS) { stopReason = "time budget spent"; break; }
        examined++;
        await sleep(REQUEST_DELAY_MS);

        let parsed: FormD | null = null;
        let fetched = false;                  // the document came back and was parsed (maybe to null)
        let outcome: Outcome | null = null;   // null = transient failure, retried next run
        try {
          const doc = await secFetch(primaryDocUrl(row.cik, row.accession), userAgent);
          if (doc.status === 404) {
            outcome = "doc_missing";
            results.push({ entity: row.companyName, accession: row.accession, ok: false, reason: "doc 404" });
          } else if (!doc.ok) {
            results.push({ entity: row.companyName, accession: row.accession, ok: false, reason: `doc ${doc.status}` });
            // 403/429 from SEC means slow down: stop the run rather than push on.
            if (doc.status === 403 || doc.status === 429) { stopReason = `SEC ${doc.status} on a document`; break; }
          } else {
            parsed = parseFormD(doc.body);
            fetched = true;
          }
        } catch (e) {
          results.push({ entity: row.companyName, accession: row.accession, ok: false, reason: e instanceof Error ? e.message : "fetch failed" });
        }

        if (fetched) {
          const verdict = classifyFiling(parsed);
          if (!verdict.eligible) {
            rejected[verdict.reason ?? "unknown"] = (rejected[verdict.reason ?? "unknown"] ?? 0) + 1;
            outcome = verdict.reason ?? "no_name";
            // Funds are rejected as COMPANIES but kept as INTELLIGENCE, in
            // vc_fund_filings (no startups FK, cannot leak into the queue).
            if (verdict.reason === "fund" && parsed) {
              fundsSeen++;
              if (!dryRun) {
                const { data: fundRes, error: fundErr } = await supabase.rpc("record_fund_filing", {
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
                if (fundErr) { fundErrors.push(`${parsed.entityName}: ${fundErr.message}`); outcome = null; }
                // Only venture funds, not their SPV / feeder vehicles, are stored (fund_filing_gate).
                else if ((fundRes as { skipped?: boolean } | null)?.skipped) fundsSkipped++;
                else fundsRecorded++;
              }
            }
          } else {
            const f = parsed as FormD;
            const gate = gateFormD({ name: f.entityName ?? "", industryGroup: f.industryGroup, isFund: f.isFund, isNew: isNewCompany(f) });
            tiers[gate.tier]++;
            outcome = "company";
            if (dryRun) {
              ingested++;
              results.push({
                entity: f.entityName, accession: row.accession, industryGroup: f.industryGroup,
                yearOfInc: f.yearOfInc, officers: f.officers.length, summary: techSummary(f), gate,
              });
            } else {
              // One RPC per filing: the company resolution and the filing insert
              // land in one transaction (ingest_gov_entity_filing).
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
                p_gate: gate,
              });
              if (error) {
                outcome = null;
                results.push({ entity: f.entityName, accession: row.accession, ok: false, reason: error.message });
              } else {
                ingested++;
                results.push({ entity: f.entityName, accession: row.accession, ok: true, industryGroup: f.industryGroup, gate, ...(data as Record<string, unknown>) });
              }
            }
          }
        }

        if (outcome && !dryRun) {
          const { error } = await supabase.from("sec_form_d_seen").upsert({
            accession: row.accession, index_date: day, form_type: row.formType,
            entity_name: parsed?.entityName ?? row.companyName, industry_group: parsed?.industryGroup ?? null,
            fund_type: parsed?.fundType ?? null, outcome,
          }, { onConflict: "accession" });
          if (error) console.error(`sec_form_d_seen ${row.accession}: ${error.message}`);
          else doneHere++;
        }
      }

      const remaining = todo.length - doneHere;
      if (remaining <= 0 && !dryRun) await setDay(day, { status: "complete", filings_total: all.length, completed_at: new Date().toISOString() });
      summary.push({ date: day, formDInIndex: all.length, alreadyDone: all.length - todo.length, doneNow: doneHere, remaining: Math.max(0, remaining) });
    }

    return json({
      dryRun,
      days: summary,
      examined,
      ingested,
      gate: tiers,
      // Funds are not companies, but they are not noise either.
      fundsSeen,
      fundsRecorded,
      fundsSkipped,
      ...(fundErrors.length ? { fundErrors } : {}),
      rejected,
      stopped: stopReason,
      elapsedMs: Date.now() - started,
      results: results.slice(-100),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed", days: summary, ingested, fundsRecorded }, 500);
  }
}));
