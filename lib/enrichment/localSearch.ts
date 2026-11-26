/**
 * lib/enrichment/localSearch.ts — the fixed searches also in the language of the company's country (owner, round 10): founders, founded, headquarters, raises, acquired.
 * The language comes from the country on file, else the country code of the website's address, else the language of the site. The results go through translation and
 * verification like every other result.
 */
export type Lang = "pl" | "pt" | "es" | "de" | "fr" | "he" | "ar" | "ja";

export const LOCAL_TERMS: Record<Lang, { founders: string; founded: string; hq: string; raises: string; acquired: string }> = {
  pl: { founders: "założyciel", founded: "założona", hq: "siedziba", raises: "pozyskała", acquired: "przejmuje" },
  pt: { founders: "fundador", founded: "fundada em", hq: "sede", raises: "capta", acquired: "adquire" },
  es: { founders: "fundador", founded: "fundada en", hq: "sede", raises: "levanta", acquired: "adquiere" },
  de: { founders: "Gründer", founded: "gegründet", hq: "Sitz", raises: "sammelt", acquired: "übernimmt" },
  fr: { founders: "fondateur", founded: "fondée en", hq: "siège", raises: "lève", acquired: "rachète" },
  he: { founders: "מייסד", founded: "נוסדה", hq: "מטה", raises: "גייסה", acquired: "נרכשה" },
  ar: { founders: "مؤسس", founded: "تأسست", hq: "المقر", raises: "جمعت", acquired: "استحوذت" },
  ja: { founders: "創業者", founded: "設立", hq: "本社", raises: "資金調達", acquired: "買収" },
};

const COUNTRY_LANG: Record<string, Lang> = {
  poland: "pl", brazil: "pt", portugal: "pt", angola: "pt", mozambique: "pt",
  spain: "es", mexico: "es", argentina: "es", chile: "es", colombia: "es", peru: "es", uruguay: "es", venezuela: "es", ecuador: "es", "costa rica": "es", panama: "es", "dominican republic": "es", guatemala: "es",
  germany: "de", austria: "de", france: "fr", belgium: "fr", luxembourg: "fr", senegal: "fr", "ivory coast": "fr", "côte d'ivoire": "fr", morocco: "fr", tunisia: "fr", algeria: "fr",
  israel: "he",
  "saudi arabia": "ar", "united arab emirates": "ar", uae: "ar", egypt: "ar", jordan: "ar", lebanon: "ar", kuwait: "ar", qatar: "ar", bahrain: "ar", oman: "ar", iraq: "ar",
  japan: "ja",
};
const TLD_LANG: Record<string, Lang> = { pl: "pl", br: "pt", pt: "pt", es: "es", mx: "es", ar: "es", cl: "es", co: "es", pe: "es", uy: "es", de: "de", at: "de", fr: "fr", be: "fr", lu: "fr", il: "he", sa: "ar", ae: "ar", eg: "ar", jo: "ar", jp: "ja" };

const STOP: Array<[Lang, RegExp]> = [
  ["pl", /\b(oraz|nasz|nasza|jest|są|dla|się|firma|zespół)\b/gi],
  ["pt", /\b(não|nosso|nossa|para|empresa|você|uma|são)\b/gi],
  ["es", /\b(nuestro|nuestra|empresa|para|una|somos|equipo|más)\b/gi],
  ["de", /\b(und|nicht|wir|unser|unsere|ist|für|über|Unternehmen)\b/gi],
  ["fr", /\b(nous|notre|nos|pour|avec|entreprise|une|équipe)\b/gi],
];

/** The language a text is written in, among the eight, or null (English or unclear). */
export function languageOfText(text: string): Lang | null {
  const sample = text.slice(0, 6000);
  if (!sample.trim()) return null;
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const letters = Math.max(1, (sample.match(/\p{L}/gu) ?? []).length);
  if (count(/[֐-׿]/g) / letters > 0.2) return "he";
  if (count(/[؀-ۿ]/g) / letters > 0.2) return "ar";
  if (count(/[぀-ヿ一-鿿]/g) / letters > 0.2) return "ja";
  const words = Math.max(1, (sample.match(/\p{L}+/gu) ?? []).length);
  let best: { lang: Lang; hits: number } | null = null;
  for (const [lang, re] of STOP) { const hits = count(re); if (hits > (best?.hits ?? 0)) best = { lang, hits }; }
  return best && best.hits / words > 0.03 ? best.lang : null;
}

/** The language of the company's country: the country on file, else its website's country code, else the language of its site. Null when it is English or unknown. */
export function companyLanguage(o: { country?: string | null; website?: string | null; siteText?: string | null }): Lang | null {
  const c = (o.country ?? "").trim().toLowerCase();
  if (c && COUNTRY_LANG[c]) return COUNTRY_LANG[c];
  const host = (o.website ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "");
  const tld = host.split(".").pop() ?? "";
  if (TLD_LANG[tld]) return TLD_LANG[tld];
  return o.siteText ? languageOfText(o.siteText) : null;
}

/** The five fixed searches in that language: [label, query]. */
export function localQueries(name: string, anchor: string, lang: Lang): Array<[string, string]> {
  const t = LOCAL_TERMS[lang];
  return [
    ["founders_local", `"${name}"${anchor} ${t.founders}`],
    ["founded_local", `"${name}"${anchor} ${t.founded}`],
    ["headquarters_local", `"${name}"${anchor} ${t.hq}`],
    ["raises_local", `"${name}"${anchor} ${t.raises}`],
    ["acquired_local", `"${name}"${anchor} ${t.acquired}`],
  ];
}
