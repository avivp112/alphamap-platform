// =============================================================================
// Edge Function: ingest-startup
// Researches one named company (Tavily web search) and extracts a structured
// profile via a forced single tool call, subject to AlphaMap's eligibility
// gate (private + tech companies only) before writing to startups/
// funding_rounds.
//
// Deploy:  supabase functions deploy ingest-startup --no-verify-jwt
// Secrets: SELF_HOSTED_LLM_URL, SELF_HOSTED_LLM_KEY (our self-hosted,
//          fine-tuned LLM behind vLLM's OpenAI-compatible server — see
//          supabase/functions/.env.example), TAVILY_API_KEY.
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are platform-injected.
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { SelfHostedLLM } from "../_shared/llm-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Must match the CHECK constraint in funding_rounds.round_type
const VALID_ROUND_TYPES = [
  "Pre-Seed", "Seed",
  "Series A", "Series B", "Series C", "Series D", "Series E+",
  "Growth", "Bridge", "Convertible Note",
  "Bootstrapped", "Grant", "Acquired", "IPO", "Other",
] as const;
type ValidRoundType = typeof VALID_ROUND_TYPES[number];

// IPO round_type triggers the public-company gate (belt-and-suspenders alongside is_public_company)
const EXCLUDED_ROUND_TYPES = new Set(["IPO"]);

// Tech sectors that are allowed. Anything not clearly tech → rejected.
const TECH_INDUSTRIES = new Set([
  "Software", "SaaS", "AI", "Artificial Intelligence", "Machine Learning",
  "Data", "Analytics", "Cybersecurity", "FinTech", "Financial Technology",
  "Biotech", "Biotechnology", "MedTech", "HealthTech", "Digital Health",
  "Hardware", "Semiconductors", "Electronics", "EdTech", "CleanTech",
  "GreenTech", "SpaceTech", "Aerospace", "AgTech", "PropTech",
  "MarTech", "AdTech", "LegalTech", "HRTech", "WorkTech",
  "LogTech", "Supply Chain Tech", "DeepTech", "Robotics", "Automation",
  "Gaming", "Game Tech", "AR/VR", "Web3", "Blockchain", "Crypto",
  "Cloud", "DevTools", "Infrastructure", "Developer Tools", "API",
  "InsurTech", "RegTech", "Quantum Computing", "Drones", "IoT",
]);

function normalizeRoundType(raw: string): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase().trim();
  if (/pre.?seed/.test(s)) return "Pre-Seed";
  if (/\bseed\b/.test(s) && !/series/.test(s)) return "Seed";
  if (/series\s*a\b/.test(s)) return "Series A";
  if (/series\s*b\b/.test(s)) return "Series B";
  if (/series\s*c\b/.test(s)) return "Series C";
  if (/series\s*d\b/.test(s)) return "Series D";
  if (/series\s*[e-z+]/.test(s) || /late.?stage/.test(s)) return "Series E+";
  if (/\bgrowth\b/.test(s) || /expansion/.test(s)) return "Growth";
  if (/bridge/.test(s)) return "Bridge";
  if (/convertible/.test(s) || /\bsafe\b/.test(s) || /\bnote\b/.test(s)) return "Convertible Note";
  if (/bootstrap/.test(s)) return "Bootstrapped";
  if (/\bgrant\b/.test(s)) return "Grant";
  if (/acqui/.test(s) || /merg/.test(s)) return "Acquired";
  if (/\bipo\b/.test(s) || /\bpublic\b/.test(s) || /nyse|nasdaq/.test(s)) return "IPO";
  return "Other";
}

// Domain matcher used to anchor searches when a website hint is supplied
// (e.g. by scripts/discover_competitors.ts, to disambiguate generic company
// names) and as a fallback for the final website field. Matches the same
// helper in scripts/bulk_enrich_all.ts / import_startups_list.ts.
function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

