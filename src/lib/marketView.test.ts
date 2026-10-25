import { describe, it, expect, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
const { isMissingRelation } = await import("./supabase");

// The Private Market list falls back from startups_market to the full
// startups_search only when the VIEW is missing — never for a missing column,
// which would swap the curated list for every company on file.
describe("isMissingRelation", () => {
  it("is true for a missing view", () => {
    expect(isMissingRelation({ code: "PGRST205", message: "Could not find the table 'public.startups_market' in the schema cache" })).toBe(true);
    expect(isMissingRelation({ code: "42P01", message: 'relation "startups_market" does not exist' })).toBe(true);
  });

  it("is false for a missing column", () => {
    expect(isMissingRelation({ code: "42703", message: "column startups_market.israel_related does not exist" })).toBe(false);
    expect(isMissingRelation({ message: "column startups_market.israel_related does not exist" })).toBe(false);
  });

  it("is false for no error", () => {
    expect(isMissingRelation(null)).toBe(false);
  });
});
