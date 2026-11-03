import { describe, it, expect } from "vitest";
import { roundSourceStanding, profileSourceAllowed, isDirectoryPage } from "./roundSources";
import { isPressWireUrl } from "./primarySources";
import { markCompanyLinkedFiles, type LabeledSource } from "./sources";

// Owner, 2026-11-03 — decisions and bugs from field review run 2.
describe("source decisions after field review run 2", () => {
  it("new outlets and their tiers", () => {
    expect(roundSourceStanding("https://www.telegraph.co.uk/finance/x.html")).toMatchObject({ kind: "allowed", tier: 2 });
    expect(roundSourceStanding("https://www.geekwire.com/2020/offerup-raises-120m/")).toMatchObject({ kind: "allowed", tier: 3 });
    for (const u of ["https://gamesbeat.com/a/", "https://www.techtarget.com/news/x", "https://siliconangle.com/2022/x", "https://www.bankinfosecurity.com/x", "https://www.biospace.com/x"])
      expect(roundSourceStanding(u)).toMatchObject({ kind: "allowed", tier: 4 });
    expect(roundSourceStanding("https://www.pr.com/press-release/899276")).toMatchObject({ kind: "allowed", tier: 1, lowConfidence: true });
  });
  it("the wires' regional sites are the wire", () => {
    const uk = "https://www.prnewswire.co.uk/news-releases/docplanner-acquires-mydr-301751885.html";
    expect(isPressWireUrl(uk)).toBe(true);
    expect(roundSourceStanding(uk)).toMatchObject({ kind: "allowed", tier: 1 });
    expect(isPressWireUrl("https://www.prnewswire.com.au/news-releases/x.html")).toBe(true);
    expect(isPressWireUrl("https://www.businesswire.de/news/x")).toBe(true);
    expect(isPressWireUrl("https://prnewswire.example.com/x")).toBe(false);
  });
  it("an investor of the company: its own site is allowed", () => {
    expect(roundSourceStanding("https://blumbergcapital.com/news-insights/ibm-acquires-databand/", { investors: ["Accel", "Blumberg Capital"] }))
      .toMatchObject({ kind: "allowed", why: "investor_site" });
    expect(roundSourceStanding("https://blumbergcapital.com/news-insights/ibm-acquires-databand/").kind).toBe("unlisted");
  });
  it("a directory page is never a source, even on an allowed outlet", () => {
    const docplanner = "https://www.eu-startups.com/directory/docplanner/";
    expect(isDirectoryPage(docplanner)).toBe(true);
    expect(profileSourceAllowed({ url: docplanner, source_type: "news" })).toBe(false);
    expect(profileSourceAllowed({ url: "https://www.eu-startups.com/2021/11/scottish-cyber-startup-lupovis-raises/", source_type: "news" })).toBe(true);
    expect(profileSourceAllowed({ url: "https://find-and-update.company-information.service.gov.uk/company/12014731", source_type: "registry" })).toBe(true);
    expect(isDirectoryPage("https://economictimes.indiatimes.com/tech/startups/unacademy-raises/articleshow/1.cms")).toBe(false);
  });
  it("a file the company's site links to, on its site builder's CDN, is the company's site", () => {
    const pdf = "https://cdn.prod.website-files.com/63a1dad0b4ace196f1bf8f84/67f519752941b56820115f93_Nomad%20ADV%20Part%202A_03.2025.pdf";
    const mk = (url: string): LabeledSource => ({ url, content: "", provider: "serper", query_label: "profile", source_id: "S1", source_type: "news" } as unknown as LabeledSource);
    const linked = mk(pdf), unlinked = mk(pdf.replace("67f5", "aaaa"));
    expect(markCompanyLinkedFiles([linked, unlinked], [{ content: `[Form ADV](${pdf})` }])).toBe(1);
    expect(linked.source_type).toBe("company_site");
    expect(unlinked.source_type).toBe("news");
  });
});

describe("domain decisions of 2026-11-03 (rejected-domains table, run 2)", () => {
  it("new tiers, pcmag's regional editions, the rejected blogs", () => {
    for (const u of ["https://www.nosh.com/pr/2024/05/14/x", "https://gameworldobserver.com/2022/07/07/x", "https://www.channele2e.com/news/x", "https://www.pymnts.com/x", "https://www.venturecapitaljournal.com/x"])
      expect(roundSourceStanding(u)).toMatchObject({ kind: "allowed", tier: 4 });
    expect(roundSourceStanding("https://au.pcmag.com/browsers/94724/x")).toMatchObject({ kind: "allowed", tier: 3 });
    for (const u of ["https://reboot-hub.com/blogs/x", "https://www.neatnettricks.com/x", "https://www.stacksync.com/blog/x", "https://www.revenuememo.com/p/x"])
      expect(roundSourceStanding(u)).toMatchObject({ kind: "denied", why: "denied_domain" });
  });
  it("finsmes and the like are hints only", () => {
    expect(roundSourceStanding("https://www.finsmes.com/category/spain/page/46")).toEqual({ kind: "denied", why: "hint_only" });
    expect(roundSourceStanding("https://techfundingnews.com/us-based-npcx-nets-3m/")).toEqual({ kind: "denied", why: "hint_only" });
  });
  it("Yahoo Finance: allowed only as a republication of an allowed source it names", () => {
    const y = "https://finance.yahoo.com/technology/ai/articles/lexisnexis-names-valqari-no-3-113100977.html";
    expect(roundSourceStanding(y, { content: "CHICAGO, Oct. 1, 2026 /PRNewswire/ -- LexisNexis named Valqari…" })).toMatchObject({ kind: "allowed", tier: 1, why: "republished_from:prnewswire.com" });
    expect(roundSourceStanding(y, { content: "SAN FRANCISCO, Oct. 1 (Reuters) - OfferUp raised…" })).toMatchObject({ kind: "allowed", tier: 2 });
    expect(roundSourceStanding(y, { content: "OfferUp raised $120M.\n\nRead the original article on Business Insider" })).toMatchObject({ kind: "allowed", tier: 2 });
    expect(roundSourceStanding(y, { content: "Tyga's giveaway on DitchIt, a fresh rival to OfferUp. According to Reuters, …" })).toMatchObject({ kind: "denied" });
    expect(roundSourceStanding(y, { content: "Originally published on Benzinga." })).toMatchObject({ kind: "denied" });
    expect(roundSourceStanding(y)).toMatchObject({ kind: "denied" });
  });
});

import { sameHeadline } from "./collect";
describe("a hint's headline found in an allowed source", () => {
  it("same story, other words around it", () => {
    expect(sameHeadline("Online Healthcare Booking Platform DocPlanner Raises $20M", "DocPlanner raises $20M for its online healthcare booking platform – TechCrunch")).toBe(true);
    expect(sameHeadline("Online Healthcare Booking Platform DocPlanner Raises $20M", "DocPlanner acquires MyDr")).toBe(false);
  });
});

import { unwrapRedirect } from "./roundSources";
describe("a Google redirect (field review run 1, Avenda)", () => {
  it("is the page it points to; an unreadable one is refused", () => {
    expect(unwrapRedirect("https://www.google.com/url?q=https://techcrunch.com/2022/08/25/x/&sa=U")).toBe("https://techcrunch.com/2022/08/25/x/");
    const token = "https://www.google.com/url?opi=89978449&q=CAESngEB6zswFastak&sa=U";
    expect(unwrapRedirect(token)).toBe(token);
    expect(roundSourceStanding(token).kind).toBe("denied");
  });
});
