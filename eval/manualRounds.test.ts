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

describe("the rounds the owner marked on 2026-11-06", () => {
  const upwind: GoldenCompany = { id: "upwind-security", name: "Upwind", funding_rounds: [{ type: "Series B", amount_usd: 250_000_000, date: "2026-01-29", confidence: "verified" }] };
  const mistral: GoldenCompany = { id: "mistral-ai", name: "Mistral AI", funding_rounds: [{ type: "Series C", amount_usd: 2_000_000_000, date: "2025-09", confidence: "verified" }] };
  it("adds Upwind's Series C and Mistral's Series D with their lead investors", () => {
    const { companies } = applyManualRounds([upwind, mistral], MANUAL_ROUNDS);
    expect(companies[0].funding_rounds!.find((r) => r.type === "Series C")).toMatchObject({ amount_usd: 400_000_000, date: "2026-10-28", lead_investor: "Bessemer Venture Partners" });
    expect(companies[1].funding_rounds!.find((r) => r.type === "Series D")).toMatchObject({ amount_usd: 3_480_000_000, date: "2026-09-08", lead_investor: "Samsung Electronics" });
  });
  it("the review sheet's import later finds them there and adds nothing twice", async () => {
    const { applyRoundMarks } = await import("./reviewSheet");
    const { companies } = applyManualRounds([upwind], MANUAL_ROUNDS);
    applyRoundMarks(companies, [{ company_id: "upwind-security", company: "Upwind", round_type: "Series C", amount_usd: "400000000", date: "2026-10-28", lead_investor: "Bessemer Venture Partners", source_url: "x", mark: "נכון" }]);
    expect(companies[0].funding_rounds!.filter((r) => r.type === "Series C")).toHaveLength(1);
  });
});
