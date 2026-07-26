// =============================================================================
// Supabase Edge Function: extract-job-signals
//
// Turns raw job titles into categorised signals in job_signals, which is what
// the FOMO scoring view ranks on.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
// Deploy:  supabase functions deploy extract-job-signals --no-verify-jwt
// Invoke:  POST { "limit": 500 }   -> process the oldest pending postings
//          POST { "reextract": true, "limit": 500 }
//                                  -> also revisit already-processed rows
//
// ── Scope, stated plainly ───────────────────────────────────────────────────
// This extracts from the TITLE ONLY. The crawler stores title and url, not the
// job description, because neither ATS returns descriptions on the list
// endpoint — fetching them means one extra HTTP request per posting, which for
// Stripe alone would be 536 requests.
//
// Consequences worth knowing before trusting the output:
//   * seniority and stage keywords land well — they are almost always in the
//     title ("Founding Engineer", "Head of Growth").
//   * tech_stack is SPARSE. "Senior Rust Engineer" hits; "Backend Engineer"
//     tells you nothing about the stack. Absence of a tech signal is not
//     evidence the company does not use that technology.
// If tech coverage matters later, the fix is a description-fetching pass, not
// a longer keyword list.
//
// Idempotent: job_signals is UNIQUE(job_id, signal_type, signal_value) and we
// insert with ignoreDuplicates, so re-running never duplicates.
//
// reextract additionally DELETES each posting's existing signals first, so it
// replaces rather than accumulates. That is what makes it usable after a rule
// is tightened: the additive insert path can add a signal the taxonomy now
// finds, but can never retract one it no longer does.
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

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export type SignalType = "seniority" | "tech_stack" | "keyword";
export interface Signal { signal_type: SignalType; signal_value: string; }

interface Rule { value: string; re: RegExp; }

// ── Seniority ───────────────────────────────────────────────────────────────
// ORDER MATTERS: the first match wins, so the most specific/most senior
// patterns come first. A title only ever yields ONE seniority signal —
// "Founding Senior Engineer" is a founding role, not a senior one, and
// emitting both would double-count in the FOMO score.
const SENIORITY: Rule[] = [
  { value: "Co-Founder",  re: /\b(co[-\s]?founder|cofounder)\b/i },
  // "Founding Engineer", "Founding Designer", "Founding AE".
  { value: "Founding",    re: /\bfounding\b/i },
  // "First Product Manager", "First Sales Hire" — the same stage tell. The
  // lookahead blocks corporate qualifiers that turn "first" into an ordinal
  // rank rather than a headcount: "First Line Manager", "First Level Support
  // Rep" and "First Party Data Engineer" are scaled-org titles, and matching
  // them would award founding points to exactly the wrong companies.
  { value: "First Hire",  re: /\bfirst\s+(?!line|level|party|tier|class|shift|aid|response)(\w+\s+){0,2}(hire|engineer|designer|manager|marketer|seller|rep)\b/i },
  { value: "C-Level",     re: /\b(c[teoifprsm]o|chief\s+\w+\s+officer)\b/i },
  { value: "VP",          re: /\b(vp|vice\s+president)\b/i },
  { value: "Head of",     re: /\bhead\s+of\b/i },
  { value: "Director",    re: /\bdirector\b/i },
  { value: "Principal",   re: /\bprincipal\b/i },
  { value: "Staff",       re: /\bstaff\b/i },
  // "Lead Engineer" / "Tech Lead", but NOT "Lead Generation" (a sales term).
  { value: "Lead",        re: /\blead\b(?!\s+(generation|gen)\b)/i },
  { value: "Senior",      re: /\b(senior|sr\.?)\b/i },
  { value: "Junior",      re: /\b(junior|jr\.?|entry[-\s]level|new\s+grad|graduate)\b/i },
  { value: "Intern",      re: /\b(intern|internship|co[-\s]?op)\b/i },
];

