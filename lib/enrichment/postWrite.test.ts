import { describe, expect, it } from "vitest";
import { dropRowsFromCsv, parseVerifyMissing, quarantinable } from "./postWrite.ts";

describe("after the write: a few missing values do not undo the batch", () => {
  it("reads the missing lines of verify_written", () => {
    const out = ["Database vs pilot_report_write.csv: 946 value(s) checked, 57 not a column, 2 NOT in the database.", "  ✗ Stigg · sector: Enterprise Software", "  ✗ A · B Co · round: Seed $5M · 2020-07", "✅ other"].join("\n");
    expect(parseVerifyMissing(out)).toEqual([{ company: "Stigg", field: "sector", valueStart: "Enterprise Software" }, { company: "A · B Co", field: "round", valueStart: "Seed $5M · 2020-07" }]);
  });
  it("takes out up to 10 values or 2% of the values checked; more is a systematic fault", () => {
    expect(quarantinable(0, 1000)).toBe(false);
    expect(quarantinable(2, 946)).toBe(true);
    expect(quarantinable(10, 300)).toBe(true);
    expect(quarantinable(11, 300)).toBe(false);
    expect(quarantinable(156, 946)).toBe(false);      // batch 9's false alarm of the sector check
    expect(quarantinable(19, 1000)).toBe(true);
    expect(quarantinable(21, 1000)).toBe(false);
  });
  it("the report without the values taken out keeps everything else, quoting and all", () => {
    const csv = "﻿company_id,company,field,after,quote\r\n1,Stigg,sector,Enterprise Software,\"a, quote\"\r\n1,Stigg,hq_city,Tel Aviv,x\r\n2,Acme,sector,Fintech,y\r\n";
    const r = dropRowsFromCsv(csv, [{ company: "Stigg", field: "sector", after: "Enterprise Software" }]);
    expect(r.removed).toBe(1);
    expect(r.text).toContain("Stigg,hq_city,Tel Aviv");
    expect(r.text).toContain("Acme,sector,Fintech");
    expect(r.text).not.toContain("Enterprise Software");
    expect(r.text.startsWith("﻿company_id,company,field,after,quote\r\n")).toBe(true);
  });
});
