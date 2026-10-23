import { describe, it, expect } from "vitest";
import { parseGreenhouse, parseLever, parseAshby, parseWorkable, departmentsByJobId } from "./parse";

describe("department and location, per ATS", () => {
  it("Greenhouse: location from the job list, department from /departments (most specific wins)", () => {
    const jobs = parseGreenhouse({ jobs: [
      { id: 11, title: "Backend Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/11", location: { name: "Tel Aviv, Israel" } },
      { id: 12, title: "AE", absolute_url: "https://boards.greenhouse.io/acme/jobs/12" },
    ] });
    expect(jobs).toEqual([
      { external_job_id: "11", title: "Backend Engineer", url: "https://boards.greenhouse.io/acme/jobs/11", location: "Tel Aviv, Israel" },
      { external_job_id: "12", title: "AE", url: "https://boards.greenhouse.io/acme/jobs/12", location: null },
    ]);
    const depts = departmentsByJobId({ departments: [
      { id: 1, name: "R&D", parent_id: null, jobs: [{ id: 11 }] },
      { id: 2, name: "Platform", parent_id: 1, jobs: [{ id: 11 }] },
      { id: 3, name: "Sales", parent_id: null, jobs: [{ id: 12 }] },
      { id: 4, name: "No Department", parent_id: null, jobs: [{ id: 13 }] },
    ] });
    expect(Object.fromEntries(depts)).toEqual({ "11": "Platform", "12": "Sales" });
    expect(departmentsByJobId(null).size).toBe(0);
  });

  it("Lever: categories.department, else the team; categories.location", () => {
    expect(parseLever([
      { id: "a", text: "Designer", hostedUrl: "https://jobs.lever.co/x/a", categories: { department: "Product", team: "Design", location: "Remote" } },
      { id: "b", text: "SRE", hostedUrl: "https://jobs.lever.co/x/b", categories: { team: "Infrastructure" } },
      { id: "c", text: "PM", hostedUrl: "https://jobs.lever.co/x/c" },
    ]).map((j) => [j.department, j.location])).toEqual([["Product", "Remote"], ["Infrastructure", null], [null, null]]);
  });

  it("Ashby: department, else team; location", () => {
    expect(parseAshby({ jobs: [
      { id: "1", title: "ML Engineer", jobUrl: "u1", department: "Engineering", team: "ML", location: "New York" },
      { id: "2", title: "Recruiter", jobUrl: "u2", team: "People" },
      { id: "3", title: "Hidden", jobUrl: "u3", isListed: false, department: "X" },
    ] }).map((j) => [j.title, j.department, j.location])).toEqual([["ML Engineer", "Engineering", "New York"], ["Recruiter", "People", null]]);
  });

  it("Workable: department (string or list) and city/state/country, or the first of locations", () => {
    const jobs = parseWorkable({ jobs: [
      { shortcode: "AB1", title: "Data Analyst", url: "u", department: "Data", city: "London", country: "United Kingdom" },
      { shortcode: "AB2", title: "QA", url: "u", department: ["Engineering"], locations: [{ city: "Berlin", region: "Berlin", country: "Germany" }] },
      { shortcode: "AB3", title: "Ops", url: "u" },
    ] }, "acme");
    expect(jobs.map((j) => [j.department, j.location])).toEqual([["Data", "London, United Kingdom"], ["Engineering", "Berlin, Germany"], [null, null]]);
  });

  it("long or messy labels fit the column", () => {
    const [j] = parseAshby({ jobs: [{ id: "1", title: "T", jobUrl: "u", department: `  Eng\n  ${"x".repeat(400)}` }] });
    expect(j.department!.length).toBe(255);
    expect(j.department!.startsWith("Eng x")).toBe(true);
  });
});
