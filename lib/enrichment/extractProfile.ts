/**
 * lib/enrichment/extractProfile.ts — extractProfile(), per
 * docs/enrichment_v2_spec.md issue 1 point 5 and the spec's stage 4.
 *
 * One of three extraction calls (extractFunding.ts and extractMarket.ts are
 * the others). Takes the website pages + search results (already filtered
 * by entity.ts) and produces company status, profile, founders,
 * leadership, and headcount metrics, with every material field citing a
 * source_id + a verbatim evidence_quote.
 *
 * Split into two pieces on purpose:
 *   - buildProfileExtractionRequest() / processProfileExtractionResponse()
 *     are pure functions, fully unit-testable without any live API call —
 *     this is where the schema, the prompt rules, and the evidence-
 *     verification wiring actually live, and where their correctness is
 *     checked.
 *   - extractProfile() is the thin wrapper that actually calls the
 *     Anthropic API. It cannot be meaningfully unit-tested without live
 *     credentials (this sandbox has none) — it's intentionally as small as
 *     possible so there's as little untested surface as that constraint
 *     forces.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeModelOutput, ensureArray } from "./sanitize";
import { verifyEvidence, quoteMatchesSource, type EvidenceSource } from "./evidence";
import { formatSourcesForPrompt, type LabeledSource } from "./sources";
import { debugDumpJson } from "./debugDump";
import { checkHeadcountClaim, type HeadcountDropReason } from "./headcount";

export interface SectorTaxonomy {
  parentNames: string[];
  subNames: string[];
}

/**
 * Ground rule 3: "the sector taxonomy constraint" — fetched from the same
 * `sectors` table v1 uses (parent_id null = top-level sector, non-null =
 * sub-sector), so sector_name/sub_sector_name can never drift from what
 * sector_id_by_name() actually resolves against. v1 exports loadSectorTaxonomy()
 * too, but it only sets v1's own PRIVATE module variables — nothing reads
 * the result back out — so v2 needs its own copy that actually returns the
 * data. Returns empty arrays (schema falls back to no enum constraint,
 * matching v1's own behavior) if the fetch fails, rather than block the run.
 */
export async function loadSectorTaxonomy(supabase: SupabaseClient): Promise<SectorTaxonomy> {
  const { data, error } = await supabase.from("sectors").select("name, parent_id");
  if (error) {
    console.warn(`⚠️  Failed to load sector taxonomy: ${error.message} — sector_name/sub_sector_name classification will be skipped this run.`);
    return { parentNames: [], subNames: [] };
  }
  const rows = (data ?? []) as Array<{ name: string; parent_id: string | null }>;
  return {
    parentNames: rows.filter((r) => r.parent_id === null).map((r) => r.name).sort(),
    subNames: rows.filter((r) => r.parent_id !== null).map((r) => r.name).sort(),
  };
}

export interface EvidencedValue<T> {
  value: T;
  source_id: string;
  evidence_quote: string;
}

interface PersonQualityTags {
  had_prior_exit?: boolean;
  elite_background?: boolean;
  notable_pedigree?: boolean;
}

export interface V2Founder extends PersonQualityTags {
  name: string;
  title?: string;
  /** 3-4 sentences per the bio amendment (docs/enrichment_v2_spec.md Section 2 footnote) — narrative, not a single material fact. */
  bio?: string;
  bio_source_ids?: string[];
  linkedin_url?: EvidencedValue<string>;
}

export interface V2Leader extends PersonQualityTags {
  name: string;
  role: string;
  bio?: string;
  bio_source_ids?: string[];
  linkedin_url?: EvidencedValue<string>;
  joined_date?: string;
}

export interface V2Profile {
  website?: EvidencedValue<string>;
  description?: string;
  description_source_ids?: string[];
  value_proposition?: string;
  value_proposition_source_ids?: string[];
  industry?: string;
  founded_year?: EvidencedValue<number>;
  country?: EvidencedValue<string>;
  city?: EvidencedValue<string>;
  founders?: V2Founder[];
  sector_name?: string;
  sub_sector_name?: string;
  sub_sector_names?: string[];
  linkedin_url?: EvidencedValue<string>;
  facebook_url?: EvidencedValue<string>;
  instagram_url?: EvidencedValue<string>;
}

