/**
 * lib/enrichment/articleEntity.ts — is this article about THIS company, or about another one with the same name? (owner, 2026-11-13)
 * Batch 4 dry run: DataX (datax.co.jp, Japanese) got Equifax's purchase of the American DataX, and marvelapp.com got a story about Marvel Comics.
 * A name match is not enough: the article's country and product are compared with the company's profile (its site's country, what it does).
 * One short model call per news item and per round source. "Missing is better than wrong": when the company's own profile is too thin
 * to compare against (nothing about what it does, no country), an article that is not clearly about it is dropped.
 */
export type ArticleEntityVerdict = "this_company" | "other_company" | "unclear";

export interface CompanyProfileForMatch { name: string; website: string | null; countryHint: string | null; about: string }
export interface ArticleForMatch { title: string; url: string; text: string }

const CCTLD: Record<string, string> = { il: "Israel", uk: "United Kingdom", ie: "Ireland", de: "Germany", fr: "France", es: "Spain", it: "Italy", nl: "Netherlands", se: "Sweden", no: "Norway", dk: "Denmark", fi: "Finland", ch: "Switzerland", at: "Austria", be: "Belgium", pt: "Portugal", pl: "Poland", cz: "Czechia", ru: "Russia", ua: "Ukraine", tr: "Turkey", jp: "Japan", cn: "China", hk: "Hong Kong", sg: "Singapore", in: "India", kr: "South Korea", tw: "Taiwan", au: "Australia", nz: "New Zealand", ca: "Canada", br: "Brazil", mx: "Mexico", ar: "Argentina", cl: "Chile", co: "Colombia", pe: "Peru", za: "South Africa", ng: "Nigeria", ke: "Kenya", eg: "Egypt", ae: "United Arab Emirates", sa: "Saudi Arabia", id: "Indonesia", my: "Malaysia", th: "Thailand", vn: "Vietnam", ph: "Philippines" };
/** The country a country-code domain suggests ("datax.co.jp" → Japan, "alus.ca" → Canada); null for .com, .io, .ai and the like. */
export function countryOfHost(host: string | null | undefined): string | null {
  const parts = (host ?? "").toLowerCase().replace(/^www\./, "").split(".");
  const last = parts[parts.length - 1];
  if (parts.length < 2 || !last || last.length !== 2) return null;
  return CCTLD[last] ?? null;
}

const SYSTEM = [
  "You decide whether a news article or press release is about a specific company, or about ANOTHER company or thing that happens to share its name.",
  "You get the company's profile (name, website, the country its domain suggests, what it does) and the article (headline, address, opening text).",
  "Answer 'this_company' only when the article's business, product and country are consistent with the profile. Answer 'other_company' when the article is about a different business, a different country's company, an entertainment brand, a person, or a namesake (an American data company is not a Japanese one; Marvel Comics is not a design-prototyping app).",
  "Answer 'unclear' when the article or the profile say too little to tell. Never guess.",
].join(" ");

export function buildArticleEntityRequest(c: CompanyProfileForMatch, a: ArticleForMatch) {
  return {
    model: "",
    max_tokens: 200,
    temperature: 0,
    tools: [{
      name: "judge_article",
      description: "Say whether the article is about the company in the profile.",
      input_schema: {
        type: "object" as const,
        properties: {
          verdict: { type: "string", enum: ["this_company", "other_company", "unclear"] },
          reason: { type: "string", description: "One short sentence: the article's business and country against the profile's." },
        },
        required: ["verdict", "reason"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "judge_article" },
    system: SYSTEM,
    messages: [{
      role: "user" as const,
      content: [
        `Company: ${c.name}`,
        `Website: ${c.website ?? "unknown"}`,
        `Country its domain suggests: ${c.countryHint ?? "none (a .com or similar)"}`,
        `What it does (its own words): ${c.about ? c.about.slice(0, 700) : "not known"}`,
        "",
        `Article headline: ${a.title}`,
        `Article address: ${a.url}`,
        `Article opening: ${a.text.replace(/\s+/g, " ").slice(0, 1200) || "(not available)"}`,
      ].join("\n"),
    }],
  };
}

export function parseArticleEntity(input: unknown): { verdict: ArticleEntityVerdict; reason: string } {
  const v = (input as { verdict?: unknown })?.verdict;
  return { verdict: v === "this_company" || v === "other_company" ? v : "unclear", reason: String((input as { reason?: unknown })?.reason ?? "no answer").slice(0, 200) };
}

/** Keep an article unless it is clearly another company's; when the profile is too thin to compare against (nothing about what the company does, no country), "unclear" is dropped too. */
export function keepArticle(r: { verdict: ArticleEntityVerdict }, c: CompanyProfileForMatch): boolean {
  if (r.verdict === "other_company") return false;
  if (r.verdict === "unclear") return !!(c.about.trim() || c.countryHint);
  return true;
}

export async function judgeArticleEntity(ask: (request: ReturnType<typeof buildArticleEntityRequest>) => Promise<unknown>, c: CompanyProfileForMatch, a: ArticleForMatch): Promise<{ keep: boolean; verdict: ArticleEntityVerdict; reason: string }> {
  let r: { verdict: ArticleEntityVerdict; reason: string };
  try { r = parseArticleEntity(await ask(buildArticleEntityRequest(c, a))); } catch { r = { verdict: "unclear", reason: "the check failed" }; }
  return { keep: keepArticle(r, c), ...r };
}
