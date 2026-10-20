# Golden set — batch 3 review sheet

Ten companies, researched by Claude from search-result summaries (pages could not be opened from the research sandbox). For each value: check the source, then mark it right, fix it, or set it to `unknown`. When a company is done, set `reviewed_by_human: true` in `eval/golden_set.json` (or tell Claude the corrections).

Confidence: **verified** = two independent direct-reporting sources agree · **likely** = one credible source · **unknown** = not scored.

## Port (`port-io`)

Website: https://www.port.io · hard cases: common_name, non_us, rebrand_domain_change

> 'Port' is about as generic as a company name gets; the domain moved from getport.io to port.io. HQ is reported as Tel Aviv by Israeli press and as New York by some directories. Founding year conflicts (Nov 2021 in Dealroom/StartupHub, 2022 in TechCrunch/Built In) — left unknown rather than guessed.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Tel Aviv | likely | https://www.calcalistech.com/ctechnews/article/r1vronkjt |
| country | Israel | verified | https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage |
| founded_year | 2022 | unknown | 2021 vs 2022 across sources. |
| founder | Zohar Einy (Co-Founder & CEO) | verified | https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage |
| founder | Yonatan Boguslavski (Co-Founder & CTO) | verified | https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage |
| round | Series A $18M · 2023-09, lead Team8 | verified | https://www.calcalistech.com/ctechnews/article/r1vronkjt · https://pulse2.com/port-18-million-funding/amp/ |
| round | Series B $35M · 2024-10-15, lead Accel | verified | https://getport.io/blog/port-raises-35m-for-its-end-to-end-internal-developer-portal · https://siliconangle.com/2024/10/15/developer-tooling-startup-port-sails-away-35m-funding/ |
| round | Series C $100M · 2025-12-11, lead General Atlantic, valuation $800M | verified | https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage · https://siliconangle.com/2025/12/11/port-nets-100m-turn-developer-portal-agentic-ai-hub/ |
| not scored | Seed $5M · 2022 | unknown | Implied ~$5M by the Series A total ($23M); one profile says $7M in Nov 2022. No primary announcement found. |

## Hailo (`hailo-ai`)

Website: https://hailo.ai · hard cases: common_name, non_us

> Name collision with the defunct UK taxi app Hailo (2011-2016). The 2024 round is an extension of the Series C, not a new letter.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Tel Aviv | likely | Reported as Tel Aviv-based; not separately confirmed in this pass. |
| country | Israel | verified | https://en.globes.co.il/en/article-israeli-edge-ai-chipmaker-hailo-raises-136m-1001387010 |
| founded_year | 2017 | verified | https://en.globes.co.il/en/article-israeli-edge-ai-chipmaker-hailo-raises-136m-1001387010 |
| founder | Orr Danon (Co-Founder & CEO) | verified | https://en.globes.co.il/en/article-israeli-edge-ai-chipmaker-hailo-raises-136m-1001387010 |
| founder | Avi Baum (Co-Founder & CTO) | verified | https://siliconangle.com/2024/04/02/hailo-raises-120m-debuts-first-chip-generative-ai-edge/ |
| founder | Hadar Zeitlin (Co-Founder & CBO) | likely | https://www.israelhayom.com/2021/10/12/ai-chipmaker-hailo-raises-136m-to-expand-edge-ai-solutions |
| round | Series B $60M · 2020-03 | verified | https://globalventuring.com/corporate/hailo-attracts-136m-in-series-c/?format=md · https://calcalistech.com/tags/Hailo |
| round | Series C $136M · 2021-10, lead Poalim Equity, valuation $1.13B | verified | https://en.globes.co.il/en/article-israeli-edge-ai-chipmaker-hailo-raises-136m-1001387010 · https://www.edge-ai-vision.com/2021/10/leading-ai-chipmaker-hailo-raises-136-million-to-expand-edge-ai-solutions-as-global-demand-surges/ |
| round | Series C Extension $120M · 2024-04-02, valuation $1.20B | verified | https://siliconangle.com/2024/04/02/hailo-raises-120m-debuts-first-chip-generative-ai-edge/ · https://www.sdxcentral.com/news/edge-ai-chip-company-hailo-raises-120m-launches-hailo-10-genai-accelerator/ |
| not scored | Seed/Series A $28M · 2018-2019 | unknown | ~$28M before the Series B by subtraction ($224M total after C); individual rounds not traced to primary sources. |

