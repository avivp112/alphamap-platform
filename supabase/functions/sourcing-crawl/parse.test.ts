import { describe, it, expect } from "vitest";
import { parseGreenhouse, parseLever, parseAshby, parseWorkable, parseComeet, comeetPage, scriptJson, departmentsByJobId } from "./parse";

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

describe("Comeet (the hosted careers page, as seen on comeet.com/jobs/sett/4A.00B)", () => {
  const page = `<html><script>
    var COMPANY_DATA = {"name": "Sett", "location": "Israel", "website": "https://www.sett.ai/", "company_uid": "4A.00B",
      "url_comeet_hosted_page": "https://www.comeet.com/jobs/sett/4A.00B"};
    var COMPANY_POSITIONS_DATA = [
      {"uid": "75.474", "name": "Account Manager", "department": "Account Management",
       "location": {"name": "Tel Aviv Office", "country": "IL", "city": "Tel Aviv-Yafo"},
       "url_comeet_hosted_page": "https://www.comeet.com/jobs/sett/4A.00B/account-manager/75.474",
       "url_active_page": "https://www.sett.ai/careers/account-manager/75.474/",
       "details": [{"name": "Description", "value": "<p>We say \\"hi\\" [sometimes] {braces}</p>"}],
       "time_updated": "2026-10-22T11:52:29Z", "company_name": "Sett"},
      {"uid": "53.F66", "name": "AI Fullstack Engineer", "department": "Engineering",
       "location": {"name": "Tel Aviv Office", "country": "IL", "city": "Tel Aviv-Yafo"},
       "url_active_page": "https://www.sett.ai/careers/ai-fullstack-engineer/53.F66/"}
    ];
    var POSITION_DATA = null;
  </script></html>`;

  it("reads the company and every position, brackets inside strings included", () => {
    const p = comeetPage(page)!;
    expect(p.company).toEqual({ name: "Sett", website: "https://www.sett.ai/", uid: "4A.00B", hosted: "https://www.comeet.com/jobs/sett/4A.00B" });
    expect(parseComeet(p)).toEqual([
      { external_job_id: "75.474", title: "Account Manager", url: "https://www.comeet.com/jobs/sett/4A.00B/account-manager/75.474",
        department: "Account Management", location: "Tel Aviv-Yafo, IL" },
      { external_job_id: "53.F66", title: "AI Fullstack Engineer", url: "https://www.sett.ai/careers/ai-fullstack-engineer/53.F66/",
        department: "Engineering", location: "Tel Aviv-Yafo, IL" },
    ]);
  });

  it("a page WITHOUT the positions data is a failed read (null), never an empty board", () => {
    expect(comeetPage("<html>Access denied</html>")).toBeNull();
    expect(comeetPage("<script>COMPANY_POSITIONS_DATA = [ {broken</script>")).toBeNull();
    // a board with no open positions is an empty list, not a failure
    expect(comeetPage("<script>COMPANY_POSITIONS_DATA = [];</script>")?.positions).toEqual([]);
  });

  it("scriptJson reads one assignment", () => {
    expect(scriptJson('x; FOO = {"a": "}"}; BAR = [1]', "FOO")).toEqual({ a: "}" });
    expect(scriptJson("BAR = [1, 2]", "BAR")).toEqual([1, 2]);
    expect(scriptJson("nothing here", "BAR")).toBeNull();
  });
});
