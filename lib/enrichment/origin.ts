/**
 * lib/enrichment/origin.ts — where a company comes from, beside where it is
 * headquartered (owner's decision, 2026-10-25: the Dealroom model).
 *
 *   country           = the HQ today (unchanged; Wiz → United States).
 *   founding_country  = where the company was founded (Wiz → Israel).
 *   israel_rnd_center = it states an R&D / development centre in Israel.
 *
 * A company is "Israel-related" when either of the last two says so, so a
 * filter for Israeli companies keeps Wiz, Cyera and Upwind even after their
 * HQ moved to the US.
 *
 * Both come from the model with a verbatim quote (verifyMaterial), and the
 * quote must also SAY it — these deterministic checks stop a founding
 * country read off a founder's nationality, a customer's location or a
 * sales office.
 */

/** Adjectives a source uses for a country ("an Israeli startup"). */
const DEMONYMS: Record<string, string[]> = {
  "israel": ["israeli"],
  "united states": ["american", "u.s.", "us-based", "u.s.-based"],
  "united kingdom": ["british", "uk-based", "u.k.", "english", "scottish", "welsh"],
  "germany": ["german"],
  "france": ["french"],
  "india": ["indian"],
  "sweden": ["swedish"],
  "netherlands": ["dutch"],
  "spain": ["spanish"],
  "italy": ["italian"],
  "switzerland": ["swiss"],
  "canada": ["canadian"],
  "china": ["chinese"],
  "japan": ["japanese"],
  "singapore": ["singaporean"],
  "australia": ["australian"],
  "brazil": ["brazilian"],
  "ireland": ["irish"],
  "finland": ["finnish"],
  "denmark": ["danish"],
  "norway": ["norwegian"],
  "estonia": ["estonian"],
  "poland": ["polish"],
  "ukraine": ["ukrainian"],
  "argentina": ["argentine", "argentinian"],
};

/** Cities that, in a founding sentence, name the country ("founded in Tel Aviv"). */
const ISRAELI_CITIES = [
  "tel aviv", "tel-aviv", "jerusalem", "haifa", "herzliya", "ramat gan", "petah tikva", "petach tikva",
  "beersheba", "be'er sheva", "beer sheva", "rehovot", "netanya", "ra'anana", "raanana", "hod hasharon",
  "kfar saba", "yokneam", "caesarea", "rosh haayin", "rosh ha'ayin", "or yehuda", "bnei brak", "holon",
  "rishon lezion", "modiin", "modi'in", "airport city", "givatayim", "kiryat gat", "nazareth",
];

// What the COMPANY did there: "founder" is left out — "its co-founder, an Israeli" is a person.
const FOUNDING_WORDS = /\b(founded|founding|co-?founded|started|established|born|launched|incorporated|originated|roots)\b/i;
const NATIONALITY_NOUNS = "(startup|start-up|company|firm|unicorn|scale-?up|venture|outfit|maker|provider|developer|vendor)";
const RND_WORDS = /\b(r&d|r and d|research and development|research & development|development (center|centre|hub|office|team)|engineering (center|centre|hub|office|team|teams)|dev(elopment)? cent(er|re)|tech(nology)? (center|centre|hub))\b/i;

const lc = (s: string) => s.toLowerCase();

/** The words that, in a quote, stand for this country. */
export function countryMentions(country: string): string[] {
  const key = lc(country.trim());
  const cities = key === "israel" ? ISRAELI_CITIES : [];
  return [key, ...(DEMONYMS[key] ?? []), ...cities];
}

function mentions(quote: string, words: string[]): boolean {
  const q = lc(quote);
  return words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(q));
}

export type OriginDrop = "founding_country_not_stated" | "israel_rnd_not_stated";

/**
 * Keep a founding country only when its quote names that country (or one of
 * its cities, or its adjective) AND either says founded/started/born, or uses
 * the adjective for the company itself ("an Israeli startup").
 */
export function checkFoundingCountry(value: string | null | undefined, quote: string | null | undefined): OriginDrop | null {
  if (!value) return null;
  if (!quote) return "founding_country_not_stated";
  const words = countryMentions(value);
  if (!mentions(quote, words)) return "founding_country_not_stated";
  if (FOUNDING_WORDS.test(quote)) return null;
  // The adjective must describe the company: "Israeli cybersecurity startup", not "an Israeli Army veteran ... the company".
  const adjectives = DEMONYMS[lc(value.trim())] ?? [];
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (adjectives.some((a) => new RegExp(`(^|[^a-z])${esc(a)}(\\s+[a-z&-]+){0,3}?\\s+${NATIONALITY_NOUNS}\\b`).test(lc(quote)))) return null;
  return "founding_country_not_stated";
}

/** Keep "R&D in Israel" only when the quote names Israel (or an Israeli city) and an R&D / engineering centre. */
export function checkIsraelRnd(value: boolean | null | undefined, quote: string | null | undefined): OriginDrop | null {
  if (!value) return null;
  if (!quote) return "israel_rnd_not_stated";
  if (!mentions(quote, countryMentions("Israel"))) return "israel_rnd_not_stated";
  return RND_WORDS.test(quote) ? null : "israel_rnd_not_stated";
}

/** Israel-related: founded in Israel, R&D in Israel, or headquartered there. */
export function isIsraelRelated(row: { country?: string | null; founding_country?: string | null; israel_rnd_center?: boolean | null }): boolean {
  const il = (c: string | null | undefined) => !!c && lc(c.trim()) === "israel";
  return il(row.country) || il(row.founding_country) || row.israel_rnd_center === true;
}