## Cyera (`cyera`)

Website: — (to fill in) · hard cases: non_us

> Like Wiz: founded and built in Israel, described as New York-based in its 2025-26 round coverage (one aggregator says San Francisco). Website deliberately left empty for the reviewer to confirm (cyera.io vs cyera.com) — a wrong anchor would mis-test the pipeline.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | New York | likely | https://www.securityweek.com/cyera-raises-400-million-at-9-billion-valuation/ |
| country | United States | likely | https://www.securityweek.com/cyera-raises-400-million-at-9-billion-valuation/ |
| founded_year | 2021 | verified | https://en.globes.co.il/en/article-1001512567 |
| founder | Yotam Segev (Co-Founder & CEO) | verified | https://en.globes.co.il/en/article-1001512567 |
| founder | Tamar Bar-Ilan (Co-Founder & CTO) | verified | https://en.globes.co.il/en/article-1001512567 |
| round | Series C $300M · 2024-04, valuation $1.40B | likely | https://en.globes.co.il/en/article-1001494562 |
| round | Series D $300M · 2024-11, lead Accel, valuation $3.00B | verified | https://en.globes.co.il/en/article-1001494562 · https://www.securityweek.com/cyera-raises-300-million-at-3-billion-valuation/ |
| round | Series E $540M · 2025-06, lead Georgian, valuation $6.00B | verified | https://en.globes.co.il/en/article-1001512567 · https://builtin.com/articles/cyera-raises-540m-series-e-20250617 |
| round | Series F $400M · 2026-01-08, lead Blackstone, valuation $9.00B | verified | https://www.securityweek.com/cyera-raises-400-million-at-9-billion-valuation/ · https://www.weil.com/articles/weil-advised-blackstone-in-400m-series-f-funding-for-cyera |
| not scored | Seed/Series A/B — · 2021-2023 | unknown | Early rounds not traced in this pass. |
| not scored | Series G $300M · 2026-06 | unknown | $300M at $12B per one aggregator (multiples.vc) only. |

## Cato Networks (`cato-networks`)

Website: https://www.catonetworks.com · hard cases: non_us

> Round letters conflict across coverage: the 2023 $238M round and the 2025 $359M round are both called 'Series G' by different outlets. ARR is stated by the company itself.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Tel Aviv | verified | https://en.globes.co.il/en/article-1001514443 |
| country | Israel | verified | https://en.globes.co.il/en/article-1001514443 |
| founded_year | 2015 | verified | https://fintech.global/2023/09/20/cato-networks-clinches-238m-investment-at-over-3bn-valuation/ |
| founder | Shlomo Kramer (Co-Founder & CEO) | verified | https://en.globes.co.il/en/article-1001514443 |
| founder | Gur Shatz (Co-Founder) | verified | https://en.globes.co.il/en/article-1001514443 |
| round | Series E $130M · 2020-11-17, valuation $1.00B | verified | https://techcrunch.com/2020/11/17/cato-network-snags-100m-series-e-on-1b-valuation-as-cloud-wide-area-networking-thrives/ · https://pulse2.com/cato-networks-130-million-funding-and-over-1-billion-valuation/amp/ |
| round | Series F $200M · 2021-10, lead Lightspeed Venture Partners, valuation $2.50B | likely | https://investing.com/news/stock-market-news/cato-networks-secures-238-million-funding-plans-2024-ipo-93CH-3178860 |
| round | Private round $238M · 2023-09-20, lead Lightspeed Venture Partners, valuation $3.00B | verified | https://fintech.global/2023/09/20/cato-networks-clinches-238m-investment-at-over-3bn-valuation/ · https://www.agbi.com/article/israeli-cybersecurity-startup-cato-networks-raises-238m/ |
| round | Series G $359M · 2025-06, lead Vitruvian Partners, valuation $4.80B | verified | https://en.globes.co.il/en/article-1001514443 · https://www.channele2e.com/brief/cato-networks-raises-359m-to-expand-ai-sase |
| not scored | Series A-D — · 2015-2019 | unknown | Early rounds not traced in this pass. |
| ARR | $350M as of 2025-12 | likely | https://www.bolsamania.com/nota-de-prensa_print/mercados/cato-networks-surpasses-350-million-arr-with-43-yoy-growth-in-2025--21809566.html |

