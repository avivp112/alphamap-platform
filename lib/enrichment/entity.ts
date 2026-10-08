/**
 * lib/enrichment/entity.ts — filterByEntity(), per docs/enrichment_v2_spec.md
 * issue 2. Runs before extraction so a same-named, unrelated company's
 * search results never reach the context Claude sees.
 */

import { readFileSync } from "fs";
import wordListPath from "word-list";

// "A single dictionary word" (issue 2) is checked against a real English
// word list (sindresorhus/word-list, ~274k words) rather than only the
// spec's example names — "Apex" and "Nova" are both literally in it, and
// so, tellingly, is "Wiz" (one of the golden-set's own common_name hard
// cases).
const ENGLISH_WORDS: Set<string> = (() => {
  const text = readFileSync(wordListPath, "utf8");
  return new Set(text.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));
})();

// Spec's explicit examples, plus other short, generic, frequently-reused
// startup names that may not all appear in a general English dictionary
// (e.g. stylized/compressed forms) but are just as prone to collision.
export const COMMON_COMPANY_NAMES = new Set([
  "apex", "nova", "atlas", "orbit", "pulse", "vertex", "horizon", "spark", "flux",
  "nexus", "zenith", "catalyst", "momentum", "echo", "prism", "beacon", "summit",
  "anchor", "edge", "forge", "launch", "pivot", "quantum", "rise", "shift", "signal",
  "stride", "surge", "thrive", "vector", "wave", "aurora", "axiom", "cobalt", "drift",
  "ember", "halo", "ion", "wiz",
]);

const SUFFIXES_TO_STRIP = /\b(ltd|inc|llc|gmbh|corp|co|ai|labs|technologies|tech|group|holdings|limited)\b\.?/gi;

/**
 * True when a name is specific enough, on its own, to anchor a search
 * result to one real company. False for: a single English dictionary word,
 * a name on the common-startup-names list, or anything under 5 characters
 * once generic suffixes (Ltd, Inc, AI, Labs, Technologies, ...) are
 * stripped.
 */
export function isDistinctiveName(name: string | null | undefined): boolean {
  if (!name) return false;
  const stripped = name.trim().replace(SUFFIXES_TO_STRIP, "").replace(/\s+/g, " ").trim();
  if (stripped.length < 5) return false;
  const isSingleWord = !/\s/.test(stripped);
  if (isSingleWord) {
    const lower = stripped.toLowerCase();
    if (COMMON_COMPANY_NAMES.has(lower)) return false;
    if (ENGLISH_WORDS.has(lower)) return false;
  }
  return true;
}

export interface EntityAnchors {
  /** Verified company domain, e.g. "apexspace.com" — no protocol, no "www.". */
  domain?: string | null;
  /** Founder/leadership names already on file for this company. */
  founderNames?: string[];
  /** Verified LinkedIn/Crunchbase company profile URLs for this company. */
  verifiedProfileUrls?: string[];
  /** Only set when the existing country is manually verified or registry-sourced (issue 2). */
  trustedCountry?: string | null;
  /**
   * Words that characterize THIS company, taken from its own website pages
   * (trusted by construction — fetched from its own domain). See
   * deriveIdentityKeywords(). Lets a result that names a non-distinctive
   * company ("Ghost", "Foundry") through only when it ALSO uses at least
   * two of these words — "Ghost ... open-source publishing ... newsletter"
   * is the publishing platform, "Ghost ... robotics ... quadruped" is not.
   */
  identityKeywords?: string[];
  /** The company's own LinkedIn company page, when on file — any OTHER linkedin.com/company page is a namesake. */
  companyLinkedinUrl?: string | null;
  /**
   * Words that follow the company's name on its OWN site ("Guardant Health"
   * on guardanthealth.com) — see nameQualifiersOnOwnSite(). Any other
   * organisation word after the name in a result's title marks a namesake.
   */
  ownQualifiers?: string[];
}

