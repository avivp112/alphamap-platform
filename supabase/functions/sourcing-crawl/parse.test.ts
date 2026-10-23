import { describe, it, expect } from "vitest";
import { parseGreenhouse, parseLever, parseAshby, parseWorkable, parseComeet, comeetPage, scriptJson, departmentsByJobId,
  parseSmartRecruiters, smartRecruitersNext, parseTeamtailor, teamtailorWebsite, personioXml, parsePersonio, parseRecruitee } from "./parse";

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

describe("SmartRecruiters, Teamtailor, Personio, Recruitee (payloads as seen 2026-10-23)", () => {
  it("SmartRecruiters: posting -> public page jobs.smartrecruiters.com/{company}/{id}; paging", () => {
    const page = { offset: 0, limit: 100, totalFound: 230, content: [{ id: "744000157427223", name: "Engineering Team Lead SRE",
      company: { identifier: "smartrecruiters", name: "SmartRecruiters Inc" },
      location: { city: "Poland", region: "Remote", country: "pl", remote: true }, department: { id: "5408693", label: "Engineering" } }] };
    expect(parseSmartRecruiters(page, "smartrecruiters")).toEqual([{ external_job_id: "744000157427223", title: "Engineering Team Lead SRE",
      url: "https://jobs.smartrecruiters.com/smartrecruiters/744000157427223", department: "Engineering", location: "Poland, PL" }]);
    expect(smartRecruitersNext(page, "BoschGroup")).toBe("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100&offset=100");
    expect(smartRecruitersNext({ ...page, offset: 200 }, "x")).toBeNull();
  });

  it("Teamtailor: the JSON Feed's items; location and the company's website from schema.org", () => {
    const feed = { home_page_url: "https://career.teamtailor.com/jobs", items: [{ id: "4ff07fd5", title: "UK Account Executive - SMB",
      url: "https://career.teamtailor.com/jobs/8118064-uk-account-executive-smb", content_html: "<p>x</p>",
      _jobposting: { "@type": "JobPosting", hiringOrganization: { "@type": "Organization", name: "Teamtailor", sameAs: "https://www.teamtailor.com" },
        jobLocation: [{ address: { addressLocality: "London", addressCountry: "GB" } }] } }] };
    expect(parseTeamtailor(feed)).toEqual([{ external_job_id: "4ff07fd5", title: "UK Account Executive - SMB",
      url: "https://career.teamtailor.com/jobs/8118064-uk-account-executive-smb", department: null, location: "London, GB" }]);
    expect(teamtailorWebsite(feed)).toBe("https://www.teamtailor.com");
    expect(teamtailorWebsite({ items: [{ _jobposting: {} }] })).toBeNull();
  });

  it("Personio: the XML feed; roles link to the board (/job/{id} answered 404); not XML = a failed read", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<workzag-jobs>\n<position>\n<id>1834171</id>\n<subcompany>Personio SE &amp; Co. KG</subcompany>
      <office>Munich</office><additionalOffices><office>Berlin</office></additionalOffices><department>Product and Tech</department>
      <name>Staff Software Engineer, Data Platform</name><jobDescriptions><jobDescription><name>About</name><value><![CDATA[<p>Join Personio at personio.com</p>]]></value></jobDescription></jobDescriptions>
      <createdAt>2024-11-13T14:10:41+00:00</createdAt></position></workzag-jobs>`;
    const feed = personioXml(xml)!;
    expect(feed.positions[0]).toMatchObject({ id: "1834171", subcompany: "Personio SE & Co. KG", office: "Munich", department: "Product and Tech" });
    expect(feed.positions[0].description).toContain("personio.com");
    expect(parsePersonio(feed, "personio")).toEqual([{ external_job_id: "1834171", title: "Staff Software Engineer, Data Platform",
      url: "https://personio.jobs.personio.de/", department: "Product and Tech", location: "Munich" }]);
    expect(personioXml("<html>Not found</html>")).toBeNull();
    expect(personioXml("<workzag-jobs></workzag-jobs>")?.positions).toEqual([]);
  });

  it("Recruitee: offers with their careers_url; only published ones", () => {
    const offers = { offers: [
      { id: 2786257, title: "Kaufmann / Kauffrau für Einzelhandel in Vollzeit (m/w/d)", status: "published",
        careers_url: "https://watchvice.recruitee.com/o/kaufmann-kauffrau-fur-einzelhandel-in-vollzeit-mwd-7", department: null,
        location: "Bietigheim-Bissingen, Baden-Württemberg, Deutschland", city: "Bietigheim-Bissingen", country: "Deutschland" },
      { id: 1, title: "Draft", status: "draft", careers_url: "u" },
    ] };
    expect(parseRecruitee(offers)).toEqual([{ external_job_id: "2786257", title: "Kaufmann / Kauffrau für Einzelhandel in Vollzeit (m/w/d)",
      url: "https://watchvice.recruitee.com/o/kaufmann-kauffrau-fur-einzelhandel-in-vollzeit-mwd-7", department: null, location: "Bietigheim-Bissingen, Deutschland" }]);
  });
});
