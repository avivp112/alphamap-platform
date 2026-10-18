import { describe, it, expect } from "vitest";
import { checkStep, checkTitle, displayDomain, formFromInput, isPending, progressKey, statusKey, statusTone } from "./companyCheck";

describe("checkStep", () => {
  it("follows the two phases", () => {
    expect(checkStep({ status: "queued", phase: "identify" })).toBe("identifying");
    expect(checkStep({ status: "running", phase: "identify" })).toBe("identifying");
    expect(checkStep({ status: "awaiting_confirmation", phase: "identify" })).toBe("confirm");
    expect(checkStep({ status: "queued", phase: "check" })).toBe("checking");
    expect(checkStep({ status: "running", phase: "check", gate: null })).toBe("checking");
    expect(checkStep({ status: "running", phase: "check", gate: { status: "ready", reason: "" } })).toBe("researching");
    expect(checkStep({ status: "done", phase: "check", gate: { status: "ready", reason: "" } })).toBe("final");
    expect(checkStep({ status: "ready", phase: "check" })).toBe("final");
    expect(checkStep({ status: "cancelled", phase: "identify" })).toBe("final");
  });
  it("unknown progress reads as starting", () => {
    expect([progressKey("reading"), progressKey("whatever"), progressKey(undefined)]).toEqual(["reading", "starting", "starting"]);
  });
  it("polls only while the worker has it", () => {
    expect(["queued", "running"].every((s) => isPending({ status: s as "queued" }))).toBe(true);
    expect(isPending({ status: "awaiting_confirmation" })).toBe(false);
  });
});

describe("display", () => {
  const input = { name: "nuova", website: null, host: null, country: null, founder: null, linkedin: null, sector: null };
  it("the confirmed company's name and site, else what was typed", () => {
    expect(checkTitle({ input, identity: null })).toEqual({ name: "nuova", website: null });
    expect(checkTitle({ input, identity: { name: "Nuova AI", website: "https://nuova.ai" } })).toEqual({ name: "Nuova AI", website: "https://nuova.ai" });
    expect(checkTitle({ input: { ...input, website: "https://nuova.ai" }, identity: {} })).toEqual({ name: "nuova", website: "https://nuova.ai" });
  });
  it("status labels and tones", () => {
    expect(statusKey({ status: "queued", phase: "identify" })).toBe("finding");
    expect(statusKey({ status: "queued", phase: "check" })).toBe("queued");
    expect([statusTone("ready"), statusTone("stealth"), statusTone("rejected_public"), statusTone("cancelled")]).toEqual(["ok", "warn", "bad", "neutral"]);
  });
  it("domain for display; nothing for a non-URL", () => {
    expect(displayDomain("https://www.nuova.ai/en")).toBe("nuova.ai");
    expect(displayDomain("nuova.ai")).toBe("nuova.ai");
    expect(displayDomain(null)).toBeNull();
  });
  it("prefills the form from an earlier check", () => {
    expect(formFromInput({ ...input, country: "Israel" })).toEqual({ name: "nuova", website: "", country: "Israel", founder: "", linkedin: "", sector: "" });
  });
});