// Generic web/business vocabulary that says nothing about which company a
// page is about — never used as an identity keyword.
const GENERIC_WORDS = new Set([
  "about", "access", "account", "across", "after", "again", "based", "before", "being", "below", "best",
  "better", "build", "built", "business", "businesses", "careers", "click", "company", "companies", "contact",
  "content", "cookie", "cookies", "could", "create", "customer", "customers", "digital", "every", "experience",
  "features", "first", "following", "founded", "free", "global", "great", "group", "helps", "their", "there",
  "these", "thing", "things", "those", "through", "today", "together", "industry", "innovative", "leading",
  "learn", "manage", "market", "modern", "month", "months", "never", "offer", "offers", "online",
  "other", "people", "platform", "platforms", "policy", "power", "powerful", "pricing", "privacy", "product",
  "products", "provide", "provides", "really", "request", "right", "service", "services", "should", "simple",
  "since", "software", "solution", "solutions", "start", "started", "support", "system", "systems", "technology",
  "terms", "under", "using", "value", "where", "which", "while", "world", "would", "years", "your", "yours",
  "login", "signup", "email", "trusted", "worldwide", "website", "rights", "reserved",
  // Cookie banners, consent managers, embeds and page chrome — present on
  // most sites, so they say nothing about which company a page is about.
  "cookie", "consent", "session", "visitor", "analytic", "analytics", "duration", "description", "necessary",
  "functional", "preference", "preferences", "advertisement", "tracking", "browser", "information", "store",
  "stored", "google", "youtube", "stripe", "hubspot", "linkedin", "facebook", "twitter", "instagram",
  "image", "images", "video", "videos", "format", "width", "height", "media", "static", "asset", "assets",
  "upload", "uploads", "wordmark", "button", "submit", "subscribe", "newsletter-signup", "accept", "reject",
  "settings", "enable", "enabled", "domain", "third", "party", "partie", "apply", "become", "compare",
  "connection", "approach", "building", "production", "sanity", "event", "events", "client", "clients",
  "testimonial", "testimonials", "assistant", "integration", "integrations", "model", "models", "original",
  "bundle", "label", "collection", "flavor",
  // Seen as junk identity keywords in real runs (page chrome, navigation,
  // vague business vocabulary that any company's page uses).
  "intelligence", "drive", "saving", "search", "feeling", "canva", "feedback", "remove", "advanced", "computer",
  "markdown", "network", "source", "title", "address", "explore", "check", "identity", "working", "release",
  "issue", "please", "close", "location", "english", "deutsch", "resource", "bring", "chain", "center", "field",
  "internal", "enterprise", "management", "operation", "found", "focused", "helping", "driven", "level",
  "growth", "impact", "program", "project", "performance", "joining", "result", "against", "available",
  "player", "embedded", "remote", "starting", "apply", "become", "change", "remain", "continue", "future",
  "small", "potential", "mission", "organization", "celebrated", "option", "personal", "doesn", "integrate",
  "morelearn", "fmedia", "fstatic",
  // More page chrome / consent-manager / address words seen as identity
  // keywords in the 50-company run (Guardant: "clarity, pardot, awsalb").
  "clarity", "display", "pardot", "active", "amazon", "awsalb", "basic", "campaign", "category", "certain",
  "cloudfront", "error", "purpose", "storage", "vendor", "strictly", "allow", "allowed", "select", "checkbox",
  "accessibility", "expire", "timestamp", "wordpress", "pixel", "tracker", "behaviour", "behavior", "maximum",
  "provider", "chief", "officer", "leadership", "press", "documentation", "library", "upcoming", "interaction",
  "multiple", "currently", "determine", "entry", "functionality", "language", "visit", "sorry", "reason",
  "question", "guide", "report", "alway", "detail", "during", "greet", "state", "united", "suite", "partner",
  "community", "collect", "personalize", "response", "solicitation", "illustrative", "corporate", "featured",
  "discover", "story", "storie", "action", "interest", "looking", "different", "launch", "easily", "improve",
]);

// Organisation-type words: "GuidePoint Security" is a different company
// from "Guidepoint", "Gridline Industries Group" from "Gridline".
const ORG_DESIGNATORS = new Set([
  "security", "industries", "technologies", "telematics", "robotics", "therapeutics", "biosciences", "bio",
  "pharma", "pharmaceuticals", "bank", "insurance", "capital", "ventures", "partners", "consulting", "holdings",
  "realty", "properties", "motors", "energy", "logistics", "foods", "entertainment", "studios", "records",
  "agency", "labs", "systems", "media", "games", "health", "medical", "construction", "homes", "apparel",
]);

