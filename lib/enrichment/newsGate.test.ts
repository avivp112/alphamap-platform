import { describe, it, expect } from "vitest";
import { judgeNews, finishNews, type NewsItem } from "./newsGate";

// The 21 news items of the pilot dry run of 2026-11-09 (pilot_dry3), as the report's path sees them: each goes through
// judgeNews, the survivors through finishNews — the same two calls collect.ts makes before the report is built.
const items: Array<[string, NewsItem, string?]> = [
  ["Appcharge", { title: "Appcharge Raises $58 Million in Series B Round Led by IVP to Scale Top Direct-to-Consumer Platform for Mobile Games", url: "https://www.businesswire.com/news/home/20250813210482/en/Appcharge-Raises-%2458-Million-in-Series-B", published_date: "2025-08-13" }],
  ["Appcharge", { title: "Appcharge raises $26M to help gaming apps cut out Apple and Google from virtual goods revenues", url: "https://techcrunch.com/2024/11/25/appcharge-raises-26m-to-help-gaming-apps/", published_date: "2024-11-25" }],
  ["Datatruck", { title: "Driving Profitability and Streamlining Fleet Operations: Datatruck Recognized as a Core Transportation Management Provider", url: "https://www.globenewswire.com/news-release/2026/10/21/3385717/0/en/driving-profitability.html", published_date: "2026-10-21" }],
  ["Datatruck", { title: "Datatruck Raises $12M Led by Avenue Growth Partners to Build the AI-Native Operating System for Long-Haul Trucking", url: "https://www.prnewswire.com/news-releases/datatruck-raises-12m-led-by-avenue-growth-partners", published_date: "2026-01-28" }],
  ["Datatruck", { title: "Datatruck raises $12M to build the AI-native operating system for long-haul", url: "https://www.freightwaves.com/news/datatruck-raises-12m-to-build-the-ai-native-operating-system-for-long-haul" }],
  ["Empxtrack", { title: "Thriveni Expands Partnership with Empxtrack", url: "https://empxtrack.com/news/thriveni-expands-partnership-empxtrack/" }],
  ["Empxtrack", { title: "Empxtrack Reveals HR Trends 2022", url: "https://empxtrack.com/news/empxtrack-reveals-hr-trends-2022/" }],
  ["Empxtrack", { title: "Tushar Bhatia CEO Empxtrack Visits US to Discuss New HR Software Model", url: "https://empxtrack.com/news/discuss-hr-software-with-united-states-organizations/" }],
  ["Empxtrack", { title: "EmpXtrack Continues To Grow In The US Market", url: "https://www.newswire.com/news/empxtrack-continues-to-grow-in-the-us-market-8217" }],
  ["HeyGen", { title: "Ryan Serhant Partners with HeyGen to Turn His Own Face and Voice Into a Daily Content Engine", url: "https://www.prnewswire.com/news-releases/ryan-serhant-partners-with-heygen", published_date: "2026-10-08" }],
  ["HeyGen", { title: "HeyGen Surpasses $200M ARR as AI Video Adoption Accelerates", url: "https://www.heygen.com/blog/heygen-surpasses-200m-arr", published_date: "2026-06-25" }],
  ["HeyGen", { title: "HeyGen Doubles to $200M ARR in Eight Months on the Rise of Identity-First AI Video", url: "https://www.businesswire.com/news/home/20260625305891/en/HeyGen-Doubles-to-%24200M-ARR", published_date: "2026-06-25" }],
  ["HeyGen", { title: "HeyGen Launches AI Studio, a Next-Generation AI Video Editor", url: "https://www.businesswire.com/news/home/20250603867425/en/HeyGen-Launches-AI-Studio", published_date: "2025-06-03" }],
  ["HeyGen", { title: "AI Video Startup HeyGen Valued at $500 Million in Funding Round", url: "https://www.bloomberg.com/news/articles/2024-06-20/ai-video-startup-heygen-valued-at-500-million-in-funding-round", published_date: "2024-06-20" },
    "HeyGen has raised $60 million in a funding round that values the company at $500 million, led by Benchmark."],
  ["HeyGen", { title: "Zenarate and HeyGen Deepen Strategic Partnership to Bring Lifelike AI Avatars to Enterprise Simulation and Coaching", url: "https://www.prnewswire.com/news-releases/zenarate-and-heygen-deepen-strategic-partnership" }],
  ["HeyGen", { title: "HeyGen Secures $60M Series A to Power AI Video", url: "https://www.heygen.com/blog/announcing-our-series-a" }, "HeyGen today announced a $60M Series A."],
  ["Swan", { title: "Owen Selects Assurant to Enable Embedded Protection for Swan's Next-Generation Business Cards", url: "https://www.businesswire.com/news/home/20260603739999/en/Owen-Selects-Assurant", published_date: "2026-06-03" },
    "Owen, a provider of embedded insurance, today announced it has selected Assurant to underwrite protection for business cards issued through its partner platforms."],
  ["Swan", { title: "Paris-based Swan raises €37 million Series B to fuel Banking-as-a-Service across Europe", url: "https://www.eu-startups.com/2023/09/paris-based-swan-raises-e37-million-series-b-to-fuel-banking-as-a-service-across-europe/", published_date: "2023-09-01" }],
  ["Swan", { title: "Swan secures €42M to lead Embedded Banking in Europe", url: "https://www.swan.io/blog-posts/swan-secures-eu42m-to-lead-embedded-banking-in-europe" }],
  ["Datatruck", { title: "IT Park Ventures: The First Venture Investments in Uzbekistan's Startups", url: "https://www.it-park.uz/en/itpark/news/it-park-ventures" }],
  ["Appcharge", { title: "Epic v. Google: The Settlement Is Off the Table, and That Is Good for Developers", url: "https://www.appcharge.com/blog/epic-v-google-the-settlement-is-off-the-table" }],
];

