import { describe, expect, it } from "vitest";
import { addRecent } from "./recentQuestions";

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