export interface V2HeadcountPoint {
  date: string;
  employee_count: number;
  source_id: string;
  evidence_quote: string;
}

export interface V2Metrics {
  employee_count?: EvidencedValue<number>;
  employee_range?: string;
  growth_trend?: string;
  headcount_history?: V2HeadcountPoint[];
}

// Competitors, acquisitions, news, patents, and technology are extracted
// by their own call (extractMarket.ts) — keeping them here overloaded a
// single Haiku call enough that those sections came back empty for
// companies whose sources plainly contained them.
export interface V2ProfileExtraction {
  is_public_company: boolean;
  is_tech_company: boolean;
  profile: V2Profile;
  leadership: V2Leader[];
  metrics: V2Metrics;
}

// ── Schema construction ─────────────────────────────────────────────────

function materialField(valueSchema: Record<string, unknown>, description: string) {
  return {
    type: "object" as const,
    description,
    properties: {
      value: valueSchema,
      source_id: { type: "string", description: "The [Sx] or [Wx] id (exactly as labeled in the research) of the ONE source this value was taken from." },
      evidence_quote: { type: "string", description: "5-40 words copied VERBATIM from that source's text, containing this exact value. Never paraphrase, never summarize — copy the actual words." },
    },
    required: ["value", "source_id", "evidence_quote"],
  };
}

const PERSON_QUALITY_TAG_PROPERTIES = {
  had_prior_exit: {
    type: "boolean" as const,
    description: "TRUE only if you find clear evidence this person previously FOUNDED a company that was later acquired or went public (IPO). Being an early employee or executive at a company that exited does NOT count. Omit if unknown rather than guessing false.",
  },
  elite_background: {
    type: "boolean" as const,
    description: "TRUE only if you find clear evidence of an elite technical/military background — e.g. an elite intelligence or technology military unit (such as Unit 8200, Talpiot, or an equivalent unit in another country), or a leadership role at a top-tier R&D lab/research institution. Omit if unknown rather than guessing false.",
  },
  notable_pedigree: {
    type: "boolean" as const,
    description: "TRUE only if you find clear evidence of EITHER a key leadership/senior role at a company that was a unicorn ($1B+) AT THE TIME they worked there, OR a degree from a widely-recognized elite university. Omit if unknown rather than guessing false.",
  },
};

const BIO_DESCRIPTION = [
  "3-4 sentences of professional background, for a hover card on this person's name. Prioritize, whenever a",
  "source explicitly states it: (1) where they studied, (2) whether they previously founded a company (and",
  "whether it exited), (3) whether they previously served as CEO of another company, (4) any notable elite",
  "technical/military background (name the specific unit/institution if stated, e.g. 'served in Unit 8200' —",
  "don't just imply it). Every sentence must come from something actually stated in the research. Omit",
  "entirely rather than pad with generic filler, and never invent a detail to reach 3-4 sentences.",
].join(" ");

