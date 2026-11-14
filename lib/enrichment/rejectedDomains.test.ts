import { describe, it, expect } from "vitest";
import { RejectedDomains, rejectedFromLog, mergeRejected, topDomains, rejectedDomainsCsv, describeRejected, domainOf } from "./rejectedDomains.ts";
import { roundSourceStanding } from "./roundSources.ts";

const LOG = `
    🚫  founded_year 2019 not written — its source is not on the allowed list: https://bouncewatch.com/alternatives/krilltech-nanoagtech
    🚫  news "From Brazil to Lisbon and Dubai, global innovator Krilltech " not written — its source is not on the allowed list: https://www.siliconrepublic.com/start-ups/krilltech-diego-stone
    🚫  news "Brazilian start-up claims prize" not written — its source is not on the allowed list: https://www.siliconrepublic.com/start-ups/brazilian-start-up
    🚫  Series A not written (round_source_not_listed)
    🚫  news "x" not written — a page of the company's own site
`;

describe("rejected domains (owner, 2026-11-14)", () => {
  it("reads the 'not on the allowed list' lines of a log and nothing else", () => {
    const rows = rejectedFromLog(LOG);
    expect(rows.map((r) => `${r.domain}|${r.field}|${r.count}`).sort()).toEqual(["bouncewatch.com|founded_year|1", "siliconrepublic.com|news|2"]);
    expect(rows.find((r) => r.domain === "siliconrepublic.com")?.example_title).toContain("Krilltech");
  });
  it("describes the field and the headline", () => {
    expect(describeRejected('news "A headline"')).toEqual({ field: "news", title: "A headline" });
    expect(describeRejected('employee_count 120').field).toBe("employee_count");
  });
  it("groups subdomains and country domains by their registrable domain", () => {
    expect(domainOf("https://en.globes.co.il/x")).toBe("globes.co.il");
    expect(domainOf("https://www.siliconrepublic.com/a")).toBe("siliconrepublic.com");
  });
  it("counts per domain and field, and merges several logs", () => {
    const r = new RejectedDomains();
    r.note("news", "https://a.com/1", "t"); r.note("news", "https://www.a.com/2", "u"); r.note("round", "https://a.com/3", "v");
    expect(r.rows_().map((x) => `${x.field}${x.count}`).sort()).toEqual(["news2", "round1"]);
    expect(mergeRejected([r.rows_(), r.rows_()]).find((x) => x.field === "news")?.count).toBe(4);
  });
  it("tops the domains over their fields, most frequent first", () => {
    const r = new RejectedDomains();
    for (let i = 0; i < 3; i++) r.note("news", "https://big.com/" + i); r.note("round", "https://big.com/r"); r.note("news", "https://small.com/1");
    const t = topDomains(r.rows_(), 40);
    expect(t[0]).toMatchObject({ domain: "big.com", count: 4, fields: "news+round" });
  });
  it("writes the owner's columns", () => {
    const r = new RejectedDomains(); r.note("news", "https://a.com/1", 'a "quoted", title');
    const csv = rejectedDomainsCsv(r.rows_());
    expect(csv.split("\r\n")[0]).toBe("﻿domain,count,field,example_title,example_url,standing");
    expect(csv).toContain('"a ""quoted"", title"');
  });
});

describe("the lists after the owner's decisions", () => {
  it("siliconrepublic.com is tier 4, not tier 2", () => {
    expect(roundSourceStanding("https://www.siliconrepublic.com/start-ups/x")).toMatchObject({ kind: "allowed", tier: 4 });
  });
  it("bouncewatch.com and the other alternatives aggregators are denied", () => {
    for (const u of ["https://bouncewatch.com/alternatives/krilltech", "https://slant.co/x", "https://www.g2.com/products/x", "https://alternativeto.net/software/x"]) expect(roundSourceStanding(u).kind).toBe("denied");
  });
});
