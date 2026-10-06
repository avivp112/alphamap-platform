/**
 * lib/enrichment/listing.ts — a deterministic backstop for the model's
 * is_public_company flag. A press release names a listed company with its
 * ticker right after its legal name: "Guardant Health, Inc. (Nasdaq: GH)",
 * "Gritstone bio, Inc. (Nasdaq: GRTS)". The 50-company run left Guardant,
 * Gritstone and Gubra in the private dataset because the model never set
 * the flag.
 *
 * Only words that are part of a company's legal name may sit between the
 * name and the ticker — "Guardsquare Acquires Verimatrix (Euronext: VMX)"
 * is about Verimatrix's listing, not Guardsquare's.
 */

const EXCHANGE = "(?:NASDAQ|Nasdaq(?: [A-Z][a-z]+)?|NYSE(?: American| Arca)?|LSE|AIM|TSX(?:-V)?|ASX|Euronext(?: [A-Z][a-z]+)?|CPH|TASE|SIX|XETRA|FWB|HKEX|SEHK|SGX|NSE|BSE|KRX|TYO|TSE|OTCQX|OTC)";
const LEGAL_WORDS = new Set([
  "inc", "corp", "corporation", "ltd", "limited", "plc", "co", "a/s", "ab", "ag", "se", "n.v", "s.a", "asa", "oyj", "spa",
  "health", "bio", "biosciences", "therapeutics", "pharmaceuticals", "pharma", "holdings", "group", "technologies",
  "technology", "systems", "labs", "software", "networks", "medical", "sciences", "oncology", "international",
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ListingStatement { url: string; quote: string }

export function findListingStatement(
  companyName: string,
  sources: Array<{ url: string; content: string; title?: string }>,
  domain?: string | null,
): ListingStatement | null {
  const name = companyName.trim();
  if (name.length < 3) return null;
  const domainRoot = (domain ?? "").toLowerCase().split(".")[0];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}((?:,?\\s+[\\p{L}/.]+){0,3}?)\\s*\\(\\s*${EXCHANGE}\\s*:\\s*[A-Z0-9.]{1,8}\\s*\\)`, "giu");
  for (const s of sources) {
    for (const m of `${s.title ?? ""}\n${s.content}`.matchAll(re)) {
      const between = m[1].split(/[\s,]+/).filter(Boolean).map((w) => w.toLowerCase().replace(/\.$/, ""));
      if (between.every((w) => LEGAL_WORDS.has(w) || (!!domainRoot && domainRoot.includes(w)))) {
        return { url: s.url, quote: m[0] };
      }
    }
  }
  return null;
}