## Upwind (`upwind-security`)

Website: https://www.upwind.io · hard cases: non_us

> Round labels conflict: the Dec 2024 $100M round is called Series B by Globes/Calcalist but Series A by JNS/BankInfoSecurity, and the company calls its Jan 2026 $250M round its Series B. A pipeline should not invent a letter.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | — | unknown | HQ not established in this pass. |
| country | Israel | likely | https://en.globes.co.il/en/article-1001495634 |
| founded_year | 2022 | verified | https://calcalistech.com/ctechnews/article/hkxgq11pwjl |
| founder | Amiram Shachar (Co-Founder & CEO) | verified | https://en.globes.co.il/en/article-1001495634 |
| founder | Liran Polak (Co-Founder) | likely | https://calcalistech.com/ctechnews/article/hkxgq11pwjl |
| founder | Lavi Ferdman (Co-Founder) | likely | https://calcalistech.com/ctechnews/article/hkxgq11pwjl |
| founder | Tal Zuri (Co-Founder) | likely | https://calcalistech.com/ctechnews/article/hkxgq11pwjl |
| round | Unknown $50M · 2023-09, valuation $300M | likely | https://fintech.global/2024/11/11/israeli-cloud-security-firm-upwind-seeks-100m-in-series-b-funding/ |
| round | Unknown $100M · 2024-12, lead Craft Ventures | verified | https://en.globes.co.il/en/article-1001495634 · https://www.bankinfosecurity.com/upwind-raises-100m-to-thwart-cloud-security-vulnerabilities-a-26953 |
| round | Series B $250M · 2026-01-29, lead Bessemer Venture Partners, valuation $1.50B | verified | https://www.securityweek.com/upwind-raises-250-million-at-1-5-billion-valuation/amp/ · https://en.globes.co.il/en/article-1001533016 |
| not scored | Seed $30M · 2022 | unknown | ~$30M implied by the $430M total; not traced. |

## Coralogix (`coralogix`)

Website: https://coralogix.com · hard cases: non_us

> Conflicts everywhere: HQ (Tel Aviv / Ramat Gan / California), founding year (2014 / 2015), co-founders (Calcalist names Yoni Farin as co-founder & CTO; Wikipedia names Guy Kroupp and Lior Redlus), and the CEO's surname spelling (Assaraf / Assaref). Only what agrees is scored.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | — | unknown | Tel Aviv vs Ramat Gan vs California. |
| country | — | unknown | Founded in Israel; Wikipedia lists a US HQ. |
| founded_year | 2014 | likely | https://www.calcalistech.com/ctechnews/article/h1tsdarqge |
| founder | Ariel Assaraf (Co-Founder & CEO) | verified | https://www.calcalistech.com/ctechnews/article/h1tsdarqge |
| round | Series D $142M · 2022, lead Advent International | verified | https://www.calcalistech.com/ctechnews/article/h1tsdarqge · https://en.globes.co.il/en/article-1001413941 |
| round | Series E $115M · 2025-06, lead NewView Capital, valuation $1.00B | verified | https://en.globes.co.il/en/article-1001513111 · https://fintech.global/2025/06/18/coralogix-raises-115m-to-scale-ai-observability-tools/ |
| not scored | Seed-Series C — · 2014-2021 | unknown | Not traced. |

## HiBob (`hibob`)

Website: https://www.hibob.com · hard cases: common_name, non_us

> The product is called 'Bob' — the common-name case. Founded in Tel Aviv, headquartered in London per its own site and Wikipedia; directories say Tel Aviv or New York.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | London | likely | https://www.hibob.com/about/ |
| country | United Kingdom | likely | https://www.hibob.com/about/ |
| founded_year | 2015 | verified | https://www.hibob.com/about/ |
| founder | Ronni Zehavi (Co-Founder & CEO) | verified | https://www.hibob.com/about/ |
| founder | Israel David (Co-Founder) | verified | https://en.wikipedia.org/wiki/HiBob |
| founder | Amit Knaani (Co-Founder) | verified | https://en.wikipedia.org/wiki/HiBob |
| founder | Andy Bellass (Co-Founder) | verified | https://en.wikipedia.org/wiki/HiBob |
| round | Series C $150M · 2021-10 | likely | https://techcrunch.com/2022/08/17/hr-startup-hibobs-valuation-surges-50-to-2-45b-on-a-150m-raise |
| round | Series D $150M · 2022-08-17, lead General Atlantic, valuation $2.45B | verified | https://techcrunch.com/2022/08/17/hr-startup-hibobs-valuation-surges-50-to-2-45b-on-a-150m-raise · https://www.peoplematters.in/news/funding-investment/hibob-raises-150-million-series-d-up-round-led-by-general-atlantic-34906 |
| not scored | Seed-Series B — · 2015-2020 | unknown | Not traced. |

