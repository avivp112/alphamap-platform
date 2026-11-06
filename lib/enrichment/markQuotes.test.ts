import { describe, it, expect } from "vitest";
import { quotesFromRows, quoteOf } from "./markQuotes";

describe("the quote of a marked value, from the review runs' files", () => {
  const run = [["run", "company_id", "company", "field", "value", "on_file", "source_url", "quote"], ["3", "id", "HiBob", "competitor", "BambooHR", "", "https://www.hibob.com/blog/x", "Rippling competes with HiBob, Namely, BambooHR."]];
  const batch = [["id", "field", "company", "value", "source_url", "quote", "company_id"], ["5.1", "competitor", "Port", "OpsLevel", "https://www.port.io/g", "Port vs Compass · Port vs OpsLevel", "pid"]];
  it("reads both file layouts", () => {
    const q = quotesFromRows(batch, quotesFromRows(run));
    expect(quoteOf({ company: "HiBob", field: "competitor", value: "BambooHR", source_url: "https://www.hibob.com/blog/x" }, q)).toContain("Rippling competes with HiBob");
    expect(quoteOf({ company: "Port", field: "competitor", value: "OpsLevel", source_url: "https://www.port.io/g" }, q)).toContain("Port vs Compass");
  });
  it("finds nothing for an unknown value, and ignores case and spacing", () => {
    const q = quotesFromRows(run);
    expect(quoteOf({ company: "HiBob", field: "competitor", value: "Gusto", source_url: "" }, q)).toBeNull();
    expect(quoteOf({ company: "hibob ", field: "competitor", value: " bamboohr", source_url: "HTTPS://WWW.HIBOB.COM/BLOG/X" }, q)).not.toBeNull();
  });
  it("a file without a quote column adds nothing", () => {
    expect(quotesFromRows([["company", "field", "value"], ["A", "competitor", "B"]]).size).toBe(0);
  });
});

import { judgeMark } from "./markRules";
describe("the replay judges a competitor mark by its quote (owner, 2026-11-06)", () => {
  const mark = (company: string, value: string, source_url: string) => ({ id: "9.9", field: "competitor", company, value, source_url, verdict: "correct" as const, source_of_mark: "owner" });
  const hibobQuote = "Rippling competes with HiBob, Namely, BambooHR, Gusto, and Workday in the HR space.";
  it("HiBob: BambooHR is no longer produced, Rippling still is", () => {
    const url = "https://www.hibob.com/blog/hibob-vs-namely-vs-rippling/";
    expect(judgeMark(mark("HiBob", "BambooHR", url), { domain: "hibob.com", quote: hibobQuote })).toMatchObject({ produced: false });
    expect(judgeMark(mark("HiBob", "Rippling", url), { domain: "hibob.com", quote: hibobQuote })).toEqual({ produced: true });
  });
  it("Port: a row of links is no longer produced", () => {
    const j = judgeMark(mark("Port", "OpsLevel", "https://www.port.io/glossary/developer-experience"), { domain: "port.io", quote: "Port vs Compass · Port vs Cortex · Port vs OpsLevel · Port vs Backstage · Roadmap" });
    expect(j).toMatchObject({ produced: false, rule: "a row of links, not a quote" });
  });
  it("without a stored quote nothing can be judged and the mark stays", () => {
    expect(judgeMark(mark("HiBob", "BambooHR", "https://www.hibob.com/blog/x"), { domain: "hibob.com" })).toEqual({ produced: true });
  });
});