async function run(name: string) {
  const mine = items.filter(([c]) => c === name);
  const contentOf = new Map(mine.map(([, n, c]) => [n.url, c]));
  const deps = {
    companyName: name, about: "software",
    content: (u: string) => contentOf.get(u),
    isOwnSite: (u: string) => u.includes("heygen.com") || u.includes("empxtrack.com") || u.includes("swan.io") || u.includes("appcharge.com"),
    fetchHtml: async () => null, // the pages carry no date in their code
  };
  const kept: NewsItem[] = [];
  for (const [, n] of mine) { const v = await judgeNews(n, deps); if (v.keep) kept.push(v.item); }
  return finishNews(kept, deps).kept.map((x) => x.url);
}

describe("the pilot report's news path on the real dry-run items (owner, 2026-11-09)", () => {
  it("Empxtrack: nothing undated is written", async () => { expect(await run("Empxtrack")).toEqual([]); });
  it("HeyGen: no undated item, one row for the $200M ARR news, one for the $60M round (Bloomberg over the company's blog)", async () => {
    const urls = await run("HeyGen");
    expect(urls).toHaveLength(4);
    expect(urls).toContain("https://www.businesswire.com/news/home/20260625305891/en/HeyGen-Doubles-to-%24200M-ARR");
    expect(urls).not.toContain("https://www.heygen.com/blog/heygen-surpasses-200m-arr");
    expect(urls).toContain("https://www.bloomberg.com/news/articles/2024-06-20/ai-video-startup-heygen-valued-at-500-million-in-funding-round");
    expect(urls.some((u) => u.includes("announcing-our-series-a") || u.includes("zenarate"))).toBe(false);
  });
  it("Datatruck: the $12M raise once (the dated release), no undated copy, nothing about Uzbekistan", async () => {
    const urls = await run("Datatruck");
    expect(urls).toEqual(["https://www.globenewswire.com/news-release/2026/10/21/3385717/0/en/driving-profitability.html", "https://www.prnewswire.com/news-releases/datatruck-raises-12m-led-by-avenue-growth-partners"]);
  });
  it("Swan: Owen's news that names Swan in a possessive is not Swan's; the undated blog post is out", async () => {
    expect(await run("Swan")).toEqual(["https://www.eu-startups.com/2023/09/paris-based-swan-raises-e37-million-series-b-to-fuel-banking-as-a-service-across-europe/"]);
  });
  it("Appcharge: both raises stay, the blog post about Epic v. Google does not", async () => {
    expect((await run("Appcharge")).sort()).toEqual(["https://techcrunch.com/2024/11/25/appcharge-raises-26m-to-help-gaming-apps/", "https://www.businesswire.com/news/home/20250813210482/en/Appcharge-Raises-%2458-Million-in-Series-B"]);
  });
  it("a date found in the page's code rescues an item (Datatruck's FreightWaves copy is then a twin of the release)", async () => {
    const v = await judgeNews(items[4][1], { companyName: "Datatruck", about: "trucking software", content: () => undefined, isOwnSite: () => false, fetchHtml: async () => '<meta property="article:published_time" content="2026-01-28T10:00:00Z">' });
    expect(v.keep && v.item.published_date).toBe("2026-01-28");
  });
});

describe("wet batch 1 (owner, 2026-11-09) through the gate", () => {
  const base = { companyName: "Datatruck", about: "trucking software", content: () => undefined as string | undefined, isOwnSite: () => false };
  it("Datatruck w1.3: the headline cut at the colon is completed from the page", async () => {
    const v = await judgeNews({ title: "Driving Profitability and Streamlining Fleet Operations:", url: "https://www.globenewswire.com/news-release/2026/10/21/3385717/0/en/x.html" }, { ...base, fetchHtml: async () => '<meta property="og:title" content="Driving Profitability and Streamlining Fleet Operations: Datatruck Recognized as a Core Transportation Management Provider | GlobeNewswire">' });
    expect(v.keep && v.item.title).toBe("Driving Profitability and Streamlining Fleet Operations: Datatruck Recognized as a Core Transportation Management Provider");
  });
  it("a cut headline the page cannot complete is not written", async () => {
    const v = await judgeNews({ title: "Driving Profitability and Streamlining Fleet Operations:", url: "https://www.globenewswire.com/news-release/2026/10/21/3385717/0/en/x.html" }, { ...base, fetchHtml: async () => null });
    expect(v.keep).toBe(false);
  });
  it("Appcharge w1.1: a personal post on the company's blog is not news", async () => {
    const v = await judgeNews({ title: "Appcharge Blog | Full Circle: Why I Joined Appcharge", url: "https://www.appcharge.com/blog/full-circle-why-i-joined-appcharge", published_date: "2026-11-02" },
      { ...base, companyName: "Appcharge", isOwnSite: () => true, fetchHtml: async () => null });
    expect(v.keep).toBe(false);
  });
  it("HeyGen w1.10: the distribution copy beats the company's blog", () => {
    const own = (u: string) => u.includes("heygen.com");
    const { kept } = finishNews([
      { title: "HeyGen Surpasses $200M ARR as AI Video Adoption Accelerates", url: "https://www.heygen.com/blog/heygen-surpasses-200m-arr", published_date: "2026-06-25" },
      { title: "HeyGen Doubles to $200M ARR in Eight Months", url: "https://www.businesswire.com/news/home/20260625305891/en/x", published_date: "2026-06-25" },
    ], { isOwnSite: own, content: () => undefined });
    expect(kept.map((x) => x.url)).toEqual(["https://www.businesswire.com/news/home/20260625305891/en/x"]);
  });
});