## Aidoc (`aidoc`)

Website: https://www.aidoc.com · hard cases: non_us

> The July 2025 '$150M' is probably $110M equity plus a $40M credit line — a pipeline should not record debt as an equity round.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Tel Aviv | verified | https://www.timesofisrael.com/israels-aidoc-raises-110m-for-ai-tech-that-reads-imaging-scans/ |
| country | Israel | verified | https://www.timesofisrael.com/israels-aidoc-raises-110m-for-ai-tech-that-reads-imaging-scans/ |
| founded_year | 2016 | verified | https://www.mobihealthnews.com/news/aidoc-raises-110m-expand-ai-enabled-imaging-platform |
| founder | Elad Walach (Co-Founder & CEO) | verified | https://www.timesofisrael.com/israels-aidoc-raises-110m-for-ai-tech-that-reads-imaging-scans/ |
| founder | Guy Reiner (Co-Founder) | likely | https://www.timesofisrael.com/israels-aidoc-raises-110m-for-ai-tech-that-reads-imaging-scans/ |
| founder | Michael Braginsky (Co-Founder) | likely | https://www.timesofisrael.com/israels-aidoc-raises-110m-for-ai-tech-that-reads-imaging-scans/ |
| round | Series D $110M · 2022-06, lead TCV | verified | https://www.mobihealthnews.com/news/aidoc-raises-110m-expand-ai-enabled-imaging-platform · https://www.timesofisrael.com/israels-aidoc-raises-110m-for-ai-tech-that-reads-imaging-scans/ |
| not scored | Seed-Series C — · 2016-2021 | unknown | Not traced. |
| not scored | Series D-IV / 2025 raise $110M · 2025-07 | unknown | $150M reported = $110M equity + $40M credit line per CB Insights; no primary source. |

## Pagaya (`pagaya`)

Website: https://pagaya.com · hard cases: went_public, non_us

> Public since June 2022 (SPAC with EJF Acquisition Corp, Nasdaq: PGY). The pipeline should recognise it as public and not write it as a startup. HQ (New York vs Tel Aviv) not scored.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | — | unknown |  |
| country | — | unknown |  |
| founded_year | 2016 | verified | https://en.globes.co.il/en/article-1001419790 |
| public company | yes | verified | https://en.globes.co.il/en/article-pagaya-completes-spac-merger-at-85b-valuation-1001416009 |
| founder | Gal Krubiner (Co-Founder & CEO) | verified | https://en.globes.co.il/en/article-1001419790 |
| founder | Yahav Yulzari (Co-Founder) | verified | https://en.globes.co.il/en/article-1001419790 |
| founder | Avital Pardo (Co-Founder & CTO) | verified | https://en.globes.co.il/en/article-1001419790 |

## Oligo Security (`oligo-security`)

Website: https://www.oligo.security · hard cases: non_us, common_name

> Early rounds reported two ways: a $28M 'split seed/Series A', or an $8M seed then a $20M Series A nine months later. Small enough that Hebrew/Israeli press is most of the coverage.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Tel Aviv | likely | https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
| country | Israel | verified | https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
| founded_year | 2022 | likely | https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
| founder | Nadav Czerninski (Co-Founder & CEO) | likely | https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
| founder | Gal Elbaz (Co-Founder & CTO) | likely | https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
| founder | Avshalom Hilu (Co-Founder & CPO) | likely | https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
| round | Seed $8M · no date | likely | https://www.calcalistech.com/ctechnews/article/hkrrovctj |
| round | Series A $20M · no date | likely | https://www.calcalistech.com/ctechnews/article/hkrrovctj |
| round | Series B $50M · 2025, lead Greenfield Partners | verified | https://www.bankinfosecurity.com/oligo-security-raises-50m-to-tackle-app-detection-response-a-27420 · https://archive.israel21c.org/israeli-startup-raises-50m-to-stop-app-based-cyberattacks/ |
