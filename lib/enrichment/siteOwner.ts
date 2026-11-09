/**
 * lib/enrichment/siteOwner.ts — a website that belongs to another company now (owner, 2026-11-09, review 7).
 * Cinsay's site is aibuy's; CheckMarket's is Medallia's: the description v2 built from them described the buyer. When the
 * company's own pages say it was acquired or rebranded, or never name it while naming another company as the owner, there
 * is nothing to describe from them and the company is listed for review ("acquired / rebranded").
 */
interface Page { url: string; content: string }

const core = (s: string) => s.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|corp|corporation|co|ag|sa|bv|plc|labs?|technologies|technology|software|systems)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** null, or the reason ("acquired / rebranded: …") the pages are no description of this company. */
export function siteBelongsToAnotherCompany(companyName: string, website: string | null | undefined, pages: Page[]): string | null {
  if (!pages.length) return null;
  const home = pages.slice(0, 2).map((p) => p.content).join("\n").slice(0, 6000);
  const name = companyName.trim();
  const nameRe = esc(name).replace(/\s+/g, "\\s+");
  // 1. The pages say, of this company, that it was acquired / is now part of / was renamed.
  const said = [
    new RegExp(`\\b${nameRe}\\b[^.\\n]{0,80}\\b(?:has been|was|is now|is)\\s+(?:acquired by|part of|a part of|now part of|joined|merged into|renamed|rebranded|now known as|now called)\\s+([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2})`, "i"),
    new RegExp(`\\b${nameRe}\\b[^.\\n]{0,60}\\b(?:is now|has become|has rebranded as|has been renamed)\\s+([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2})`),
    new RegExp(`\\bformerly\\s+(?:known as\\s+)?${nameRe}\\b`, "i"),
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