/** Words directly after the company's name on its own pages (lower-case). */
export function nameQualifiersOnOwnSite(texts: string[], companyName: string): string[] {
  const name = companyName.toLowerCase().replace(SUFFIXES_TO_STRIP, "").trim();
  if (!name) return [];
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s-]+(\\p{L}+)`, "gu");
  const out = new Set<string>();
  for (const t of texts) for (const m of t.toLowerCase().matchAll(re)) out.add(m[1]);
  return [...out];
}

// Pages listing many companies at once (job boards, market maps) — a fact
// on them cannot be tied to one company (Grit's "Series A" came from a
// hnhiring.com month of job posts).
const MULTI_COMPANY_PAGE_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:hnhiring\.com)\/|\/landscape\//i;

// Strips what isn't prose before counting words: URLs, markdown images and
// link targets, percent-encoded path fragments ("%2Fmedia" -> "fmedia").
function proseOnly(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/%[0-9a-f]{2}/gi, " ")
    .replace(/\S+\.(png|jpe?g|svg|webp|gif|avif)\S*/gi, " ");
}

/**
 * Picks the most frequent non-generic words (5+ letters) from the company's
 * own website text, excluding the company's own name tokens — these are
 * what any page genuinely about this company tends to repeat ("publishing",
 * "newsletter", "membership" for Ghost).
 */
export function deriveIdentityKeywords(texts: string[], companyName: string, max = 12): string[] {
  const nameTokens = new Set(companyName.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const raw of proseOnly(text).toLowerCase().split(/[^\p{L}]+/u)) {
      if (raw.length < 5 || GENERIC_WORDS.has(raw) || nameTokens.has(raw)) continue;
      // Plural folds into singular ("newsletters" -> "newsletter"); the
      // singular stem still matches the plural in filterByEntity's
      // substring check.
      const stem = raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
      if (stem.length < 5 || GENERIC_WORDS.has(stem) || nameTokens.has(stem)) continue;
      counts.set(stem, (counts.get(stem) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

function mentionsName(text: string, companyName: string): boolean {
  const name = companyName.toLowerCase().replace(SUFFIXES_TO_STRIP, "").replace(/\s+/g, " ").trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(text);
}

const MIN_IDENTITY_KEYWORD_HITS = 2;

export interface SearchResultLike {
  url: string;
  title?: string;
  snippet?: string;
}

export type EntityMatchKind = "domain_url" | "domain_mention" | "founder_mention" | "verified_profile_url" | "identity_keywords" | "distinctive_name";
export type EntityDropReason =
  | "not_distinctive_name" | "country_contradiction" | "no_entity_match" | "namesake_domain" | "namesake_profile"
  | "name_not_mentioned" | "namesake_qualified_name" | "multi_company_page";

export interface EntityFilterVerdict {
  kept: boolean;
  matched?: EntityMatchKind;
  drop_reason?: EntityDropReason;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function textOf(result: SearchResultLike): string {
  return `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase();
}

/**
 * Classifies ONE search result against the company's anchors and name.
 * Order matches issue 2's own priority: a positive entity match is checked
 * before the name-distinctiveness fallback, and the country-contradiction
 * filter runs last so it can veto an otherwise-kept result.
 */