// ── Tech stack ──────────────────────────────────────────────────────────────
// Concrete technologies plus the broad engineering disciplines, since both are
// useful filters. ALL matches are emitted, unlike seniority.
const TECH: Rule[] = [
  { value: "Rust",        re: /\brust\b/i },
  // "Go" is the worst offender for false positives — Google, Django, going.
  // Require a standalone word or the unambiguous "Golang".
  { value: "Go",          re: /\bgolang\b|\bgo\b(?!\s*(to|live|lang\w))/i },
  { value: "Python",      re: /\bpython\b/i },
  { value: "TypeScript",  re: /\btype\s?script\b|\bts\b/i },
  { value: "JavaScript",  re: /\bjava\s?script\b/i },
  // Negative lookahead so "JavaScript" never registers as "Java".
  { value: "Java",        re: /\bjava\b(?!\s?script)/i },
  { value: "Kotlin",      re: /\bkotlin\b/i },
  { value: "Swift",       re: /\bswift\b/i },
  { value: "Ruby",        re: /\bruby\b|\brails\b/i },
  { value: "Scala",       re: /\bscala\b/i },
  { value: "Elixir",      re: /\belixir\b/i },
  { value: "C++",         re: /c\+\+/i },
  { value: "React",       re: /\breact\b/i },
  { value: "Node.js",     re: /\bnode(\.js)?\b/i },
  { value: "Kubernetes",  re: /\bkubernetes\b|\bk8s\b/i },
  { value: "Terraform",   re: /\bterraform\b/i },
  { value: "AWS",         re: /\baws\b/i },
  { value: "Solidity",    re: /\bsolidity\b/i },
  { value: "Machine Learning", re: /\bmachine\s+learning\b|\bml\b(?!\s*ops)/i },
  { value: "MLOps",       re: /\bml\s?ops\b/i },
  { value: "LLM",         re: /\bllms?\b|\bgen(erative)?\s?ai\b/i },
  { value: "AI",          re: /\bai\b/i },
  { value: "Data",        re: /\bdata\s+(engineer|scientist|analyst|platform)\b/i },
  { value: "iOS",         re: /\bios\b/i },
  { value: "Android",     re: /\bandroid\b/i },
  { value: "Backend",     re: /\bback[-\s]?end\b/i },
  { value: "Frontend",    re: /\bfront[-\s]?end\b/i },
  { value: "Full Stack",  re: /\bfull[-\s]?stack\b/i },
  { value: "DevOps",      re: /\bdev\s?ops\b/i },
  { value: "SRE",         re: /\bsre\b|\bsite\s+reliability\b/i },
  { value: "Infrastructure", re: /\binfra(structure)?\b/i },
  { value: "Security",    re: /\bsecurity\b|\bappsec\b|\binfosec\b/i },
];

// ── Stage / nature keywords ─────────────────────────────────────────────────
// These are the ones that actually move the FOMO score. ALL matches emitted.
//
// Two opposing groups:
//
//   POSITIVE — early-stage tells. A company writing these is at the moment
//   worth catching.
//
//   SCALED-ORG — the inverse. Derived from the real unmatched-title dump off
//   the first Stripe crawl, where 367 of 536 titles matched nothing and were
//   overwhelmingly Account Executive / Customer Success Manager / Accounts
//   Receivable Manager / Risk Operations Analyst.
//
//   Those are not noise to be mopped up by widening the seniority list —
//   tagging them "Manager" would have lifted coverage from 31% to ~70% while
//   changing precisely zero FOMO scores. They are worth far more as evidence
//   AGAINST a company being early: a dedicated sales org, a support org, a
//   finance function and a compliance function are things a three-person
//   startup does not have. The FOMO view subtracts on the count of DISTINCT
//   functions present, so one early "first AE" hire is harmless while four
//   separate corporate functions are damning.
const KEYWORD: Rule[] = [
  // Positive — early stage
  //
  // "Stealth" requires the startup sense explicitly. Bare /\bstealth\b/ was
  // wrong on 2 of 2 real matches, both OpenAI: "Secure Manufacturing & Stealth
  // Investigator" and "Secure Manufacturing & Stealth Partner, Marketing" —
  // that is stealth as in anti-counterfeiting TECHNOLOGY, an industrial
  // security function, and about as far from a stealth-mode startup as a title
  // gets. On title-only data the bare word is not evidence of anything.
  { value: "Stealth",       re: /\bstealth\s*[-\s]?mode\b|\bin\s+stealth\b|\bstealth\s+startup\b/i },
  { value: "Founding Team", re: /\bfounding\s+team\b/i },
  { value: "Zero to One",   re: /\b0\s*(to|-|→)\s*1\b|\bzero\s+to\s+one\b/i },
  { value: "Greenfield",    re: /\bgreenfield\b/i },
  { value: "Early Stage",   re: /\bearly[-\s]stage\b|\bpre[-\s]?seed\b|\bseed[-\s]stage\b/i },
  // Neutral — useful filters, not scored
  { value: "Remote",        re: /\bremote\b/i },
  { value: "Contract",      re: /\bcontract(or)?\b|\bfreelance\b/i },
  // Negative — evidence of a scaled organisation
  { value: "Sales Org",     re: /\baccount\s+executive\b|\bsales\s+development\b|\b(sdr|bdr)\b|\bbusiness\s+development\s+rep/i },
  { value: "Customer Org",  re: /\bcustomer\s+(success|support|experience)\b|\btechnical\s+support\b|\baccount\s+manager\b/i },
  { value: "Finance Org",   re: /\baccounts?\s+(receivable|payable)\b|\bcontroller\b|\bpayroll\b|\bfinancial\s+analyst\b|\btreasury\s+analyst\b/i },
  { value: "People Org",    re: /\brecruiter\b|\btalent\s+acquisition\b|\bpeople\s+(partner|consultant|operations)\b|\bhr\s+business\s+partner\b/i },
  { value: "Compliance Org", re: /\bcompliance\b|\bsanctions\b|\bfinancial\s+crimes?\b|\bfraud\s+(investigator|analyst)\b|\brisk\s+operations\b|\b(aml|kyc)\b/i },
  // Added after the first real early-stage crawl. oak looked early on raw job
  // count (13 openings) but its titles were "Enterprise Account Executive -
  // Central", "Enterprise Solutions Engineer - East/West", "Cloud & Tech
  // Alliances Lead". Slicing sales into geographic territories, running a
  // pre-sales Solutions Engineering function, and staffing partnerships are
  // all Series-B-and-later go-to-market machinery. A four-person company does
  // not hire an Enterprise AE for the East Coast.
  //
  // These are much stronger stage evidence than open-role count, which is a
  // weak proxy: a funded company in a hiring freeze and a stealth startup both
  // show ~13 openings.
  { value: "Enterprise GTM",  re: /\benterprise\s+(account\s+executive|solutions?\s+(engineer|architect)|sales|architect)\b|\bsolutions?\s+engineer\b|\bsales\s+engineer\b/i },
  { value: "Territory Org",   re: /\b(emea|apac|anz|latam|dach|benelux|nordics|iberia)\b|\b(east|west)\s+coast\b|[-–—,]\s*(central|east|west|north|south|northeast|southeast|midwest)(\s+coast)?\s*$/i },
  { value: "Partnerships Org", re: /\balliances?\b|\bpartnerships?\b|\bchannel\s+sales\b|\bpartner\s+(manager|development)\b/i },
];

