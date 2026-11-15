/**
 * lib/enrichment/siteOwner.ts — a website that belongs to another company now (owner, 2026-11-09, review 7).
 * Cinsay's site is aibuy's; CheckMarket's is Medallia's: the description v2 built from them described the buyer. When the
 * company's own pages say it was acquired or rebranded, or never name it while naming another company as the owner, there
 * is nothing to describe from them and the company is listed for review ("acquired / rebranded").
 */
interface Page { url: string; content: string }

const core = (s: string) => s.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|corp|corporation|co|ag|sa|bv|plc|labs?|technologies|technology|software|systems)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The registrable name of a host ("www.deel.com" → "deel", "shop.example.co.uk" → "example"). */
const labelOf = (host: string): string => {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const tld2 = parts.length > 2 && /^(?:co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return (parts[Math.max(0, parts.length - tld2)] ?? "").replace(/[^a-z0-9]/g, "");
};

const RENAME_NEW = (nameRe: string) => [
  // "<Company> is now X", "has been renamed X", "now known as X": the company under a new name.
  new RegExp(`\\b${nameRe}\\b[^.\\n]{0,60}\\b(?:is now(?! part of)|has become|has rebranded as|has been renamed(?: to)?|was renamed(?: to)?|rebranded (?:as|to)|(?:is )?now known as|is now called|now called)\\s+([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2})`),
  // "X (formerly <Company>)", "X, formerly known as <Company>"
  new RegExp(`\\b([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2})[\\s,]*\\(?\\s*(?:formerly|previously|fka|f/k/a)\\s+(?:known as\\s+)?${nameRe}\\b`, "i"),
];

/**
 * The new name a company goes by (owner, round 10: TymeBank is GoTyme Bank — the same company, renamed; that is not an acquisition). Read from the
 * pages' own words; a rename is a proposal for the owner, never applied by the pipeline. null when the pages do not say.
 */
export function rebrandedAs(companyName: string, pages: Page[]): string | null {
  const text = pages.slice(0, 4).map((p) => p.content).join("\n").slice(0, 12000);
  const nameRe = esc(companyName.trim()).replace(/\s+/g, "\\s+");
  for (const re of RENAME_NEW(nameRe)) {
    const m = text.match(re);
    const to = m?.[1]?.trim();
    if (to && core(to) !== core(companyName) && to.length >= 3) return to;
  }
  return null;
}

/** null, or the reason ("acquired / rebranded: …") the pages are no description of this company. */
export function siteBelongsToAnotherCompany(companyName: string, website: string | null | undefined, pages: Page[]): string | null {
  if (!pages.length) return null;
  const home = pages.slice(0, 2).map((p) => p.content).join("\n").slice(0, 6000);
  const name = companyName.trim();
  const nameRe = esc(name).replace(/\s+/g, "\\s+");
  // 0. The reader followed the address to another company's site (review 8: hofy.com → deel.com, ezetap.com → razorpay.com).
  const asked = (() => { try { return labelOf(new URL(website?.startsWith("http") ? website : `https://${website}`).hostname); } catch { return ""; } })();
  const key0 = core(companyName);
  for (const p of pages.slice(0, 3)) {
    const fin = p.content.slice(0, 1200).match(/Final URL:\s*(https?:\/\/[^\s]+)/i)?.[1];
    if (!fin || !asked) continue;
    let finHost = ""; try { finHost = new URL(fin).hostname; } catch { continue; }
    const got = labelOf(finHost);
    const related = got === asked || got.includes(asked) || asked.includes(got) || (key0.length >= 3 && (got.includes(key0) || key0.includes(got)));
    // The company's name (TymeBank Limited) on the page the address leads to: the same company under a new address (owner, 2026-11-15: tymebank.co.za → gotyme.co.za).
    // Rebranded or acquired is then decided by what the page SAYS about it (step 1 below), not by the move alone.
    const flatDest = pages.slice(0, 3).map((q) => q.content.replace(/^[\s\S]{0,1600}?Markdown Content:/i, "")).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (got && !related && !(key0.length >= 4 && flatDest.includes(key0))) return `acquired / rebranded: ${asked}'s address leads to ${finHost}`;
  }
  // 1. The pages say, of this company, that it was acquired / is now part of / was renamed.
  const said = [
    new RegExp(`\\b${nameRe}\\b[^.\\n]{0,80}\\b(?:has been|was|is now|is)\\s+(?:acquired by|part of|a part of|now part of|joined|merged into)\\s+([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2})`, "i"),
    // The buyer says it: "Deel acquires Hofy", "Deel has acquired Hofy".
    new RegExp(`\\b[A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2}\\s+(?:has\\s+)?(?:acquired|acquires|bought|buys)\\s+${nameRe}\\b`),
    // The other way round: the company's name is another company's new name ("Grammarly is now Superhuman", "(formerly Grammarly)").
    new RegExp(`\\b[A-Z][\\w&.-]*\\s+(?:is now|has (?:rebranded|renamed itself) (?:as|to)|is becoming|became|rebrands? as|has become)\\s+${nameRe}\\b`),
    new RegExp(`\\b${nameRe}\\b\\s*\\((?:formerly|previously|fka|f/k/a)\\s+[A-Z]`, "i"),
  ];
  for (const re of said) {
    const m = home.match(re);
    if (m) return `acquired / rebranded: the site says "${m[0].replace(/\s+/g, " ").slice(0, 140)}"`;
  }
  // 2. The company is never named, and another company's name is the page's own ("© 2026 aibuy", "Medallia" in the title).
  const key = core(name);
  if (key.length >= 3 && home.length >= 600) {
    const flat = home.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!flat.includes(key)) {
      const host = (() => { try { return new URL(website?.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "").split(".")[0].toLowerCase(); } catch { return ""; } })();
      const hostKey = host.replace(/[^a-z0-9]/g, "");
      if (!hostKey || !flat.includes(hostKey)) {
        const owner = home.match(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*)?([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,2})/i)?.[1];
        return `acquired / rebranded: the site never names ${name}${owner ? ` and is ${owner.trim()}'s` : ""}`;
      }
    }
  }
  return null;
}


/** A headline in which the company is the one acquired ("Equifax acquires DataX", "Aerodrome … acquisition of FlyTech", "X is acquired by Y"); not one where it is the buyer or only joins something. */
export function acquisitionHeadline(title: string, companyName: string): boolean {
  const nameRe = esc(companyName.trim()).replace(/\s+/g, "\\s+");
  const asTarget = new RegExp(`\\b(?:acquires?|acquired|acquisition of|buys|bought|to buy|to acquire|merges? with|takes? over)\\b[^.:;]{0,60}\\b${nameRe}\\b|\\b${nameRe}\\b[^.:;]{0,50}\\b(?:acquired by|bought by|sold to|to be acquired|is being acquired)\\b`, "i");
  if (!asTarget.test(title)) return false;
  // "Acme acquires Foo" with Acme as the company: it is the buyer.
  const asBuyer = new RegExp(`^\\W*${nameRe}\\b(?!\\s+(?:is|was|has been|being|to be|will be|gets|got)\\b)[^.:;]{0,15}\\b(?:acquires?|acquired|buys|bought|to buy|to acquire)\\b`, "i");
  return !asBuyer.test(title);
}
