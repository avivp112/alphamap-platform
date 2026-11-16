import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { storedRejection, rememberRejection } from "./techMemory";

describe("a rejection as not technology is kept (owner, round 10: noo.ma, Mototech)", () => {
  beforeEach(() => { process.env.TECH_DECISIONS = join(mkdtempSync(join(tmpdir(), "tm-")), "t.json"); delete process.env.TECH_RECHECK; });
  it("is permanent (an automatic tech override), TECH_MEMORY_DAYS can limit it, and TECH_RECHECK lifts it", () => {
    rememberRejection("c1", { reason: "furniture", kind: "profile" }, "2026-11-10");
    expect(storedRejection("c1", "2026-11-16")?.reason).toBe("furniture");
    expect(storedRejection("c1", "2027-03-01")?.reason).toBe("furniture");
    process.env.TECH_MEMORY_DAYS = "90";
    expect(storedRejection("c1", "2027-03-01")).toBeNull();
    delete process.env.TECH_MEMORY_DAYS;
    expect(storedRejection("c2", "2026-11-16")).toBeNull();
    process.env.TECH_RECHECK = "true";
    expect(storedRejection("c1", "2026-11-16")).toBeNull();
  });
});