// The two opposing groups from KEYWORD, named so the suppression rule below
// can reason about them. Kept in step with sourcing_fomo_scores, which scores
// exactly these values.
const EARLY_STAGE = new Set(["Stealth", "Founding Team", "Zero to One", "Greenfield", "Early Stage"]);
const SCALED_ORG = new Set([
  "Sales Org", "Customer Org", "Finance Org", "People Org",
  "Compliance Org", "Enterprise GTM", "Territory Org", "Partnerships Org",
]);

/**
 * Extract every signal a title supports.
 *
 * Pure and exported so the taxonomy can be regression-tested against real
 * titles without a database or network — see taxonomy.test.mjs.
 */
export function extractSignals(title: string): Signal[] {
  const out: Signal[] = [];
  if (!title || !title.trim()) return out;
  const t = title.trim();

  // Seniority: first match only — see the ORDER MATTERS note above.
  const sen = SENIORITY.find((r) => r.re.test(t));
  if (sen) out.push({ signal_type: "seniority", signal_value: sen.value });

  for (const r of TECH) if (r.re.test(t)) out.push({ signal_type: "tech_stack", signal_value: r.value });

  // ── Keywords, with early-stage positives suppressed by scaled-org evidence ─
  //
  // A single title cannot be evidence BOTH that a company is a founding team
  // and that it runs an enterprise sales organisation. When it appears to be,
  // the scaled-org reading is the reliable one: those patterns match whole job
  // functions ("Account Executive"), while the early-stage patterns match
  // single adjectives that plenty of other trades also use.
  //
  // This is not hypothetical. Vercel scored +30 stealth points from three
  // titles — "Account Executive- Startups, Greenfield", "Account
  // Executive-Startups, Greenfield (EMEA)" and "Commercial Account Executive,
  // Greenfield" — where greenfield means an untouched sales TERRITORY. The
  // engine read the strongest scaled-org evidence in the corpus, an enterprise
  // AE with an EMEA patch, and paid it an early-stage bonus. A sign error, not
  // a near miss.
  //
  // Suppressing generalises where patching /greenfield/ would not: it also
  // catches the false positives of this shape we have not seen yet.
  //
  // Deliberately NOT applied to seniority. "Founding Account Executive" is a
  // genuine early-stage tell — the first commercial hire at a startup really
  // is titled that — so dropping it would discard signal, not noise.
  const matched = KEYWORD.filter((r) => r.re.test(t)).map((r) => r.value);
  const hasScaledOrg = matched.some((v) => SCALED_ORG.has(v));
  for (const value of matched) {
    if (hasScaledOrg && EARLY_STAGE.has(value)) continue;
    out.push({ signal_type: "keyword", signal_value: value });
  }

  return out;
}

// ── Handler ─────────────────────────────────────────────────────────────────

interface PostingRow { id: string; title: string; }

