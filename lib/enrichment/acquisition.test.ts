import { describe, it, expect } from "vitest";
import { acquirerIn, detectAcquisition } from "./acquisition";
describe("acquisition (owner, round 10)", () => {
  it("names the buyer when the company is the target", () => {
    expect(acquirerIn("Employment Hero acquires Canadian employment platform Humi in $100M+ global expansion move", "Humi")?.acquirer).toBe("Employment Hero");
    expect(acquirerIn("Payments platform Tyro buys medical fintech startup Medipass", "Medipass")?.acquirer).toBe("Tyro");
    expect(acquirerIn("Six Degrees was acquired by Claranet", "Six Degrees")?.acquirer).toBe("Claranet");
    expect(acquirerIn("Żabka rozpycha się na rynku cateringu dietetycznego. Przejmuje Dietly", "Dietly")).toBeNull();
    expect(acquirerIn("Żabka przejmuje Dietly", "Dietly")?.acquirer).toBe("Żabka");
  });
  it("is not fooled when the company is the buyer", () => {
    expect(acquirerIn("Humi acquires PayrollCo", "Humi")).toBeNull();
  });
  it("a controlling stake is majority_acquired; the full acquisition wins when both exist", () => {
    const r = detectAcquisition([
      { url: "a", title: "Żabka Group Acquires Controlling Stake In Dietary Marketplace Dietly.pl", date: "2021-06-03" },
      { url: "b", title: "Żabka przejmuje Dietly", date: "2026-11-16" },
    ], "Dietly");
    expect(r?.status).toBe("acquired");
    expect(r?.acquirer).toBe("Żabka");
    expect(detectAcquisition([{ url: "a", title: "Żabka Group Acquires Controlling Stake In Dietary Marketplace Dietly", date: "2021-06-03" }], "Dietly")?.status).toBe("majority_acquired");
  });
  it("says nothing when no article states it", () => {
    expect(detectAcquisition([{ url: "a", title: "Humi launches Benefits Plus", date: "2023-06-13" }], "Humi")).toBeNull();
  });
});
