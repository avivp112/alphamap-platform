import { describe, it, expect } from "vitest";
import { buildSharedExtractionRequest } from "./sharedExtraction";
import { buildLabeledSources } from "./sources";

const sources = buildLabeledSources([
  { url: "https://techcrunch.com/x", provider: "serper", query_label: "funding", content: "Gladia raised a $16 million Series A led by XAnge." },
  { url: "https://gladia.io", provider: "jina", query_label: "website", content: "Gladia — audio transcription API." },
], "gladia.io");
const taxonomy = { parentNames: ["AI & ML"], subNames: ["NLP / Speech"] };
const opts = { taxonomy, today: "2026-10-05" };

describe("buildSharedExtractionRequest — one cached prefix for all three calls", () => {
  const reqs = (["profile", "funding", "market"] as const).map((k) => buildSharedExtractionRequest(k, "Gladia", sources, opts));

  it("sends byte-identical tools and system blocks (the cache key) for every kind", () => {
    const prefix = (r: (typeof reqs)[number]) => JSON.stringify({ tools: r.tools, system: r.system });
    expect(prefix(reqs[1])).toBe(prefix(reqs[0]));
    expect(prefix(reqs[2])).toBe(prefix(reqs[0]));
  });

  it("differs only in tool_choice and the per-kind rules in the user message", () => {
    expect(reqs.map((r) => r.tool_choice.name)).toEqual(["save_profile_extraction", "save_funding_extraction", "save_market_extraction"]);
    expect(reqs[0].messages[0].content).toContain("ACTIVELY SEARCH EVERY CATEGORY");
    expect(reqs[1].messages[0].content).toContain("DIG FOR EARLY ROUNDS");
    expect(reqs[2].messages[0].content).toContain("Today's date is 2026-10-05");
  });

  it("puts the sources in the cached system block, never in the user message", () => {
    expect(reqs[0].system[0].text).toContain("[S1] https://techcrunch.com/x");
    expect(reqs[0].system[0].text).toContain("[W1] https://gladia.io");
    expect(reqs[0].system[0]).toHaveProperty("cache_control", { type: "ephemeral" });
    for (const r of reqs) expect(r.messages[0].content).not.toContain("techcrunch.com/x");
  });

  it("omits cache_control for one-off calls", () => {
    const r = buildSharedExtractionRequest("funding", "Gladia", sources, { ...opts, cache: false });
    expect(r.system[0]).not.toHaveProperty("cache_control");
  });
});