function profileExtractionTool(taxonomy: SectorTaxonomy) {
  return {
    name: "save_profile_extraction",
    description: "Save the company status, profile, founders, leadership, and headcount metrics of a verified enrichment record.",
    input_schema: {
      type: "object" as const,
      properties: {
        is_public_company: materialField(
          { type: "boolean" },
          "TRUE only if THIS exact company is listed on a public stock exchange (NYSE, NASDAQ, LSE, TASE, Euronext, etc.) under its own ticker, with the specific exchange/ticker stated in the source. Being acquired by, or a subsidiary of, a public company does NOT make this company itself public. Omit the whole field entirely if you cannot point to that -- the default is private.",
        ),
        is_tech_company: { type: "boolean", description: "TRUE for any company whose core product or competitive edge is its own technology/software/R&D (broad category — AI/ML, fintech, biotech, hardware, etc. all count)." },
        profile: {
          type: "object" as const,
          properties: {
            website: materialField({ type: "string" }, "Root domain URL (https://example.com)."),
            description: { type: "string", description: "4-6 detailed sentences: what the company does, who it serves, its differentiator, one concrete traction detail. Every sentence must add real information from the research." },
            description_source_ids: { type: "array", items: { type: "string" }, description: "Every [Sx]/[Wx] id that contributed a fact used in `description`." },
            value_proposition: { type: "string", description: "1-2 sentences: the company's distinct positioning. Omit if not clearly supported." },
            value_proposition_source_ids: { type: "array", items: { type: "string" } },
            industry: { type: "string", description: "Primary tech sector (e.g. 'AI & ML', 'Cybersecurity', 'FinTech')." },
            founded_year: materialField({ type: "integer" }, "Year the company was incorporated. Never infer from an article's publish date or a funding round's date — only from an explicit founding-year statement."),
            country: materialField({ type: "string" }, "HQ country full name. Must come from the SAME source and the SAME sentence/address as `city` — never combine a city from one source with a country from another."),
            city: materialField({ type: "string" }, "HQ city. Must come from the SAME source and the SAME sentence/address as `country`."),
            founders: {
              type: "array",
              description: "ALL founders/co-founders, full legal names.",
              items: {
                type: "object" as const,
                properties: {
                  name: { type: "string" },
                  title: { type: "string", description: "Current title, e.g. 'CEO & Co-Founder'. Omit if not stated." },
                  bio: { type: "string", description: BIO_DESCRIPTION },
                  bio_source_ids: { type: "array", items: { type: "string" } },
                  linkedin_url: materialField({ type: "string" }, "Their personal linkedin.com/in/... URL. Omit entirely if not found verbatim in a source — never guess or construct one from a name."),
                  ...PERSON_QUALITY_TAG_PROPERTIES,
                },
                required: ["name"],
              },
            },
            sector_name: {
              type: "string",
              enum: taxonomy.parentNames.length > 0 ? taxonomy.parentNames : undefined,
              description: "The single best-fit sector from the enumerated list. Omit if genuinely uncertain — never guess.",
            },
            sub_sector_name: {
              type: "string",
              enum: taxonomy.subNames.length > 0 ? taxonomy.subNames : undefined,
              description: "The single best-fit sub-sector, one level more specific than sector_name. Omit if genuinely uncertain.",
            },
            sub_sector_names: {
              type: "array",
              items: {
                type: "string",
                enum: [...taxonomy.parentNames, ...taxonomy.subNames].length > 0 ? [...taxonomy.parentNames, ...taxonomy.subNames] : undefined,
              },
              description: "1-4 OTHER fields this company meaningfully operates in, beyond sector_name/sub_sector_name above. Omit entirely if the company operates in only the one field already captured.",
            },
            linkedin_url: materialField({ type: "string" }, "The COMPANY's own LinkedIn page — not a person's. Omit if not found verbatim in a source."),
            facebook_url: materialField({ type: "string" }, "The company's Facebook page. Omit if not found verbatim in a source."),
            instagram_url: materialField({ type: "string" }, "The company's Instagram page. Omit if not found verbatim in a source."),
          },
        },
        leadership: {
          type: "array",
          description: "Every named, verifiable individual beyond the founders — executives and any other employee with a real name, title, and ideally a LinkedIn profile. Up to 15 people.",
          items: {
            type: "object" as const,
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              bio: { type: "string", description: BIO_DESCRIPTION },
              bio_source_ids: { type: "array", items: { type: "string" } },
              linkedin_url: materialField({ type: "string" }, "Their personal LinkedIn URL. Omit if not found verbatim."),
              joined_date: { type: "string", description: "YYYY-MM-DD (or YYYY-MM-01) only for a genuinely dateable hire — omit otherwise." },
              ...PERSON_QUALITY_TAG_PROPERTIES,
            },
            required: ["name", "role"],
          },
        },
        metrics: {
          type: "object" as const,
          properties: {
            employee_count: materialField({ type: "integer" }, "Most recent stated number of EMPLOYEES of this company ('45 employees', 'the 45-person team', 'team of 45'). Never a count of users, customers, developers, or downloads; never one end of a range ('51-100 employees' goes to employee_range, not here). The quote must name the company unless it comes from its own website. Never estimate."),
            employee_range: { type: "string", description: "Best-fit bracket (e.g. '51-200') when a source only gives a range." },
            growth_trend: { type: "string", description: "12-month headcount direction, if determinable from headcount_history." },
            headcount_history: {
              type: "array",
              description: "Every distinct dated headcount figure found anywhere in the research (funding announcements often state headcount at that time) — oldest to newest.",
              items: {
                type: "object" as const,
                properties: {
                  date: { type: "string" },
                  employee_count: { type: "integer" },
                  source_id: { type: "string" },
                  evidence_quote: { type: "string", description: "5-40 words, verbatim, containing both the date (or dateable context) and the headcount figure." },
                },
                required: ["date", "employee_count", "source_id", "evidence_quote"],
              },
            },
          },
        },
      },
      required: ["is_tech_company"],
    },
  };
}

