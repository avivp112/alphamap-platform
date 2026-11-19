import { describe, it, expect } from "vitest";
import { investorKey, hostOf, ambiguousClusters } from "./investorNames.ts";

describe("investorKey", () => {
  it("keeps Index / Index Ventures / Index Capital as three different exact keys", () => {
    const ks = ["Index", "Index Ventures", "Index Capital"].map(investorKey);
    expect(new Set(ks.map((k) => k.exact_key)).size).toBe(3);
    expect(new Set(ks.map((k) => k.loose_key))).toEqual(new Set(["index"]));
  });
  it("reads the fund number and drops the legal form", () => {
    const k = investorKey("Index Ventures Growth VI L.P.");
    expect(k.exact_key).toBe("index ventures growth");
    expect(k.fund_series).toBe(6);
    expect(k.vehicle_like).toBe(true);
  });
  it("Fund N and Fund roman are the same series", () => {
    expect(investorKey("Sequoia Capital Fund VII").fund_series).toBe(7);
    expect(investorKey("Sequoia Capital Fund 7").exact_key).toBe("sequoia capital");
  });
  it("does not eat a name that is only a numeral or only a legal word", () => {
    expect(investorKey("IV").exact_key).toBe("iv");
    expect(investorKey("Ltd").exact_key).toBe("ltd");
  });
  it("folds accents, ampersands and L.L.C.", () => {
    expect(investorKey("Étoile & Co. L.L.C.").exact_key).toBe("etoile and");
    expect(investorKey("Hellman & Friedman LLC").exact_key).toBe("hellman and friedman");
  });
  it("a plain firm is not a vehicle", () => {
    expect(investorKey("Accel").vehicle_like).toBe(false);
  });
});

describe("hostOf", () => {
  it("strips scheme, www and path", () => expect(hostOf("https://www.indexventures.com/team")).toBe("indexventures.com"));
  it("accepts a bare domain, rejects junk", () => { expect(hostOf("accel.com")).toBe("accel.com"); expect(hostOf(null)).toBeNull(); });
});

describe("ambiguousClusters", () => {
  it("reports shared loose keys only", () => {
    const c = ambiguousClusters(["Index", "Index Ventures", "Accel"].map(investorKey));
    expect(c).toEqual([{ loose_key: "index", exact_keys: ["index", "index ventures"] }]);
  });
});
