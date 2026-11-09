import { describe, it, expect } from "vitest";
import { removeFromList, provenanceFieldOf, isValueField } from "./undoValue";

const news = [
  { url: "https://www.businesswire.com/news/home/20250624442670/en/Synthflow-AI-Raises-%2420M", title: "Synthflow AI Raises $20M to Transform the $168B Global Conversational AI Market", published_date: "2025-06-24" },
  { url: "https://www.businessinsider.com/synthflow-ai-pitch-deck-funding-voice-2025-6?utm_source=x", title: "Synthflow AI is bringing", published_date: "2025-06-25" },
];
describe("one value of a batch taken back (w3.23, wet batch 3)", () => {
  it("removes the news item whose address the batch value cites, and only it (tracking parameters ignored)", () => {
    const r = removeFromList("news", news, "2025-06-25 — Synthflow AI is bringing", "https://www.businessinsider.com/synthflow-ai-pitch-deck-funding-voice-2025-6");
    expect(r.removed?.title).toBe("Synthflow AI is bringing");
    expect(r.next.map((n) => n.title)).toEqual(["Synthflow AI Raises $20M to Transform the $168B Global Conversational AI Market"]);
  });
  it("a value that is no longer in the list removes nothing", () => {
    const r = removeFromList("news", news, "x — y", "https://example.com/gone");
    expect(r.removed).toBeNull();
    expect(r.next).toHaveLength(2);
  });
  it("a competitor or a person is matched by name", () => {
    expect(removeFromList("competitor_declared", [{ name: "Retell AI" }, { name: "Vapi" }], "Retell AI", null).next).toEqual([{ name: "Vapi" }]);
    expect(removeFromList("leader", [{ name: "Jane Roe", role: "CEO" }], "Jane Roe — CEO", null).next).toEqual([]);
  });
  it("the provenance row it had", () => {
    expect(provenanceFieldOf("news", "2025-06-25 — Synthflow AI is bringing")).toBe("news.Synthflow AI is bringing");
    expect(provenanceFieldOf("leader", "Jane Roe — CEO")).toBe("leadership.Jane Roe");
    expect(provenanceFieldOf("competitor_declared", "Retell AI")).toBe("market.competitors");
  });
  it("round and patent values are not list entries this tool can remove", () => {
    expect(isValueField("round")).toBe(false);
    expect(isValueField("patent")).toBe(false);
    expect(isValueField("news")).toBe(true);
  });
});
