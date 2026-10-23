import { describe, it, expect } from "vitest";
import { safeHref } from "./safeHref";

describe("safeHref", () => {
  it("keeps web links", () => {
    expect(safeHref("https://jobs.lever.co/acme/1")).toBe("https://jobs.lever.co/acme/1");
    expect(safeHref(" http://x.com/a ")).toBe("http://x.com/a");
  });
  it("drops everything else", () => {
    for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "/jobs/1", "", null, undefined, "https://a b"]) expect(safeHref(u)).toBeNull();
  });
});
