import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

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

// Public companies (IPO'd) are excluded from the startups page
const EXCLUDED_ROUND_TYPES = new Set(["IPO"]);

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
    const { company_name } = await req.json();
    const name = (company_name || "").trim();

    if (!name) {
      return Response.json(
        { error: "company_name is required and must not be empty" },
        { status: 400, headers: corsHeaders },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const tavilyKey = Deno.env.get("TAVILY_API_KEY")!;

    // ── Phase 1: Parallel web research ──────────────────────────────────────
    console.log(`[ingest] Researching: ${name}`);
    const [funding, team, market, hiringJobs, hiringNews] = await Promise.all([
      tavilySearch(`"${name}" startup funding round amount raised valuation 2024 2025`, tavilyKey),
      tavilySearch(`"${name}" founders CEO CTO co-founder founding team crunchbase angellist`, tavilyKey),
      tavilySearch(`"${name}" company website headquarters country city industry description`, tavilyKey),
      tavilySearch(`"${name}" jobs hiring site:greenhouse.io OR site:lever.co OR site:ashby.io OR site:wellfound.com`, tavilyKey),
      tavilySearch(`"${name}" employees headcount team size layoffs hiring growth 2024 2025`, tavilyKey),
    ]);

    const researchContext = [
      `## Funding & Valuation\n${funding}`,
      `## Founding Team\n${team}`,
      `## Company Overview & HQ Location\n${market}`,
      `## Hiring (Job Boards)\n${hiringJobs}`,
      `## Workforce Trends\n${hiringNews}`,
    ].join("\n\n");

    // ── Phase 2: Claude extraction ───────────────────────────────────────────
    console.log(`[ingest] Extracting via Claude`);
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      tools: [
        {
          name: "save_startup",
          description: "Save a validated startup and its latest funding round into AlphaMap",
          input_schema: {
            type: "object" as const,
            properties: {
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
                description: "2-3 sentence company overview",
              },
              industry: {
                type: "string",
                description: "Primary sector e.g. FinTech, HealthTech, AI, SaaS, CleanTech, EdTech",
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
                description: "Country of headquarters e.g. United States, Israel, United Kingdom",
              },
              city: {
                type: "string",
                description: "City of headquarters e.g. San Francisco, Tel Aviv, London",
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
                description: "Capital raised in the most recent round, in USD as a plain number (e.g. 50000000 for $50M)",
              },
              valuation: {
                type: "number",
                description: "Post-money valuation at most recent round, in USD as a plain number (e.g. 1500000000 for $1.5B)",
              },
              announcement_date: {
                type: "string",
                description: "Date the most recent funding round was announced, in YYYY-MM-DD format",
              },
              source_url: {
                type: "string",
                description: "URL of the primary source for the funding data (press release, TechCrunch, Crunchbase, etc.)",
              },
            },
            required: ["name", "round_type"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "save_startup" },
      messages: [
        {
          role: "user",
          content: `You are a financial data analyst for AlphaMap, a market intelligence platform tracking private companies.

Extract accurate, source-verified information for: "${name}"

Rules:
- Convert all financial figures to plain USD numbers ($1.5B → 1500000000, $50M → 50000000)
- Split location into separate city and country fields
- Only include website if you are confident the URL is correct
- round_type must reflect the MOST RECENT funding event
- If the company has gone public (IPO'd), set round_type to "IPO" — it will be excluded
- Only include funding fields (amount_raised, valuation, announcement_date, source_url) if you can verify them from sources
- Omit any field you cannot verify rather than guessing

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
    const finalName = String(extracted.name || "").trim();
    if (!finalName) {
      return Response.json(
        { error: "Extracted company name is empty" },
        { status: 422, headers: corsHeaders },
      );
    }

    const roundType = normalizeRoundType(String(extracted.round_type || ""));
    if (EXCLUDED_ROUND_TYPES.has(roundType)) {
      return Response.json(
        {
          error: `"${finalName}" appears to be a public company (round_type: "${roundType}")`,
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

    // Website uniqueness check (matches the UNIQUE constraint on startups.website)
    const website = extracted.website ? String(extracted.website).trim() : null;
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
    const startupRecord = {
      name: finalName,
      website: website ?? null,
      description: extracted.description ? String(extracted.description) : null,
      industry: extracted.industry ? String(extracted.industry) : null,
      founded_year: extracted.founded_year ? Number(extracted.founded_year) : null,
      employee_count: extracted.employee_count ? Number(extracted.employee_count) : null,
      country: extracted.country ? String(extracted.country) : null,
      city: extracted.city ? String(extracted.city) : null,
    };

    const { data: insertedStartup, error: startupError } = await supabase
      .from("startups")
      .insert(startupRecord)
      .select()
      .single();

    if (startupError) throw startupError;

    // ── Phase 4b: Insert into funding_rounds (linked by startup_id) ──────────
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
        // Startup was inserted successfully; log the round failure but don't roll back
        console.error(`[ingest] funding_rounds insert failed for ${finalName}:`, roundError.message);
      } else {
        insertedRound = round;
      }
    }

    console.log(
      `[ingest] ✓ ${finalName} | round: ${roundType} | city: ${extracted.city ?? "—"}, country: ${extracted.country ?? "—"}`,
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