export function buildProfileExtractionRequest(
  companyName: string,
  sources: LabeledSource[],
  taxonomy: SectorTaxonomy = { parentNames: [], subNames: [] },
) {
  const context = formatSourcesForPrompt(sources);
  const prompt = `You are a financial data analyst. Extract the company status, profile (overview, founding year, location, sector), founders, leadership team, and headcount for the private tech company "${companyName}" from the labeled research below.

STRICT RULES:
1. Only extract facts stated explicitly in the sources below. If a field is not stated, omit it entirely — never guess.
2. Every material field (website, founded_year, country, city, employee_count, every headcount_history point, every LinkedIn/GitHub/Hugging Face URL) requires an evidence_quote copied VERBATIM (5-40 words) from its cited source, and the exact source_id ([S3], [W1], etc.) that quote came from.
3. Never construct or guess a URL. Only output a URL that appears verbatim, character-for-character, in a source.
4. city and country MUST come from the same source and the same sentence or address — never pair a city from one source with a country from another.
5. Never infer founded_year from an article's publish date or from a funding round's date — only from an explicit founding statement.
6. Never estimate headcount or revenue — report only a figure a source explicitly states, with its date.
7. ${BIO_DESCRIPTION}
8. There is no excuse for a company with ANY research data at all to come back with profile: {} — at minimum, describe what it does if that's mentioned anywhere.
9. PUBLIC COMPANY — this is a consequential flag (a true archives the company out of the active dataset), so it needs the same evidence_quote/source_id as any other material field: a specific exchange and ticker stated in the source. A company being ACQUIRED, bought by a strategic/PE buyer, or a subsidiary of a public parent is still PRIVATE itself — report that acquisition via round_type 'Acquired'/'PE Buyout' in the funding history, never by flagging is_public_company. If you cannot cite a direct public-listing statement, omit the field.
10. ACTIVELY SEARCH EVERY CATEGORY — before leaving founders, leadership, metrics.employee_count, metrics.headcount_history, or the HQ location empty, actively re-scan EVERY source below, not just the one whose label obviously matches: a funding-round article often states headcount at the time of the round ("the 45-person startup"), a LinkedIn company snippet states "X employees" or a size bracket ("51-200 employees" -> employee_range ONLY, never employee_count), a founding-year line ("Founded in 2019", "Founded: 2019", "since 2019") often sits in a Crunchbase/LinkedIn snippet or a press release's boilerplate "About" paragraph, a "founded by"/"co-founded by" sentence names EVERY founder (list each one), a team/about page names the executives, a Crunchbase/LinkedIn snippet often states the headquarters city. An empty field is correct only AFTER that active check, never as a default for not having looked.
11. SECTOR — always pick sector_name (and sub_sector_name when one clearly fits) from the enumerated lists once you know what the company does; add sub_sector_names for any other field it genuinely operates in.

Labeled research (each source is tagged [S#] for a search result or [W#] for a fetched website page):
${context}`;

  return {
    model: "", // filled in by the caller with PROFILE_MODEL
    max_tokens: 8192,
    temperature: 0,
    tools: [profileExtractionTool(taxonomy)],
    tool_choice: { type: "tool" as const, name: "save_profile_extraction" },
    messages: [{ role: "user" as const, content: prompt }],
  };
}

// ── Response processing (pure, testable without any live call) ──────────

export type DropReasonCode =
  | "evidence_mismatch" | "value_not_in_quote" | "url_not_in_source" | "source_not_found" | HeadcountDropReason;

export interface DroppedField {
  field: string;
  reason: DropReasonCode;
}

export interface ProcessedProfileExtraction {
  result: V2ProfileExtraction;
  dropped: DroppedField[];
}

