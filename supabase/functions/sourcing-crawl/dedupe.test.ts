import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { uniqueByJobId } from "./dedupe";

describe("uniqueByJobId", () => {
  it("keeps one posting per id, the first one, in order", () => {
    const jobs = [
      { external_job_id: "A1", title: "Engineer", url: "u1" },
      { external_job_id: "B2", title: "Designer", url: "u2" },
      { external_job_id: "A1", title: "Engineer (London)", url: "u3" },
    ];
    expect(uniqueByJobId(jobs)).toEqual([jobs[0], jobs[1]]);
  });
  it("leaves a list without repeats unchanged", () => {
    const jobs = [{ external_job_id: "x" }, { external_job_id: "y" }];
    expect(uniqueByJobId(jobs)).toEqual(jobs);
    expect(uniqueByJobId([])).toEqual([]);
  });
  it("is applied to every provider's output before the upsert", () => {
    const src = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(src).toMatch(/return cfg \? uniqueByJobId\(cfg\.parse\(payload, token\)\) : \[\];/);
  });
});
