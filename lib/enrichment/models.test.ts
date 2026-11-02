import { describe, it, expect } from "vitest";
import { callCostUsd, requestFor, UsageMeter, LONG_PROMPT_TOKENS } from "./models";

describe("models (owner, 2026-11-02: Haiku 5.5 against Haiku 4.5)", () => {
  it("Haiku 5.5 gets no temperature (a 400 there); Haiku 4.5 keeps it", () => {
    const req = { max_tokens: 8192, temperature: 0, messages: [] };
    expect(requestFor(req, "claude-haiku-5-5")).not.toHaveProperty("temperature");
    expect(requestFor(req, "claude-haiku-5-5")).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 8192 });
    expect(requestFor(req, "claude-haiku-4-5-20251001")).toMatchObject({ temperature: 0 });
  });

  it("the cost comes from the reported tokens, with Haiku 5.5's two rate cards", () => {
    const u = { inputTokens: 10_000, outputTokens: 1_000 };
    expect(callCostUsd("claude-haiku-4-5-20251001", u)).toBeCloseTo(0.01 + 0.005, 6);
    expect(callCostUsd("claude-haiku-5-5", u)).toBeCloseTo(0.001 + 0.0005, 6);
    // Cache: writes 1.25x, reads 0.1x — and their tokens count toward the prompt length.
    expect(callCostUsd("claude-haiku-5-5", { inputTokens: 1_000, cacheReadTokens: 50_000, outputTokens: 0 })).toBeCloseTo((1_000 + 5_000) * 0.1e-6, 9);
    // Over 100K tokens of prompt: $0.50 / $2.50.
    const long = { inputTokens: 20_000, cacheReadTokens: 90_000, outputTokens: 1_000 };
    expect(callCostUsd("claude-haiku-5-5", long)).toBeCloseTo((20_000 + 9_000) * 0.5e-6 + 1_000 * 2.5e-6, 9);
  });

  it("the meter keeps the longest prompt and counts calls over 100K", () => {
    const m = new UsageMeter();
    m.add("claude-haiku-5-5", { inputTokens: 30_000, outputTokens: 500 });
    m.add("claude-haiku-5-5", { inputTokens: 5_000, cacheReadTokens: LONG_PROMPT_TOKENS, outputTokens: 500 });
    expect(m.toJSON()).toMatchObject({ calls: 2, maxPromptTokens: 105_000, callsOverLong: 1, outputTokens: 1_000 });
  });
});