function verifyMaterial<T>(
  field: string,
  claim: EvidencedValue<T> | undefined,
  sources: Record<string, EvidenceSource>,
  dropped: DroppedField[],
  isUrl = false,
): EvidencedValue<T> | undefined {
  if (!claim) return undefined;
  const verdict = verifyEvidence(
    { field, value: claim.value as unknown as string | number, source_id: claim.source_id, evidence_quote: claim.evidence_quote, is_url: isUrl },
    sources,
  );
  if (!verdict.verified) {
    dropped.push({ field, reason: (verdict.drop_reason as DropReasonCode) ?? "evidence_mismatch" });
    return undefined;
  }
  return claim;
}

/**
 * is_public_company gets its own check rather than reusing verifyMaterial:
 * the claimed value is a boolean, and valueAppearsInQuote (string/number only
 * — would throw on a boolean) has no way to confirm "true" is literally in
 * the quote. What actually matters is that the cited quote is a REAL,
 * genuine statement of public-market listing -- so this checks source
 * existence + quote authenticity (same two checks verifyEvidence runs
 * before its value-specific check) and trusts the boolean once those hold.
 * A real DRY_RUN run flagged a privately-held, recently-acquired company as
 * public with zero evidence at all (is_public_company had no evidence
 * requirement before this fix) -- archiving (status='ipo') a real portfolio
 * company on a hallucinated claim is exactly the "wrong is worse than
 * missing" case ground rule 1 exists for. `false`/omitted never needs
 * verification: the safe default is already private.
 */
function verifyIsPublicClaim(
  claim: EvidencedValue<boolean> | undefined,
  sources: Record<string, EvidenceSource>,
  dropped: DroppedField[],
): boolean {
  if (!claim || !claim.value) return false;
  const source = sources[claim.source_id];
  if (!source) {
    dropped.push({ field: "is_public_company", reason: "source_not_found" });
    return false;
  }
  if (!quoteMatchesSource(claim.evidence_quote, source.content).matched) {
    dropped.push({ field: "is_public_company", reason: "evidence_mismatch" });
    return false;
  }
  return true;
}

/**
 * Sanitizes the raw tool_use input and verifies every material field's
 * evidence, dropping (and recording the reason for) anything that doesn't
 * check out. Does NOT run validation.ts's logical rules (city/country
 * plausibility, founded_year-vs-rounds, etc.) — that happens one level up
 * in the orchestrator, after extractFunding() has also run, since several
 * of those rules need both halves (e.g. founded_after_first_round needs
 * the rounds that only extractFunding produces).
 */
