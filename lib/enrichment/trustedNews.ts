/**
 * lib/enrichment/trustedNews.ts — the news outlets whose articles count as a
 * primary source that two companies compete (owner, 2026-10-26): only when
 * the article itself says so (the journalist, or a quote from the company),
 * and only in an outlet on this list. Content farms, "top alternatives to X"
 * pages and directories are not here.
 *
 * To add or remove an outlet, edit this list only. Subdomains count
 * (en.globes.co.il, www.calcalistech.com).
 */

export const TRUSTED_NEWS_DOMAINS = [
  // General and business
  "reuters.com", "apnews.com", "bloomberg.com", "wsj.com", "ft.com", "nytimes.com", "washingtonpost.com", "theguardian.com",
  "bbc.com", "bbc.co.uk", "cnbc.com", "economist.com", "forbes.com", "fortune.com", "businessinsider.com", "axios.com",
  "fastcompany.com", "inc.com", "theinformation.com",
  // Technology
  "techcrunch.com", "theverge.com", "wired.com", "venturebeat.com", "siliconangle.com", "zdnet.com", "theregister.com",
  "arstechnica.com", "engadget.com", "geekwire.com", "thenextweb.com", "sifted.eu", "tech.eu", "techinasia.com",
  // Israel
  "calcalistech.com", "calcalist.co.il", "globes.co.il", "themarker.com", "geektime.com", "geektime.co.il",
  "timesofisrael.com", "haaretz.com", "ynetnews.com", "nocamels.com",
  // India
  "economictimes.indiatimes.com", "livemint.com", "inc42.com", "yourstory.com",
  // Trade press
  "adexchanger.com", "adweek.com", "digiday.com", "niemanlab.org", "fiercebiotech.com", "fiercehealthcare.com", "statnews.com",
  "endpts.com", "medcitynews.com", "mobihealthnews.com", "spacenews.com", "finextra.com", "americanbanker.com", "pymnts.com",
  "thepaypers.com",
];

export function isTrustedNewsUrl(url: string): boolean {
  let host: string;
  try { host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  return TRUSTED_NEWS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
