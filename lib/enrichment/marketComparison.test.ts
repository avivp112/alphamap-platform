import { describe, it, expect } from "vitest";
import { judgeMarketPeers, buildPeerComparisonRequest, parsePeerVerdicts, type PeerClaim, type PeerFacts } from "./marketComparison";

/** The plumbing, on the examples of runs 11 and 12 (owner, 2026-11-12). The model's own judgment is measured by scripts/market_compare_check.ts. */
const claim = (name: string, quote: string): PeerClaim => ({ name, source_id: "S1", evidence_quote: quote, how_it_competes: quote, tier: "market" });
const facts = (name: string, description: string): PeerFacts => ({ name, description, website: `https://${name.toLowerCase().replace(/\W/g, "")}.com`, where: "database" });

describe("market peers: the comparison", () => {
  const db: Record<string, PeerFacts> = {
    paytm: facts("Paytm", "Paytm offers payments, wallets and consumer finance to Indian consumers and merchants."),
    laminar: facts("Laminar", "Laminar discovers and protects sensitive data in the cloud for security teams."),
  };
  const deps = (verdict: Record<string, [boolean, boolean]>) => ({
    resolve: async (n: string) => db[n.toLowerCase()] ?? null,
    ask: async (req: ReturnType<typeof buildPeerComparisonRequest>) => ({ verdicts: req.messages[0].content.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => { const name = l.replace(/^\d+\.\s*/, "").split(":")[0]; const v = verdict[name] ?? [false, false]; return { name, same_product: v[0], same_customer: v[1], reason: "r" }; }) }),
  });

  it("keeps a peer only when both the product and the customer match", async () => {
    const r = await judgeMarketPeers(deps({ Paytm: [true, true], Laminar: [false, true] }), { name: "Opus Security", description: "Cloud security orchestration and remediation." },
      [claim("Paytm", "Navi competes with Paytm for consumer lending."), claim("Laminar", "Opus Security, Laminar, and Dig Security raised tens of millions.")]);
    expect(r.kept.map((c) => c.name)).toEqual(["Paytm"]);
    expect(r.dropped).toEqual([{ name: "Laminar", why: expect.stringContaining("not the same product") }]);
  });
  it("a name that is not a company with a website is dropped before the model is asked (\"Shoppable\")", async () => {
    let asked = 0;
    const r = await judgeMarketPeers({ resolve: async () => null, ask: async () => { asked++; return {}; } }, { name: "Smartzer", description: "Shoppable video." }, [claim("Shoppable", "a shoppable video storefront")]);
    expect(r.kept).toEqual([]);
    expect(r.dropped[0].why).toBe("peer_not_a_company_with_a_site");
    expect(asked).toBe(0);
  });
  it("partners, acquirers and 'in contrast to' are dropped before anything is looked up", async () => {
    let resolved = 0;
    const d = { resolve: async () => { resolved++; return null; }, ask: async () => ({}) };
    const r = await judgeMarketPeers(d, { name: "Rand McNally", description: "Navigation." }, [claim("Platform Science", "Truck-safe navigation powered by … Platform Science acquired Trimble's"), claim("Silverfort", "Silverfort acquires Rezonate")]);
    expect(r.dropped.map((x) => x.why)).toEqual(["market_partner_or_integration", "market_acquirer_or_acquired"]);
    expect(resolved).toBe(0);
  });
  it("one call for all the candidates; a missing verdict means no", () => {
    const peers = [facts("A", "a"), facts("B", "b")];
    expect(buildPeerComparisonRequest({ name: "X", description: "x" }, peers).messages[0].content).toMatch(/1\. A: a\n2\. B: b/);
    expect(parsePeerVerdicts({ verdicts: [{ name: "A", same_product: true, same_customer: true, reason: "ok" }] }, peers).map((v) => v.same_product && v.same_customer)).toEqual([true, false]);
  });
});