export function processProfileExtractionResponse(
  rawToolInput: unknown,
  sources: LabeledSource[],
  companyName?: string,
): ProcessedProfileExtraction {
  const sourceLookup: Record<string, EvidenceSource> = Object.fromEntries(
    sources.map((s) => [s.source_id, { content: s.content, url: s.url }]),
  );
  const dropped: DroppedField[] = [];
  const i = sanitizeModelOutput(rawToolInput) as Partial<V2ProfileExtraction> & {
    profile?: Partial<V2Profile>;
    is_public_company?: EvidencedValue<boolean>;
  };

  const profile: V2Profile = {
    website: verifyMaterial("profile.website", i.profile?.website, sourceLookup, dropped, true),
    description: i.profile?.description,
    description_source_ids: i.profile?.description_source_ids,
    value_proposition: i.profile?.value_proposition,
    value_proposition_source_ids: i.profile?.value_proposition_source_ids,
    industry: i.profile?.industry,
    founded_year: verifyMaterial("profile.founded_year", i.profile?.founded_year, sourceLookup, dropped),
    country: verifyMaterial("profile.country", i.profile?.country, sourceLookup, dropped),
    city: verifyMaterial("profile.city", i.profile?.city, sourceLookup, dropped),
    founders: ensureArray<V2Founder>(i.profile?.founders).map((f, idx) => ({
      ...f,
      linkedin_url: verifyMaterial(`profile.founders[${idx}].linkedin_url`, f.linkedin_url, sourceLookup, dropped, true),
    })),
    sector_name: i.profile?.sector_name,
    sub_sector_name: i.profile?.sub_sector_name,
    sub_sector_names: i.profile?.sub_sector_names,
    linkedin_url: verifyMaterial("profile.linkedin_url", i.profile?.linkedin_url, sourceLookup, dropped, true),
    facebook_url: verifyMaterial("profile.facebook_url", i.profile?.facebook_url, sourceLookup, dropped, true),
    instagram_url: verifyMaterial("profile.instagram_url", i.profile?.instagram_url, sourceLookup, dropped, true),
  };

  const leadership: V2Leader[] = ensureArray<V2Leader>(i.leadership).map((l, idx) => ({
    ...l,
    linkedin_url: verifyMaterial(`leadership[${idx}].linkedin_url`, l.linkedin_url, sourceLookup, dropped, true),
  }));

  // A headcount number also has to be an EMPLOYEE count of THIS company
  // (see headcount.ts) — not "70,000 developers", "$4 million", or one end
  // of "51-100 employees".
  const sourceById = new Map(sources.map((s) => [s.source_id, s]));
  const headcountProblem = (value: number, sourceId: string, quote: string): HeadcountDropReason | null => {
    const src = sourceById.get(sourceId);
    return checkHeadcountClaim(value, quote ?? "", src && {
      url: src.url, title: src.title, isCompanySite: src.source_id.startsWith("W") || src.source_type === "company_site",
    }, companyName);
  };

  const headcountHistory = ensureArray<V2HeadcountPoint>(i.metrics?.headcount_history).filter((point) => {
    const verdict = verifyEvidence(
      { field: "metrics.headcount_history", value: point.employee_count, source_id: point.source_id, evidence_quote: point.evidence_quote },
      sourceLookup,
    );
    if (!verdict.verified) {
      dropped.push({ field: "metrics.headcount_history", reason: (verdict.drop_reason as DropReasonCode) ?? "evidence_mismatch" });
      return false;
    }
    const problem = headcountProblem(point.employee_count, point.source_id, point.evidence_quote);
    if (problem) { dropped.push({ field: "metrics.headcount_history", reason: problem }); return false; }
    return true;
  });

  let employeeCount = verifyMaterial("metrics.employee_count", i.metrics?.employee_count, sourceLookup, dropped);
  if (employeeCount) {
    const problem = headcountProblem(employeeCount.value, employeeCount.source_id, employeeCount.evidence_quote);
    if (problem) { dropped.push({ field: "metrics.employee_count", reason: problem }); employeeCount = undefined; }
  }

  const metrics: V2Metrics = {
    employee_count: employeeCount,
    employee_range: i.metrics?.employee_range,
    growth_trend: i.metrics?.growth_trend,
    headcount_history: headcountHistory,
  };

  return {
    result: {
      is_public_company: verifyIsPublicClaim(i.is_public_company, sourceLookup, dropped),
      is_tech_company: i.is_tech_company ?? true,
      profile,
      leadership,
      metrics,
    },
    dropped,
  };
}

// ── Live API wrapper (not unit-testable without credentials) ────────────

export interface ExtractProfileOptions {
  client: Anthropic;
  model: string;
  taxonomy?: SectorTaxonomy;
  /** A prebuilt request (sharedExtraction.ts, prompt-cached) instead of this module's own single-call request. */
  request?: object;
}

export async function extractProfile(
  companyName: string,
  sources: LabeledSource[],
  options: ExtractProfileOptions,
): Promise<{ extraction: ProcessedProfileExtraction; stopReason: string | null; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number } | null> {
  const request = (options.request ?? buildProfileExtractionRequest(companyName, sources, options.taxonomy)) as ReturnType<typeof buildProfileExtractionRequest>;
  debugDumpJson(companyName, "profile_sources", sources);
  const msg = await options.client.messages.create({ ...request, model: options.model });

  // No fallback defaults that make a truncated/missing response look valid
  // (the lesson from Phase 0's funding_rounds=0% investigation): a
  // truncated call is reported as such, never silently parsed as "the
  // company just has no data".
  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") {
    return { extraction: { result: emptyProfileExtraction(), dropped: [] }, stopReason: msg.stop_reason, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 };
  }
  debugDumpJson(companyName, "profile_raw", tool.input);

  const extraction = processProfileExtractionResponse(tool.input, sources, companyName);
  debugDumpJson(companyName, "profile_dropped", extraction.dropped);

  return {
    extraction,
    stopReason: msg.stop_reason,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
  };
}

function emptyProfileExtraction(): V2ProfileExtraction {
  return {
    is_public_company: false,
    is_tech_company: true,
    profile: {},
    leadership: [],
    metrics: {},
  };
}
