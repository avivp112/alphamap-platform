import { describe, it, expect } from "vitest";
import { investorKey, hostOf, ambiguousClusters, splitLeadInvestors, looksLikePerson, looksLikeAngelGroup } from "./investorNames.ts";

describe("investorKey — conservative", () => {
  it("keeps Index / Index Ventures / Index Capital as three different exact keys", () => {
    const ks = ["Index", "Index Ventures", "Index Capital"].map(investorKey);
    expect(new Set(ks.map((k) => k.exact_key)).size).toBe(3);
    expect(new Set(ks.map((k) => k.loose_key))).toEqual(new Set(["index"]));
  });
  it("removes legal suffixes only", () => {
    expect(investorKey("Accel Partners, L.P.").exact_key).toBe("accel partners");
    expect(investorKey("Hellman & Friedman LLC").exact_key).toBe("hellman and friedman");
    expect(investorKey("Étoile & Co. L.L.C.").exact_key).toBe("etoile and");
    expect(investorKey("Atomico GmbH").exact_key).toBe("atomico");
  });
  it("does not strip fund numbers from the exact key; offers a candidate parent instead", () => {
    const k = investorKey("Sequoia Capital Fund VII L.P.");
    expect(k.exact_key).toBe("sequoia capital fund vii");
    expect(k.firm_candidate_key).toBe("sequoia capital");
    expect(k.fund_series).toBe(7);
    expect(investorKey("Index Ventures Growth VI").firm_candidate_key).toBe("index ventures growth");
  });
  it("does not eat a name that is only a numeral or only a legal word", () => {
    expect(investorKey("IV").exact_key).toBe("iv");
    expect(investorKey("Ltd").exact_key).toBe("ltd");
    expect(investorKey("Group 11").firm_candidate_key).toBe("group");   // a candidate only; never merged
  });
  it("a plain firm has no parent candidate", () => expect(investorKey("Accel").firm_candidate_key).toBeNull());
});

describe("splitLeadInvestors", () => {
  it("splits several names", () => expect(splitLeadInvestors("Accel, Index Ventures; Sequoia")).toEqual(["Accel", "Index Ventures", "Sequoia"]));
  it("does not split before a legal suffix", () => expect(splitLeadInvestors("Bain Capital, LP, Accel")).toEqual(["Bain Capital, LP", "Accel"]));
  it("empty", () => { expect(splitLeadInvestors(null)).toEqual([]); expect(splitLeadInvestors(" ")).toEqual([]); });
});

describe("hints", () => {
  it("looksLikePerson flags people, not obvious firms", () => {
    expect(looksLikePerson("Jane Smith")).toBe(true);
    expect(looksLikePerson("Index Ventures")).toBe(false);
    expect(looksLikePerson("Accel")).toBe(false);
    expect(looksLikePerson("Y Combinator")).toBe(false);
    expect(looksLikePerson("Kleiner Perkins")).toBe(true);   // a known false positive: the script only applies the hint to rare names not on the list
  });
  it("angel groups", () => { expect(looksLikeAngelGroup("Tel Aviv Angels")).toBe(true); expect(looksLikeAngelGroup("Accel")).toBe(false); });
});

describe("hostOf", () => {
  it("strips scheme, www and path", () => expect(hostOf("https://www.indexventures.com/team")).toBe("indexventures.com"));
  it("accepts a bare domain, rejects junk", () => { expect(hostOf("accel.com")).toBe("accel.com"); expect(hostOf(null)).toBeNull(); });
});

describe("ambiguousClusters", () => {
  it("reports shared loose keys only", () => {
    expect(ambiguousClusters(["Index", "Index Ventures", "Accel"].map(investorKey))).toEqual([{ loose_key: "index", exact_keys: ["index", "index ventures"] }]);
  });
});
