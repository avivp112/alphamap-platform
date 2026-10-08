/**
 * lib/enrichment/location.ts — deterministic checks on an extracted HQ city.
 *
 *   - isRegionNotCity(): "Delaware" (a state, usually the incorporation
 *     address), "Canton Appenzell Ausserrhoden" or "Karnataka" is not a
 *     city. City-states (Singapore, Hong Kong, ...) and the cities that share
 *     a state's name (New York, Washington) are kept.
 *   - countryFromLocationQuote(): the country stated right after the city
 *     in the city's own evidence quote — "Poway, Calif.-based", "Cambridge,
 *     Massachusetts", "2970 Hørsholm Denmark", "Petaling Jaya, Selangor".
 *     Only the text immediately following the city is read, so a country
 *     mentioned elsewhere in the sentence is never picked up.
 */

import { MAJOR_CITIES } from "./majorCities";

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
// AP-style abbreviations as they appear in datelines ("TAMPA, Fla.").
const US_AP_ABBREVIATIONS = [
  "Ala.", "Ariz.", "Ark.", "Calif.", "Colo.", "Conn.", "Del.", "Fla.", "Ga.", "Ill.", "Ind.", "Kan.", "Ky.", "La.",
  "Md.", "Mass.", "Mich.", "Minn.", "Miss.", "Mo.", "Mont.", "Neb.", "Nev.", "N.H.", "N.J.", "N.M.", "N.Y.", "N.C.",
  "N.D.", "Okla.", "Ore.", "Pa.", "R.I.", "S.C.", "S.D.", "Tenn.", "Vt.", "Va.", "Wash.", "W.Va.", "Wis.", "Wyo.", "D.C.",
];

// First-level regions outside the US that show up after a city name.
const REGIONS: Record<string, string> = {
  "british columbia": "Canada", ontario: "Canada", quebec: "Canada", "québec": "Canada", alberta: "Canada",
  manitoba: "Canada", saskatchewan: "Canada", "nova scotia": "Canada", "new brunswick": "Canada",
  "new south wales": "Australia", queensland: "Australia", "western australia": "Australia",
  "south australia": "Australia", tasmania: "Australia", victoria: "Australia", "northern territory": "Australia",
  karnataka: "India", maharashtra: "India", haryana: "India", telangana: "India", "tamil nadu": "India",
  "uttar pradesh": "India", gujarat: "India", kerala: "India", "west bengal": "India",
  selangor: "Malaysia", penang: "Malaysia", johor: "Malaysia",
  england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom", "northern ireland": "United Kingdom",
  bavaria: "Germany", catalonia: "Spain", lombardy: "Italy", "île-de-france": "France", "ile-de-france": "France",
};
const CANADA_CODES = ["BC", "ON", "QC", "AB", "MB", "SK", "NS", "NB"];
const AUSTRALIA_CODES = ["NSW", "VIC", "QLD", "WA"];

const CITY_STATES = new Set(["singapore", "hong kong", "monaco", "luxembourg", "macau", "san marino", "vatican city", "kuwait"]);
// Cities that share a state's name and are commonly a real HQ city.
const CITY_NAMED_LIKE_STATE = new Set(["new york", "washington", "victoria"]);

const COUNTRIES: string[] = [...new Set([...MAJOR_CITIES.values()].flatMap((s) => [...s]))];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function isRegionNotCity(city: string | null | undefined): boolean {
  if (!city) return false;
  const c = fold(city);
  if (CITY_STATES.has(c) || CITY_NAMED_LIKE_STATE.has(c)) return false;
  if (/^(canton|county|province|state|region|department|prefecture|district|governorate) (of )?\S/.test(c)) return true;
  if (/\s(county|province|state|region|canton|prefecture|governorate)$/.test(c)) return true;
  if (c in US_STATES || c in REGIONS) return true;
  return COUNTRIES.some((n) => fold(n) === c);
}

function countryInWindow(window: string): string | null {
  for (const country of COUNTRIES) {
    if (country === "Georgia") continue; // "Atlanta, Georgia" — resolved with the US states below
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(country)}(?![\\p{L}])`, "iu").test(window)) return country;
  }
  if (/(^|[^A-Za-z])(US|USA|U\.S\.A?\.?)(?![A-Za-z])/.test(window)) return "United States";
  if (/(^|[^A-Za-z])(UK|U\.K\.)(?![A-Za-z])/.test(window)) return "United Kingdom";
  if (/(^|[^A-Za-z])(UAE)(?![A-Za-z])/.test(window)) return "United Arab Emirates";
  for (const state of Object.keys(US_STATES)) {
    if (new RegExp(`(^|[^a-z])${escapeRe(state)}(?![a-z])`, "i").test(window)) return "United States";
  }
  for (const abbr of US_AP_ABBREVIATIONS) {
    if (new RegExp(`(^|[\\s,])${escapeRe(abbr)}(?![A-Za-z])`).test(window)) return "United States";
  }
  for (const [region, country] of Object.entries(REGIONS)) {
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(region)}(?![\\p{L}])`, "iu").test(window)) return country;
  }
  // Postal codes only right after a comma ("El Segundo, CA", "ANAHEIM,CA,92801", "Beverly, MA-based").
  const code = window.match(/^\s*,\s*([A-Z]{2,3})(?=[\s,.\d)-]|$)/)?.[1];
  if (code) {
    if (Object.values(US_STATES).includes(code) || code === "DC") return "United States";
    if (CANADA_CODES.includes(code)) return "Canada";
    if (AUSTRALIA_CODES.includes(code)) return "Australia";
  }
  return null;
}

/** The country stated immediately after `city` in its own evidence quote, or null. */
export function countryFromLocationQuote(quote: string | null | undefined, city: string | null | undefined): string | null {
  if (!quote || !city) return null;
  const q = quote.normalize("NFC");
  const re = new RegExp(escapeRe(city.normalize("NFC").trim()), "giu");
  for (const m of q.matchAll(re)) {
    const window = q.slice(m.index! + m[0].length, m.index! + m[0].length + 45);
    const country = countryInWindow(window);
    if (!country) continue;
    // Never contradict the curated city list ("Tbilisi, Georgia").
    const known = MAJOR_CITIES.get(fold(city));
    if (known && ![...known].some((c) => c === country)) return null;
    return country;
  }
  return null;
}