// PostgREST puts FILTERS in the URI, not the body: .in("id", ids) becomes
// ?id=in.(uuid,uuid,...). At 37 characters per UUID, 1000 ids is a ~37 KB
// request line — far past the usual 8 KB header buffer — so the gateway
// answers 400 Bad Request before Postgres ever sees the statement. 100 ids is
// ~3.7 KB and sits comfortably inside it.
//
// Note this affects filters ONLY. The job_signals upsert above sends its rows
// as a POST body, which has a much larger ceiling, so it is left as one call.
const ID_CHUNK = 100;

/**
 * Stamp signals_extracted_at across arbitrarily many ids, a chunk at a time.
 *
 * One timestamp for the whole batch, computed once: rows processed in the same
 * run should share a stamp rather than drift by however long the loop took.
 *
 * A mid-loop failure leaves earlier chunks stamped and later ones pending.
 * That is safe rather than merely tolerable — signals are inserted BEFORE any
 * stamping and the insert is idempotent, so re-running re-processes the
 * unstamped remainder and writes no duplicates. The error names the chunk so a
 * partial failure is legible instead of looking like total loss.
 */
async function stampExtracted(supabase: SupabaseClient, ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { error } = await supabase
      .from("early_job_postings")
      .update({ signals_extracted_at: now })
      .in("id", chunk);
    if (error) {
      throw new Error(
        `stamp signals_extracted_at (ids ${i}–${i + chunk.length - 1} of ${ids.length}): ${error.message}`,
      );
    }
  }
}

/**
 * Delete every existing signal for these postings, so a reextract REPLACES
 * rather than accumulates.
 *
 * Without this, reextract is close to useless for the case that motivates it.
 * The insert path uses ignoreDuplicates against UNIQUE(job_id, signal_type,
 * signal_value), which makes re-running safe but also purely additive — it can
 * add a signal the taxonomy now finds and can never retract one it no longer
 * does. When a rule is TIGHTENED, the stale rows simply survive: Vercel's three
 * "Greenfield" rows and OpenAI's two "Stealth" rows would have sat in
 * job_signals scoring points forever, and the leaderboard would not have moved
 * an inch after the fix.
 *
 * Not transactional with the insert that follows. A failure between the two
 * leaves those postings with no signals — recoverable by re-running, since they
 * keep their signals_extracted_at only if stamping succeeded, which happens
 * last of all.
 */
async function clearSignals(supabase: SupabaseClient, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { error } = await supabase.from("job_signals").delete().in("job_id", chunk);
    if (error) {
      throw new Error(
        `clear signals (ids ${i}–${i + chunk.length - 1} of ${ids.length}): ${error.message}`,
      );
    }
  }
}

async function processBatch(supabase: SupabaseClient, rows: PostingRow[], reextract: boolean) {
  const signalRows: { job_id: string; signal_type: string; signal_value: string }[] = [];
  let withSignals = 0;

  for (const r of rows) {
    const sigs = extractSignals(r.title);
    if (sigs.length > 0) withSignals++;
    for (const s of sigs) {
      signalRows.push({ job_id: r.id, signal_type: s.signal_type, signal_value: s.signal_value });
    }
  }

  // Only on reextract. The default pass touches postings that have never been
  // processed, so there is nothing to clear and a delete would be wasted calls.
  if (reextract) await clearSignals(supabase, rows.map((r) => r.id));

  if (signalRows.length > 0) {
    // ignoreDuplicates leans on UNIQUE(job_id, signal_type, signal_value), so
    // a re-run is a no-op rather than a constraint violation.
    const { error } = await supabase
      .from("job_signals")
      .upsert(signalRows, { onConflict: "job_id,signal_type,signal_value", ignoreDuplicates: true });
    if (error) throw new Error(`insert signals: ${error.message}`);
  }

  // Stamp even the titles that produced nothing — "we looked and there was
  // nothing here" is a completed unit of work, not a pending one.
  await stampExtracted(supabase, rows.map((r) => r.id));

  return { signals: signalRows.length, withSignals };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let reextract = false;
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    reextract = body?.reextract === true;
  } catch {
    /* no body — defaults */
  }

  try {
    let q = supabase
      .from("early_job_postings")
      .select("id, title")
      .order("first_seen_at", { ascending: true })
      .limit(limit);
    // Default pass only touches postings never processed. reextract revisits
    // everything, which is what you want after changing the taxonomy above.
    if (!reextract) q = q.is("signals_extracted_at", null);

    const { data, error } = await q;
    if (error) return json({ error: `select postings: ${error.message}` }, 500);

    const rows = (data ?? []) as PostingRow[];
    if (rows.length === 0) return json({ processed: 0, signals: 0, note: "nothing pending" });

    const { signals, withSignals } = await processBatch(supabase, rows, reextract);

    return json({
      processed: rows.length,
      withSignals,
      // Titles that yielded nothing at all — a useful health metric. If this
      // is most of the batch the taxonomy is missing this board's vocabulary.
      withoutSignals: rows.length - withSignals,
      signals,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "extraction failed" }, 500);
  }
});
