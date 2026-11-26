import { describe, it, expect } from "vitest";
import { isTransientRecording } from "./recorder.ts";

describe("a recorded failure of the moment is missing, not an answer (owner, 2026-11-26)", () => {
  it("a rate limit, a server error and a timeout are transient; a 404 and a dead domain are answers", () => {
    expect(isTransientRecording({ status: 429 }, "google.serper.dev")).toBe(true);
    expect(isTransientRecording({ status: 503 }, "example.com")).toBe(true);
    expect(isTransientRecording({ error: "fetch failed (UND_ERR_CONNECT_TIMEOUT)" }, "example.com")).toBe(true);
    expect(isTransientRecording({ status: 404 }, "example.com")).toBe(false);
    expect(isTransientRecording({ status: 200 }, "google.serper.dev")).toBe(false);
    expect(isTransientRecording({ error: "fetch failed (ENOTFOUND)" }, "dead.example")).toBe(false);
  });
  it("a key or credits that ran out is transient for the search providers only", () => {
    expect(isTransientRecording({ status: 403 }, "google.serper.dev")).toBe(true);
    expect(isTransientRecording({ status: 402 }, "api.tavily.com")).toBe(true);
    expect(isTransientRecording({ status: 403 }, "example.com")).toBe(false);   // a site that forbids us is an answer
  });
});
