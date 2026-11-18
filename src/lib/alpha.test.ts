import { describe, expect, it } from "vitest";
import {
  activeMentionQuery, alertKind, applyMention, clampConviction, daysAgo, groupByDay, listPhrase,
  matchesFilter, mentionToken, mergeTimeline, noteMentions, notePlainText, noteSegments, thesisParts,
} from "./alpha";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("mentions", () => {
  it("round-trips a token", () => {
    const tok = mentionToken("Acme (beta) [x]", { type: "startup", id: ID1 });
    expect(tok).toBe(`@[Acme beta x](startup:${ID1})`);
    expect(noteSegments(`Call ${tok} today`)).toEqual([
      { kind: "text", text: "Call " },
      { kind: "mention", name: "Acme beta x", ref: { type: "startup", id: ID1 } },
      { kind: "text", text: " today" },
    ]);
  });
  it("lists distinct mentions and flattens to plain text", () => {
    const body = `A ${mentionToken("K", { type: "crm", id: ID1 })} and ${mentionToken("R", { type: "startup", id: ID2 })} and ${mentionToken("K", { type: "crm", id: ID1 })}`;
    expect(noteMentions(body)).toEqual([{ type: "crm", id: ID1 }, { type: "startup", id: ID2 }]);
    expect(notePlainText(body)).toBe("A K and R and K");
  });
  it("ignores malformed tokens", () => {
    expect(noteMentions("@[X](startup:not-a-uuid) @[Y](bogus:" + ID1 + ")")).toEqual([]);
  });
  it("names a company that has no name", () => {
    expect(mentionToken("  ", { type: "investor", id: ID1 })).toContain("@[Company]");
  });
});

describe("typing a mention", () => {
  it("finds the query at the caret", () => {
    expect(activeMentionQuery("see @ac", 7)).toEqual({ start: 4, query: "ac" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });
  it("needs @ to start a word, and no line break", () => {
    expect(activeMentionQuery("mail me@x", 9)).toBeNull();
    expect(activeMentionQuery("@a\nb", 4)).toBeNull();
    expect(activeMentionQuery("no at here", 5)).toBeNull();
  });
  it("replaces the query with the token", () => {
    const r = applyMention("see @ac now", 4, 7, "@[Acme](startup:" + ID1 + ")");
    expect(r.text).toBe(`see @[Acme](startup:${ID1})  now`);
    expect(r.text.slice(0, r.caret).endsWith(" ")).toBe(true);
  });
});

describe("timeline", () => {
  const e = (id: string, at: string, kind: "note" | "alert" | "legacy" = "note") => ({ id, at, kind, data: null });
  it("sorts newest first, ties by id", () => {
    const out = mergeTimeline([e("b", "2026-11-17T10:00:00Z"), e("a", "2026-11-18T09:00:00Z"), e("c", "2026-11-17T10:00:00Z")]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("groups by day and names today and yesterday", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const g = groupByDay(mergeTimeline([e("1", "2026-11-18T09:00:00Z"), e("2", "2026-11-17T23:00:00Z"), e("3", "2026-11-10T09:00:00Z")]), now);
    expect(g.map((x) => x.label)).toEqual([{ kind: "today" }, { kind: "yesterday" }, { kind: "date", iso: "2026-11-10" }]);
  });
  it("filters by kind", () => {
    expect(matchesFilter("note", "notes")).toBe(true);
    expect(matchesFilter("legacy", "notes")).toBe(true);
    expect(matchesFilter("alert", "notes")).toBe(false);
    expect(matchesFilter("alert", "updates")).toBe(true);
    expect(matchesFilter("note", "all")).toBe(true);
  });
});

describe("small helpers", () => {
  it("clamps conviction", () => {
    expect(clampConviction(9)).toBe(5);
    expect(clampConviction(0)).toBe(1);
    expect(clampConviction(null)).toBeNull();
    expect(clampConviction(NaN)).toBeNull();
  });
  it("maps notification types", () => {
    expect(alertKind("watchlist_filing")).toBe("filing");
    expect(alertKind("watchlist_velocity")).toBe("trending");
    expect(alertKind("thesis_match")).toBe("match");
    expect(alertKind("welcome")).toBe("other");
  });
  it("builds thesis parts only from what is set", () => {
    expect(thesisParts(null)).toBeNull();
    expect(thesisParts({ stages: [], sectors: [" "], geographies: [] })).toBeNull();
    expect(thesisParts({ stages: ["Seed"], sectors: ["Fintech"], geographies: null })).toEqual({ stages: ["Seed"], sectors: ["Fintech"], geographies: [] });
  });
  it("phrases lists", () => {
    expect(listPhrase([])).toBe("");
    expect(listPhrase(["A"])).toBe("A");
    expect(listPhrase(["A", "B"])).toBe("A and B");
    expect(listPhrase(["A", "B", "C"])).toBe("A, B and C");
    expect(listPhrase(["A", "B", "C", "D"])).toBe("A, B +2");
  });
  it("counts days", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(daysAgo("2026-11-15T12:00:00Z", now)).toBe(3);
    expect(daysAgo("2026-12-01T00:00:00Z", now)).toBe(0);
    expect(daysAgo(null, now)).toBeNull();
    expect(daysAgo("junk", now)).toBeNull();
  });
});

import { monthYear, relativeTime } from "./alpha";
describe("time labels", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  it("says relative times", () => {
    expect(relativeTime("2026-11-17T12:00:00Z", "en", now)).toBe("yesterday");
    expect(relativeTime("2026-11-15T12:00:00Z", "en", now)).toBe("3 days ago");
    expect(relativeTime("2026-11-18T09:00:00Z", "en", now)).toBe("3 hours ago");
    expect(relativeTime("nope", "en", now)).toBe("");
  });
  it("falls back to a date when old", () => {
    expect(relativeTime("2026-01-05T00:00:00Z", "en", now)).toBe("Jan 5, 2026");
  });
  it("formats month and year", () => {
    expect(monthYear("2026-03-15", "en")).toBe("Mar 2026");
    expect(monthYear(null, "en")).toBe("");
    expect(monthYear("junk", "en")).toBe("");
  });
});
