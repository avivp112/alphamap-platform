import { describe, expect, it } from "vitest";
import { roundDateForColumn } from "./writeCompany.ts";
describe("roundDateForColumn", () => {
  it("makes a month or a year a full date for the date column", () => {
    expect(roundDateForColumn("2020-07")).toEqual({ date: "2020-07-01", precision: "month" });
    expect(roundDateForColumn("2020")).toEqual({ date: "2020-01-01", precision: "year" });
    expect(roundDateForColumn("2020-07-15")).toEqual({ date: "2020-07-15", precision: null });
    expect(roundDateForColumn(null)).toEqual({ date: null, precision: null });
  });
});

import { isWritten } from "./writtenCheck.ts";
describe("verify: a sector written to sector_id is in the database", () => {
  const row = { company_id: "1", company: "Acme", field: "sector", after: "Health & Life Sciences" };
  it("counts the sector name of sector_id, not only the industry column", () => {
    expect(isWritten(row, { id: "1", industry: "Biotechnology", sector_name: "Health & Life Sciences", rounds: [], headcount: [] })).toBe("yes");
    expect(isWritten(row, { id: "1", industry: "Biotechnology", sector_name: "Fintech", rounds: [], headcount: [] })).toBe("no");
    expect(isWritten(row, { id: "1", industry: "Health & Life Sciences", rounds: [], headcount: [] })).toBe("yes");
  });
});