export function filterByEntity(
  result: SearchResultLike,
  anchors: EntityAnchors,
  companyName: string,
): EntityFilterVerdict {
  const text = textOf(result);
  const host = hostnameOf(result.url);

  if (anchors.domain) {
    const domain = anchors.domain.toLowerCase();
    if (host === domain || host?.endsWith(`.${domain}`)) {
      return { kept: true, matched: "domain_url" };
    }
  }

  if (MULTI_COMPANY_PAGE_RE.test(result.url)) return { kept: false, drop_reason: "multi_company_page" };

  // "<Name> <Security|Industries|...>" in the title or URL slug, when the
  // company's own site never calls itself that, is a different company.
  {
    const name = companyName.toLowerCase().replace(SUFFIXES_TO_STRIP, "").trim();
    const own = new Set([...(anchors.ownQualifiers ?? []), ...companyName.toLowerCase().split(/[^\p{L}\p{N}]+/u)]);
    const ownDomain = (anchors.domain ?? "").toLowerCase();
    const slug = result.url.toLowerCase().replace(/[-_/.]+/g, " ");
    if (name) {
      const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\p{L}+)`, "gu");
      for (const m of `${(result.title ?? "").toLowerCase()} | ${slug}`.matchAll(re)) {
        const q = m[1];
        if (ORG_DESIGNATORS.has(q) && !own.has(q) && !ownDomain.includes(q)) return { kept: false, drop_reason: "namesake_qualified_name" };
      }
    }
  }

  if (anchors.domain) {
    const domain = anchors.domain.toLowerCase();
    if (text.includes(domain)) {
      return { kept: true, matched: "domain_mention" };
    }
  }

  // A namesake's LinkedIn company page (GlobalStep got its founding year
  // from "linkedin.com/company/globalstep-informática", a Portuguese firm).
  const slugOf = (u: string) => u.toLowerCase().match(/linkedin\.com\/company\/([^/?#]+)/)?.[1] ?? null;
  const ownSlug = anchors.companyLinkedinUrl ? slugOf(anchors.companyLinkedinUrl) : null;
  const resultSlug = slugOf(result.url);
  if (ownSlug && resultSlug && decodeURIComponent(resultSlug) !== decodeURIComponent(ownSlug)) {
    return { kept: false, drop_reason: "namesake_profile" };
  }

  // A namesake's own domain: the result is about glean.com while this
  // company is glean.ai (or ghia.com vs drinkghia.com) — the collision a
  // short name invites. Checked after the positive domain match above, so a
  // page mentioning both domains is still kept.
  if (anchors.domain) {
    const domain = anchors.domain.toLowerCase();
    const nameRoot = companyName.toLowerCase().replace(SUFFIXES_TO_STRIP, "").replace(/[^a-z0-9]/g, "");
    if (nameRoot.length >= 3) {
      for (const m of `${result.url.toLowerCase()} ${text}`.matchAll(/\b([a-z0-9-]+)\.(com|ai|io|co|org|net|app|dev|tech|so|xyz|us|uk|de|fr|il)\b/g)) {
        const found = `${m[1]}.${m[2]}`;
        // "gethightower.com" / "hightowerhq.com" are the same name with a
        // marketing prefix or suffix — still a different company's site.
        const label = m[1].replace(/-/g, "");
        const bare = label.replace(/^(get|try|use|join|go|my|the|hello|hi)(?=.{3})/, "").replace(/(hq|app|labs|inc|team|official)$/, "");
        if (found !== domain && !domain.endsWith(`.${found}`) && (label === nameRoot || bare === nameRoot)) {
          return { kept: false, drop_reason: "namesake_domain" };
        }
      }
    }
  }

  for (const founder of anchors.founderNames ?? []) {
    if (founder && text.includes(founder.toLowerCase())) {
      return { kept: true, matched: "founder_mention" };
    }
  }

  for (const profileUrl of anchors.verifiedProfileUrls ?? []) {
    const profileHost = hostnameOf(profileUrl);
    if (profileHost && host === profileHost && result.url.replace(/\/+$/, "") === profileUrl.replace(/\/+$/, "")) {
      return { kept: true, matched: "verified_profile_url" };
    }
  }

  // A non-distinctive name is still trusted when the page names the company
  // AND uses at least two words that characterize it on its own website.
  // At least one hit must be among the company's top-5 most characteristic
  // words — two generic hits ("intelligence", "drive") let a different
  // "Glean" through in a real run.
  const keywords = anchors.identityKeywords ?? [];
  if (keywords.length >= MIN_IDENTITY_KEYWORD_HITS && mentionsName(text, companyName)) {
    const hits = keywords.filter((k) => text.includes(k)).length;
    const coreHit = keywords.slice(0, 5).some((k) => text.includes(k));
    if (hits >= MIN_IDENTITY_KEYWORD_HITS && coreHit) {
      return { kept: true, matched: "identity_keywords" };
    }
  }

  // No positive anchor match — fall back to "is the bare name specific
  // enough to trust on its own".
  if (!isDistinctiveName(companyName)) {
    return { kept: false, drop_reason: "not_distinctive_name" };
  }
  // A distinctive name still has to actually appear (title, snippet or URL
  // slug): Serper also returns partial matches, and a "relay-funding" page
  // about "Relay" gave Global Relay another company's Seed/A/B rounds.
  if (!mentionsName(`${text} ${result.url.toLowerCase().replace(/[-_/.]+/g, " ")}`, companyName)) {
    return { kept: false, drop_reason: "name_not_mentioned" };
  }

  // Contradiction filter: even a distinctive-name match is dropped if the
  // result explicitly places the company in a different country than a
  // trusted anchor.
  if (anchors.trustedCountry) {
    const trusted = anchors.trustedCountry.toLowerCase();
    // A naive contains-check on country NAMES other than the trusted one is
    // unreliable in general, but catching the trusted country's absence
    // alongside an explicit different-country mention in the same snippet
    // is exactly the "Los Angeles, United Kingdom" class of contradiction
    // this filter exists to catch at the search-result level, before it
    // ever reaches extraction.
    if (!text.includes(trusted) && /\b(united states|united kingdom|israel|germany|india|canada|france|australia|china|japan)\b/.test(text)) {
      return { kept: false, drop_reason: "country_contradiction" };
    }
  }

  return { kept: true, matched: "distinctive_name" };
}

export interface FilterResultsOutput {
  kept: SearchResultLike[];
  dropped: Array<{ result: SearchResultLike; drop_reason: EntityDropReason }>;
  /** "low_evidence" means: skip the Claude call entirely, per issue 2 (saves cost on a company with too little to go on). */
  status: "ok" | "low_evidence";
}

export function filterResultsByEntity(
  results: SearchResultLike[],
  anchors: EntityAnchors,
  companyName: string,
): FilterResultsOutput {
  const kept: SearchResultLike[] = [];
  const dropped: FilterResultsOutput["dropped"] = [];
  for (const result of results) {
    const verdict = filterByEntity(result, anchors, companyName);
    if (verdict.kept) kept.push(result);
    else dropped.push({ result, drop_reason: verdict.drop_reason ?? "no_entity_match" });
  }
  return { kept, dropped, status: kept.length < 2 ? "low_evidence" : "ok" };
}
