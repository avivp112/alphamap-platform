import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_STAGES = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C+",
  "Growth", "Bootstrapped", "Acquired",
] as const;
type ValidStage = typeof VALID_STAGES[number];

function cleanDomain(url: string): string | null {
  if (!url) return null;
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeStage(raw: string): string {
  if (!raw) return "Unknown";
  const s = raw.toLowerCase().trim();
  if (/pre.?seed/.test(s)) return "Pre-Seed";
  if (/\bseed\b/.test(s) && !/series/.test(s)) return "Seed";
  if (/series\s*a\b/.test(s)) return "Series A";
  if (/series\s*b\b/.test(s)) return "Series B";
  if (/series\s*[c-z+]/.test(s) || /late.?stage/.test(s)) return "Series C+";
  if (/\bgrowth\b/.test(s) || /expansion/.test(s) || /pre.?ipo/.test(s)) return "Growth";
  if (/bootstrap/.test(s)) return "Bootstrapped";
  if (/acqui/.test(s) || /merg/.test(s)) return "Acquired";
  if (/\bipo\b/.test(s) || /\bpublic\b/.test(s) || /nyse|nasdaq/.test(s)) return "Public";
  return "Unknown";
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

    // Phase 1: Parallel web research
    console.log(`[ingest] Researching: ${name}`);
    const [funding, team, market, hiringJobs, hiringNews] = await Promise.all([
      tavilySearch(`"${name}" startup valuation total raised funding round 2024 2025`, tavilyKey),
      tavilySearch(`"${name}" founders CEO CTO co-founder founding team crunchbase angellist`, tavilyKey),
      tavilySearch(`"${name}" company website industry sector description startup`, tavilyKey),
      // LinkedIn workaround: search job boards that aggregate LinkedIn postings
      tavilySearch(
        `"${name}" jobs hiring site:greenhouse.io OR site:lever.co OR site:ashby.io OR site:wellfound.com`,
        tavilyKey,
      ),
      // Headcount signals from news + LinkedIn snippets Tavily can index
      tavilySearch(`"${name}" employees headcount team size linkedin layoffs hiring 2024 2025`, tavilyKey),
    ]);

    const researchContext = `## Funding & Valuation\n${funding}\n\n## Founding Team\n${team}\n\n## Company Overview\n${market}\n\n## Hiring (Job Boards)\n${hiringJobs}\n\n## Workforce Trends\n${hiringNews}`;

    // Phase 2: Claude extraction with structured tool_use
    console.log(`[ingest] Extracting data via Claude`);
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      tools: [
        {
          name: "save_startup",
          description: "Save structured, validated startup data into AlphaMap",
          input_schema: {
            type: "object" as const,
            properties: {
              name: { type: "string", description: "Official company name" },
              tagline: { type: "string", description: "One-line company pitch" },
              description: { type: "string", description: "2-3 sentence company overview" },
              industry: { type: "string", description: "Primary sector e.g. FinTech, HealthTech, AI, SaaS, CleanTech" },
              stage: {
                type: "string",
                enum: ["Pre-Seed", "Seed", "Series A", "Series B", "Series C+", "Growth", "Bootstrapped", "Acquired", "Public", "Unknown"],
                description: "Current or most recent funding stage",
              },
              website: { type: "string", description: "Full website URL including https://" },
              linkedin_url: { type: "string", description: "Full LinkedIn company page URL" },
              valuation_usd: { type: "number", description: "Last known valuation in USD as a plain number (e.g. 1500000000 for $1.5B)" },
              total_raised_usd: { type: "number", description: "Total capital raised in USD as a plain number" },
              founding_year: { type: "integer", description: "Year founded" },
              location: { type: "string", description: "Headquarters: City, Country" },
              employee_count: { type: "integer", description: "Current approximate headcount" },
              last_funding_date: { type: "string", description: "Date of latest funding round in YYYY-MM-DD" },
              founders: {
                type: "array",
                description: "Founding team members",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    title: { type: "string" },
                    linkedin: { type: "string" },
                  },
                  required: ["name"],
                },
              },
              hiring_trend: {
                type: "string",
                enum: ["Growing", "Stable", "Shrinking", "Unknown"],
                description: "Growing = active job postings or headcount increase; Shrinking = layoffs or cuts reported; Stable = flat; Unknown = no data",
              },
              data_confidence: {
                type: "number",
                description: "Overall confidence 0.0-1.0: how many key fields (valuation, team, stage) could you verify from sources",
              },
            },
            required: ["name", "stage"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "save_startup" },
      messages: [
        {
          role: "user",
          content: `You are a financial data analyst for AlphaMap, a market intelligence platform.

Extract accurate, source-verified information for: "${name}"

Rules:
- Convert all financial figures to plain USD numbers ($1.5B → 1500000000, $50M → 50000000)
- Only include website/linkedin if you are confident the URL is correct
- For hiring_trend: check job board counts and news about headcount
- Set data_confidence based on what you actually verified (1.0 = all key fields sourced, 0.3 = mostly inferred)
- If the company is publicly traded (post-IPO), set stage to "Public" — they will be excluded

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

    // Phase 3: Validation gate
    const finalName = String(extracted.name || "").trim();
    if (!finalName) {
      return Response.json({ error: "Extracted company name is empty" }, { status: 422, headers: corsHeaders });
    }

    const stage = normalizeStage(String(extracted.stage || ""));
    if (!VALID_STAGES.includes(stage as ValidStage)) {
      return Response.json(
        {
          error: `Stage "${extracted.stage}" (normalized: "${stage}") is not in the allowed list`,
          reason: stage === "Public" ? "Public/post-IPO companies are excluded from AlphaMap startups" : "Stage not recognized",
          allowed_stages: VALID_STAGES,
        },
        { status: 422, headers: corsHeaders },
      );
    }

    const domain = extracted.website ? cleanDomain(String(extracted.website)) : null;
    if (domain) {
      const { data: dup } = await supabase
        .from("startups")
        .select("id, name")
        .eq("domain", domain)
        .maybeSingle();
      if (dup) {
        return Response.json(
          { error: `Domain "${domain}" already exists for: ${dup.name}`, existing_id: dup.id },
          { status: 409, headers: corsHeaders },
        );
      }
    }

    // Phase 4: Insert
    const record = {
      id: crypto.randomUUID(),
      name: finalName,
      tagline: extracted.tagline ?? null,
      description: extracted.description ?? null,
      industry: extracted.industry ?? null,
      stage,
      website: extracted.website ?? null,
      domain,
      linkedin_url: extracted.linkedin_url ?? null,
      valuation_usd: extracted.valuation_usd ?? null,
      total_raised_usd: extracted.total_raised_usd ?? null,
      founding_year: extracted.founding_year ?? null,
      location: extracted.location ?? null,
      employee_count: extracted.employee_count ?? null,
      last_funding_date: extracted.last_funding_date ?? null,
      founders: extracted.founders ?? null,
      hiring_trend: extracted.hiring_trend ?? "Unknown",
      data_confidence: extracted.data_confidence ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertError } = await supabase
      .from("startups")
      .insert(record)
      .select()
      .single();

    if (insertError) throw insertError;

    console.log(`[ingest] ✓ ${finalName} (${stage}) confidence=${extracted.data_confidence}`);
    return Response.json(
      {
        success: true,
        startup: inserted,
        meta: { stage_normalized: stage !== extracted.stage, domain_checked: !!domain, data_confidence: extracted.data_confidence },
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ingest] Error:", message);
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
});