async function tavilySearch(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of (data.results || [])) {
      parts.push(`[${r.title}]\n${r.url}\n${(r.content || "").slice(0, 600)}`);
    }
    return parts.join("\n---\n");
  } catch {
    return "";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { company_name, website: websiteHint } = await req.json();
    const name = (company_name || "").trim();

    if (!name) {
      return Response.json(
        { error: "company_name is required and must not be empty" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Optional caller-supplied website hint (e.g. from the competitor-discovery
    // script) — anchors the searches below to avoid wrong-company collisions
    // on generic names, and backstops the final website field if Claude's own
    // extraction doesn't return one.
    const hintDomain = websiteDomain(websiteHint);
    const searchAnchor = hintDomain ? ` "${hintDomain}"` : "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const llmBaseUrl = Deno.env.get("SELF_HOSTED_LLM_URL");
    const llmApiKey = Deno.env.get("SELF_HOSTED_LLM_KEY");
    if (!llmBaseUrl || !llmApiKey) {
      return Response.json(
        { error: "SELF_HOSTED_LLM_URL / SELF_HOSTED_LLM_KEY are not configured" },
        { status: 500, headers: corsHeaders },
      );
    }
    const llm = new SelfHostedLLM({ baseUrl: llmBaseUrl, apiKey: llmApiKey });
    const tavilyKey = Deno.env.get("TAVILY_API_KEY")!;

    // ── Phase 1: Parallel web research ──────────────────────────────────────
    console.log(`[ingest] Researching: ${name}`);
    const [funding, founders, market, status, hiringNews] = await Promise.all([
      tavilySearch(`"${name}"${searchAnchor} startup funding round amount raised valuation 2024 2025`, tavilyKey),
      // Dedicated founders search — full names are required
      tavilySearch(`"${name}"${searchAnchor} founder co-founder "founded by" CEO CTO full name crunchbase linkedin`, tavilyKey),
      tavilySearch(`"${name}"${searchAnchor} company website headquarters country city industry sector description what does`, tavilyKey),
      // Explicit public/private status search to help Claude assess the privacy rule
      tavilySearch(`"${name}"${searchAnchor} IPO "went public" NASDAQ NYSE "publicly traded" OR "private company" OR "privately held"`, tavilyKey),
      tavilySearch(`"${name}"${searchAnchor} employees headcount team size layoffs hiring growth 2024 2025`, tavilyKey),
    ]);

    const researchContext = [
      `## Funding & Valuation\n${funding}`,
      `## Founders & Leadership\n${founders}`,
      `## Company Overview & HQ Location\n${market}`,
      `## Public vs Private Status\n${status}`,
      `## Workforce Trends\n${hiringNews}`,
    ].join("\n\n");

    // ── Phase 2: Claude extraction ───────────────────────────────────────────
    console.log(`[ingest] Extracting via Claude`);
    const msg = await llm.create({
      model: Deno.env.get("INGEST_STARTUP_MODEL") ?? Deno.env.get("SELF_HOSTED_LLM_MODEL") ?? "",
      max_tokens: 2048,
      tools: [
        {
          name: "save_startup",
          description: "Save a validated private tech startup and its latest funding round into AlphaMap",
          input_schema: {
            type: "object" as const,
            properties: {
              // ── Classification flags (checked first in validation) ──────────
              is_public_company: {
                type: "boolean",
                description:
                  "TRUE if the company has completed an IPO or is currently listed on any public stock exchange (NYSE, NASDAQ, LSE, TASE, etc.). FALSE if it remains privately held.",
              },
              is_tech_company: {
                type: "boolean",
                description:
                  "TRUE if the company is primarily tech-driven: Software, SaaS, AI/ML, Cybersecurity, FinTech, Biotech/MedTech, Hardware, EdTech, CleanTech, SpaceTech, Robotics, Web3, etc. FALSE for traditional non-tech businesses (brick-and-mortar retail, restaurants, traditional manufacturing, etc.).",
              },
              // ── startups table ─────────────────────────────────────────────
              name: {
                type: "string",
                description: "Official company name",
              },
              website: {
                type: "string",
                description: "Full canonical website URL including https://",
              },
              description: {
                type: "string",
                description:
                  "Detailed 3-4 sentence company overview: what it does, who it serves, what problem it solves, and its key differentiator",
              },
              industry: {
                type: "string",
                description:
                  "Primary tech sector (e.g. AI, SaaS, FinTech, Cybersecurity, Biotech, EdTech, CleanTech, Hardware)",
              },
              founded_year: {
                type: "integer",
                description: "Four-digit year the company was founded",
              },
              employee_count: {
                type: "integer",
                description: "Current approximate headcount",
              },
              country: {
                type: "string",
                description: "Country of headquarters (e.g. United States, Israel, United Kingdom)",
              },
              city: {
                type: "string",
                description: "City of headquarters (e.g. San Francisco, Tel Aviv, London)",
              },
              founders: {
                type: "array",
                items: { type: "string" },
                description:
                  "Full legal names of ALL founders/co-founders. Search thoroughly — include every person listed as a founder or co-founder. Example: [\"Patrick Collison\", \"John Collison\"]",
              },
              // ── funding_rounds table ───────────────────────────────────────
              round_type: {
                type: "string",
                enum: [
                  "Pre-Seed", "Seed",
                  "Series A", "Series B", "Series C", "Series D", "Series E+",
                  "Growth", "Bridge", "Convertible Note",
                  "Bootstrapped", "Grant", "Acquired", "IPO", "Other",
                ],
                description: "Type of the most recent funding round",
              },
              amount_raised: {
                type: "number",
                description:
                  "Capital raised in the most recent round in USD as a plain number (e.g. 50000000 for $50M)",
              },
              valuation: {
                type: "number",
                description:
                  "Post-money valuation at most recent round in USD as a plain number (e.g. 1500000000 for $1.5B)",
              },
              announcement_date: {
                type: "string",
                description: "Date the most recent funding round was announced in YYYY-MM-DD format",
              },
              source_url: {
                type: "string",
                description:
                  "URL of the primary source for the funding data (press release, TechCrunch, Crunchbase, etc.)",
              },
            },
            required: ["name", "round_type", "is_public_company", "is_tech_company"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "save_startup" },
      messages: [
        {
          role: "user",
          content: `You are a financial data analyst for AlphaMap, a market intelligence platform.
AlphaMap has two STRICT eligibility rules you MUST enforce before saving any company.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — PRIVACY RULE (non-negotiable):
AlphaMap tracks ONLY private companies.
If the company has completed an IPO or is currently listed on ANY public stock exchange
(NYSE, NASDAQ, LSE, TASE, Euronext, etc.) you MUST set is_public_company = true.
The system will immediately reject it.
Examples of public companies to reject: Stripe (if IPO'd), Airbnb, DoorDash, Rivian.

RULE 2 — INDUSTRY RULE (non-negotiable):
AlphaMap tracks ONLY tech-driven companies.
Allowed: Software, SaaS, AI/ML, Cybersecurity, FinTech, Biotech/MedTech/HealthTech,
Hardware/Semiconductors, EdTech, CleanTech/GreenTech, SpaceTech, Robotics/Automation,
Web3/Blockchain, Gaming, AR/VR, IoT, DevTools, Cloud Infrastructure, AgTech, PropTech.
NOT allowed: traditional retail, restaurants, real estate agencies, traditional
manufacturing, traditional media, non-tech services.
Set is_tech_company = false for any non-tech business — the system will reject it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENRICHMENT PRIORITIES:
1. founders — search carefully and list the FULL NAME of every founder/co-founder
2. city + country — be precise about the exact headquarters location
3. description — write a detailed 3-4 sentence overview (what it does, who it serves,
   problem it solves, key differentiator)
4. funding figures — convert all amounts to plain USD numbers

Additional rules:
- round_type must reflect the MOST RECENT funding event
- Only include website if you are confident the URL is correct
- Omit any field you cannot verify rather than guessing

Company to research: "${name}"${hintDomain ? ` (known website domain: ${hintDomain} — use this to confirm you are researching the correct company, especially if the name is generic or shared by multiple businesses)` : ""}

Research data:
${researchContext}`,
        },
      ],
    });

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("Claude did not return structured data");
    }
    const extracted = toolBlock.input as Record<string, unknown>;

    // ── Phase 3: Validation gate ─────────────────────────────────────────────

    // 1. Name check
    const finalName = String(extracted.name || "").trim();
    if (!finalName) {
      return Response.json(
        { error: "Extracted company name is empty" },
        { status: 422, headers: corsHeaders },
      );
    }

    // 2. PRIVACY RULE — explicit flag set by Claude
    if (extracted.is_public_company === true) {
      return Response.json(
        {
          error: `"${finalName}" is a publicly traded company and cannot be added to AlphaMap`,
          rule_violated: "PRIVACY_RULE",
          reason: "AlphaMap exclusively tracks private companies. Public/post-IPO companies are excluded.",
        },
        { status: 422, headers: corsHeaders },
      );
    }

    // 3. INDUSTRY RULE — explicit flag set by Claude
    if (extracted.is_tech_company === false) {
      return Response.json(
        {
          error: `"${finalName}" does not qualify as a tech-driven company`,
          rule_violated: "INDUSTRY_RULE",
          reason: "AlphaMap tracks tech companies only (Software, AI, Cyber, FinTech, Biotech, Hardware, etc.)",
          detected_industry: extracted.industry ?? "Unknown",
        },
        { status: 422, headers: corsHeaders },
      );
    }

    // 4. Round type gate — belt-and-suspenders public company check via round_type
    const roundType = normalizeRoundType(String(extracted.round_type || ""));
    if (EXCLUDED_ROUND_TYPES.has(roundType)) {
      return Response.json(
        {
          error: `"${finalName}" appears to be public (round_type resolved to "${roundType}")`,
          rule_violated: "PRIVACY_RULE",
          reason: "Post-IPO companies are excluded from AlphaMap startups",
        },
        { status: 422, headers: corsHeaders },
      );
    }
    if (!VALID_ROUND_TYPES.includes(roundType as ValidRoundType)) {
      return Response.json(
        { error: `round_type "${roundType}" is not in the allowed list`, allowed: VALID_ROUND_TYPES },
        { status: 422, headers: corsHeaders },
      );
    }

    // 5. Website uniqueness check — fall back to the caller-supplied hint if
    // Claude's own extraction didn't return a website.
    const website = extracted.website ? String(extracted.website).trim() : (websiteHint ? String(websiteHint).trim() : null);
    if (website) {
      const { data: dup } = await supabase
        .from("startups")
        .select("id, name")
        .eq("website", website)
        .maybeSingle();
      if (dup) {
        return Response.json(
          { error: `Website "${website}" already exists for: ${dup.name}`, existing_id: dup.id },
          { status: 409, headers: corsHeaders },
        );
      }
    }

    // ── Phase 4a: Insert into startups ───────────────────────────────────────
    const founderNames = Array.isArray(extracted.founders)
      ? (extracted.founders as unknown[]).map(String).filter((f) => f.trim() !== "")
      : [];
    // No linkedin_url source in this extraction pipeline yet — left null until
    // a future enrichment pass fills it in (matches bulk_enrich_all.ts).
    const foundersArray = founderNames.map((name) => ({ name, linkedin_url: null }));

    const startupRecord = {
      name: finalName,
      website: website ?? null,
      description: extracted.description ? String(extracted.description) : null,
      industry: extracted.industry ? String(extracted.industry) : null,
      founded_year: extracted.founded_year ? Number(extracted.founded_year) : null,
      employee_count: extracted.employee_count ? Number(extracted.employee_count) : null,
      country: extracted.country ? String(extracted.country) : null,
      city: extracted.city ? String(extracted.city) : null,
      founders: foundersArray.length > 0 ? foundersArray : null,
    };

    const { data: insertedStartup, error: startupError } = await supabase
      .from("startups")
      .insert(startupRecord)
      .select()
      .single();

    if (startupError) throw startupError;

    // ── Phase 4b: Insert into funding_rounds ─────────────────────────────────
    const hasFundingData =
      extracted.amount_raised ||
      extracted.valuation ||
      extracted.announcement_date ||
      extracted.source_url;

    let insertedRound = null;
    if (hasFundingData) {
      const roundRecord = {
        startup_id: insertedStartup.id,
        round_type: roundType,
        amount_raised: extracted.amount_raised ? Number(extracted.amount_raised) : null,
        valuation: extracted.valuation ? Number(extracted.valuation) : null,
        announcement_date: extracted.announcement_date ? String(extracted.announcement_date) : null,
        source_url: extracted.source_url ? String(extracted.source_url) : null,
      };

      const { data: round, error: roundError } = await supabase
        .from("funding_rounds")
        .insert(roundRecord)
        .select()
        .single();

      if (roundError) {
        console.error(`[ingest] funding_rounds insert failed for ${finalName}:`, roundError.message);
      } else {
        insertedRound = round;
      }
    }

    console.log(
      `[ingest] ✓ ${finalName} | ${roundType} | ${extracted.city ?? "—"}, ${extracted.country ?? "—"} | founders: ${founderNames.join(", ") || "none"}`,
    );

    return Response.json(
      {
        success: true,
        startup: insertedStartup,
        funding_round: insertedRound,
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ingest] Error:", message);
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
});
