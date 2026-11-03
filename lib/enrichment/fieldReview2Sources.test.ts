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
