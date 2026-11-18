import { describe, expect, it } from "vitest";
import { askPath, filterPages, isPaletteShortcut, stepIndex } from "./commandPalette";
import { addRecent } from "./recentQuestions";

describe("palette", () => {
  it("filters pages by label or keyword", () => {
    expect(filterPages("").length).toBeGreaterThan(3);
    expect(filterPages("vc").map((p) => p.id)).toEqual(["vcs"]);
    expect(filterPages("journal").map((p) => p.id)).toEqual(["bench"]);
    expect(filterPages("zzz")).toEqual([]);
  });
  it("builds the ask path", () => {
    expect(askPath("  fintech & seed ")).toBe("/dashboard?q=fintech%20%26%20seed");
  });
  it("detects the shortcut", () => {
    const base = { key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(isPaletteShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...base, metaKey: true, key: "K" })).toBe(true);
    expect(isPaletteShortcut(base)).toBe(false);
    expect(isPaletteShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ ...base, ctrlKey: true, key: "j" })).toBe(false);
  });
  it("wraps the selection", () => {
    expect(stepIndex(0, -1, 4)).toBe(3);
    expect(stepIndex(3, 1, 4)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("recent questions", () => {
  it("puts the newest first and drops duplicates", () => {
    expect(addRecent(["b", "a"], "A")).toEqual(["A", "b"]);
    expect(addRecent(["b"], "  new   one ")).toEqual(["new one", "b"]);
  });
  it("caps the list and ignores blanks", () => {
    expect(addRecent(["1", "2", "3"], "4", 3)).toEqual(["4", "1", "2"]);
    expect(addRecent(["1"], "   ")).toEqual(["1"]);
  });
});
