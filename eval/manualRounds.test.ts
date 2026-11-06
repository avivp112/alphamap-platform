import { describe, it, expect } from "vitest";
import { applyManualRounds, MANUAL_ROUNDS, type ManualRound } from "./manualRounds";
import type { GoldenCompany } from "./score";

const hibob: GoldenCompany = { id: "hibob", name: "HiBob", funding_rounds: [{ type: "Series D", amount_usd: 150_000_000, date: "2022-08-17", confidence: "verified" }] };
const cato: GoldenCompany = { id: "cato-networks", name: "Cato Networks", funding_rounds: [{ type: "Series B", amount_usd: 30_000_000, date: null, confidence: "verified", source_url: "https://www.einpresswire.com/x" }] };

describe("manual golden rounds", () => {
  it("adds HiBob's $166M round with Salesforce among the investors", () => {
    const { companies, report } = applyManualRounds([hibob], MANUAL_ROUNDS);
    const r = companies[0].funding_rounds!.find((x) => x.amount_usd === 166_000_000)!;
    expect(r).toMatchObject({ type: "Other", date: "2026-09-01", investors: ["Salesforce"], confidence: "verified" });
    expect(r.source_url).toContain("siliconangle.com");
    expect(report.some((l) => l.startsWith("+ HiBob"))).toBe(true);
  });
  it("completes Cato's Series B with the date and the GlobeNewswire source instead of adding a second one", () => {
    const { companies } = applyManualRounds([cato], MANUAL_ROUNDS);
    const rounds = companies[0].funding_rounds!;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ date: "2016-09-13" });
    expect(rounds[0].source_url).toContain("globenewswire.com");
  });
  it("is idempotent: a second run changes nothing", () => {
    const once = applyManualRounds([hibob, cato], MANUAL_ROUNDS);
    const twice = applyManualRounds(once.companies, MANUAL_ROUNDS);
    expect(twice.companies).toEqual(once.companies);
    expect(twice.report.every((l) => l.startsWith("="))).toBe(true);
  });
  it("names a company that is not in the set instead of failing", () => {
    const e: ManualRound = { company_id: "nope", type: "Seed", amount_usd: 1, date: null, source_url: "x" };
    expect(applyManualRounds([hibob], [e]).report[0]).toContain("not in the golden set");
  });
});
