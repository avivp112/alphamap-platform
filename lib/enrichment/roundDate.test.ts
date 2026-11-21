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
