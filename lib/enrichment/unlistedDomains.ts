/**
 * lib/enrichment/unlistedDomains.ts — an unlisted source domain that looks like press of the tier-2 kind
 * (owner, 2026-11-07): every run's report names it, so the owner decides it quickly. Pure.
 * Not a rule: a domain here is still unlisted and is still not read until the owner lists it.
 */
import { roundSourceStanding } from "./roundSources";

/** Major outlets the lists do not hold (yet). Edit here to widen what the report points out. */
const MAJOR_PRESS = [
  "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com", "npr.org", "time.com", "newsweek.com", "usatoday.com", "nypost.com",
  "independent.co.uk", "thetimes.co.uk", "news.sky.com", "aljazeera.com", "scmp.com", "japantimes.co.jp", "straitstimes.com",
  "smh.com.au", "theage.com.au", "abc.net.au", "cbc.ca", "nationalpost.com", "lemonde.fr", "spiegel.de", "faz.net", "elpais.com",
  "corriere.it", "bostonglobe.com", "chicagotribune.com", "seattletimes.com", "sfchronicle.com", "vox.com", "theatlantic.com",
  "newyorker.com", "hbr.org", "technologyreview.com", "semafor.com", "politico.com", "politico.eu", "nikkei.com", "handelsblatt.com",
  "zeit.de", "sueddeutsche.de", "ouest-france.fr", "lefigaro.fr", "haaretz.com", "jpost.com", "thehindu.com", "hindustantimes.com",
  "indianexpress.com", "business-standard.com", "livemint.com", "dawn.com", "gulfnews.com", "thenationalnews.com", "arabnews.com",
];

const hostOf = (domain: string) => domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
const onList = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** An unlisted domain that is a major outlet: the report asks the owner to place it. */
export function looksLikeMajorPress(domain: string): boolean {
  const host = hostOf(domain);
  if (roundSourceStanding(`https://${host}/`).kind !== "unlisted") return false;
  return onList(host, MAJOR_PRESS);
}

/** "Unlisted domains that look like tier-2 press — your decision: a.com, b.com", or null when there are none. */
export function majorPressNote(domains: string[]): string | null {
  const hit = [...new Set(domains.map(hostOf))].filter(looksLikeMajorPress);
  return hit.length ? `Unlisted domains that look like tier-2 press — your decision (list one, or deny it): ${hit.join(", ")}` : null;
}
