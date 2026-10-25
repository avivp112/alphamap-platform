# Golden set — batch 4 review sheet

Ten companies, researched by Claude from search-result summaries (pages could not be opened from the research sandbox). For each value: check the source, then mark it right, fix it, or set it to `unknown`. When a company is done, set `reviewed_by_human: true` in `eval/golden_set.json` (or tell Claude the corrections).

Confidence: **verified** = two independent direct-reporting sources agree · **likely** = one credible source · **unknown** = not scored.

Rounds announced in euros are scored in dollars, converted at the announcement month's rate (the euro figure is in the notes); the eval allows ±10%.

## Black Forest Labs (`black-forest-labs`)

Website: https://bfl.ai · hard cases: non_us

> Founded in 2024 by the creators of Stable Diffusion (ex-Stability AI). Over $450M raised in about four rounds, but only the $31M first round and the $300M Series B were announced; the round in between is described as an unannounced a16z-led Series A. One directory places the company in Zürich; the press says Freiburg.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Freiburg | likely | https://sifted.eu/articles/black-forest-labs-300m-series-b |
| country | Germany | verified | https://sifted.eu/articles/black-forest-labs-300m-series-b |
| founded_year | 2024 | verified | https://www.deutsche-startups.de/2025/12/01/dealmonitor-black-forest-labs-unicorn/?amp=1 |
| founder | Robin Rombach (Co-Founder & CEO) | likely | https://www.deutsche-startups.de/2025/12/01/dealmonitor-black-forest-labs-unicorn/?amp=1 |
| founder | Patrick Esser (Co-Founder) | likely | https://www.deutsche-startups.de/2025/12/01/dealmonitor-black-forest-labs-unicorn/?amp=1 |
| founder | Andreas Blattmann (Co-Founder) | likely | https://www.deutsche-startups.de/2025/12/01/dealmonitor-black-forest-labs-unicorn/?amp=1 |
| round | Seed $31M · 2024-08, lead Andreessen Horowitz | likely | https://t3n.de/news/?p=1709702 — Reported as $31M (some say €28M) from a16z, General Catalyst, Mätch VC and angels. One later report calls the a16z-led round a Series A, so the letter is uncertain. |
| round | Series B $300M · 2025-12-01, lead AMP / Salesforce Ventures (co-leads), valuation $3.25B | verified | https://sifted.eu/articles/black-forest-labs-300m-series-b · https://pulse2.com/black-forest-labs-300-million-series-b-at-3-25-billion-valuation-raised-to-advance-frontier-visual-intelligence/amp/ |
| not scored | Series A — · 2025 | unknown | Unannounced a16z-led round between the seed and the Series B (Pulse 2.0); amount never disclosed. |

## Parloa (`parloa`)

Website: https://www.parloa.com · hard cases: non_us

> Berlin conversational-AI company. Founding year 2018 per the company and Vestbee; Dealroom says 2017. The Series A was $21M at first close and $27M after a second close.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Berlin | verified | https://techcrunch.com/2026/01/15/parloa-triples-its-valuation-in-8-months-to-3b-with-350m-raise |
| country | Germany | verified | https://techcrunch.com/2026/01/15/parloa-triples-its-valuation-in-8-months-to-3b-with-350m-raise |
| founded_year | 2018 | likely | https://www.vestbee.com/insights/articles/parloa-raises-350-m |
| founder | Malte Kosub (Co-Founder & CEO) | verified | https://techcrunch.com/2026/01/15/parloa-triples-its-valuation-in-8-months-to-3b-with-350m-raise |
| founder | Stefan Ostwald (Co-Founder & CTO) | verified | https://techcrunch.com/2026/01/15/parloa-triples-its-valuation-in-8-months-to-3b-with-350m-raise |
| round | Series A $21M · 2023, lead EQT Ventures | likely | https://www.parloa.com/?p=23798 — $21M first close; a second close took the Series A to $27M. Either figure should match within the pipeline's own dedup; scored against the first close. |
| round | Series B $66M · 2024-04, lead Altimeter Capital | verified | https://podwise.ai/episodes/1137683 · https://siliconcanals.com/?p=63417 |
| round | Series C $120M · 2025-05, lead Durable Capital Partners / Altimeter Capital / General Catalyst (co-leads), valuation $1.00B | verified | https://www.silicon.co.uk/press-release/parloa-raises-120m-series-c-to-reinvent-customer-service-with-agentic-ai · https://www.startbase.com/news/parloa-wird-unicorn-120-mio-us-dollar-finanzierungsrunde/ — Reuters dates it July 2025; most coverage May 2025. |
| round | Series D $350M · 2026-01-15, lead General Catalyst, valuation $3.00B | verified | https://techcrunch.com/2026/01/15/parloa-triples-its-valuation-in-8-months-to-3b-with-350m-raise · https://finance.yahoo.com/news/german-ai-startup-parloa-triples-135110599.html |
| not scored | Seed $4M · 2022-05 | unknown | Only aggregators (Seedtable) report a ~$4M seed; no primary announcement found. |

## Helsing (`helsing`)

Website: https://helsing.ai · hard cases: non_us

> Munich defence-AI company. All rounds were announced in euros except the 2026 Series E. The Series E lead is disputed (Dragoneer per Seedtable and Latham; Goldman Sachs Alternatives per Bloomberg); the company's own release names no lead.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Munich | verified | https://www.munich-startup.de/en/news/helsing-raises-450-million-euros-in-series-c |
| country | Germany | verified | https://www.munich-startup.de/en/news/helsing-raises-450-million-euros-in-series-c |
| founded_year | 2021 | verified | https://en.wikipedia.org/wiki/Helsing_(company) |
| founder | Torsten Reil (Co-Founder & Co-CEO) | verified | https://en.wikipedia.org/wiki/Helsing_(company) |
| founder | Gundbert Scherf (Co-Founder & Co-CEO) | verified | https://en.wikipedia.org/wiki/Helsing_(company) |
| founder | Niklas Köhler (Co-Founder & President) | verified | https://en.wikipedia.org/wiki/Helsing_(company) |
| round | Series A $116M · 2021-11, lead Prima Materia | verified | https://en.wikipedia.org/wiki/Helsing_(company) · https://tech.eu/2025/06/17/helsing-raises-600-million-elevating-valuation-to-eur12bn/ — €103M. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series B $223M · 2023-09, lead General Catalyst | verified | https://en.wikipedia.org/wiki/Helsing_(company) · https://siliconcanals.com/german-defence-ai-startup-helsing-secures-e450m/ — €209M. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series C $487M · 2024-07, lead General Catalyst | verified | https://www.munich-startup.de/en/news/helsing-raises-450-million-euros-in-series-c · https://siliconcanals.com/german-defence-ai-startup-helsing-secures-e450m/ — €450M; valuation reported ~€4.5B pre-money / €4.9B (Bloomberg), not scored. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series D $694M · 2025-06-17, lead Prima Materia, valuation $13.80B | verified | https://tech.eu/2025/06/17/helsing-raises-600-million-elevating-valuation-to-eur12bn/ · https://www.munich-startup.de/en/news/helsing-secures-additional-600-million-euros — €600M at ~€12B. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series E $1.80B · 2026-07-13, valuation $18.00B | verified | https://helsing.ai/newsroom/helsing-raises-1-8bn-in-series-e · https://thenextweb.com/news/helsing-1-8-billion-series-e-18-billion-valuation — Lead disputed (Dragoneer vs Goldman Sachs Alternatives); left null. |

## Sarvam AI (`sarvam-ai`)

Website: https://www.sarvam.ai · hard cases: non_us

> Bengaluru generative-AI company founded mid-2023 by the AI4Bharat founders. The December 2023 $41M is described by TechCrunch as spanning a seed and a Series A, by others as one Series A. A June 2026 Series B first close of $234M (of a $300M target) is reported by Indian press only.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Bengaluru | verified | https://techcrunch.com/2023/12/06/indias-sarvam-ai-raises-41-million-from-lightspeed-khosla-peak-xv |
| country | India | verified | https://techcrunch.com/2023/12/06/indias-sarvam-ai-raises-41-million-from-lightspeed-khosla-peak-xv |
| founded_year | 2023 | verified | https://inc42.com/?p=430515 |
| founder | Vivek Raghavan (Co-Founder) | verified | https://inc42.com/?p=430515 |
| founder | Pratyush Kumar (Co-Founder) | verified | https://inc42.com/?p=430515 |
| round | Series A $41M · 2023-12-07, lead Lightspeed | verified | https://sarvam.ai/blogs/announcing-series-a · https://techcrunch.com/2023/12/06/indias-sarvam-ai-raises-41-million-from-lightspeed-khosla-peak-xv — Company calls it its Series A; TechCrunch says the $41M spans seed + Series A. A pipeline writing one $41M round is correct; two rounds summing to $41M is a known ambiguity. |
| not scored | Series B $234M · 2026-06 | unknown | First close of a $300M Series B at $1.5B led by HCLTech/Bessemer, per exchange4media; not confirmed by the company in this pass. |

## Synthesia (`synthesia`)

Website: https://www.synthesia.io · hard cases: non_us

> London AI-video company. Series E lead is GV.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | London | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| country | United Kingdom | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| founded_year | 2017 | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| founder | Victor Riparbelli (Co-Founder & CEO) | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| founder | Steffen Tjerrild (Co-Founder) | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| founder | Lourdes Agapito (Co-Founder) | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| founder | Matthias Niessner (Co-Founder) | verified | https://en.wikipedia.org/wiki/Synthesia_(company) |
| round | Series A $12.5M · 2021-04-21, lead FirstMark Capital | verified | https://www.uclb.com/2021/04/21/synthesia-announces-12-5m-series-a-to-replace-cameras-with-code-and-scale-their-ai-video-generation-platform/ · https://globalventuring.com/university/synthesia-visualises-12-5m-series-a/?format=md |
| round | Series B $50M · 2021-12-08, lead Kleiner Perkins | verified | https://techcrunch.com/2021/12/08/synthesia-raises-50m-to-leverage-synthetic-avatars-for-corporate-training-and-more/embed |
| round | Series C $90M · 2023-06, lead Accel / NVentures (co-leads), valuation $1.00B | verified | https://www.ldv.co/blog/congratulations-to-synthesia-on-their-90m-series-c-led-by-accel-at-a-1b-valuation — One aggregator lists $180M for 2023; that is the 2025 Series D. |
| round | Series D $180M · 2025-01, lead NEA, valuation $2.10B | verified | https://www.verdict.co.uk/synthesia-180m-funding-for-ai/ · https://siliconcanals.com/london-unicorn-synthesia-secures-174-5m/ |
| round | Series E $200M · 2026-01-26, lead GV, valuation $4.00B | verified | https://www.uclb.com/2026/01/27/synthesia-increases-valuation-to-4bn-powering-the-uks-ai-ambition/ · https://www.lw.com/en/news/2026/01/latham-watkins-advises-synthesia-on-us200-million-series-e-and-secondary-transaction |
| not scored | Seed — · 2017-2020 | unknown | Seed-stage funding (LDV Capital, Seedcamp, MMC) not traced to a dated announcement. |

## Wayve (`wayve`)

Website: https://wayve.ai · hard cases: non_us

> London autonomous-driving company. Founded by Alex Kendall and Amar Shah; Shah left in 2020. The Series D (Feb 2026) has a further $300M milestone-based commitment from Uber on top of the $1.2B — the round is $1.2B, not $1.5B.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | London | verified | https://en.wikipedia.org/wiki/Wayve |
| country | United Kingdom | verified | https://en.wikipedia.org/wiki/Wayve |
| founded_year | 2017 | verified | https://en.wikipedia.org/wiki/Wayve |
| founder | Alex Kendall (Co-Founder & CEO) | verified | https://en.wikipedia.org/wiki/Wayve |
| founder | Amar Shah (Co-Founder) | verified | https://en.wikipedia.org/wiki/Wayve |
| round | Series A $20M · 2019-11, lead Eclipse Ventures | verified | https://www.intelligenttransport.com/?p=92462 · https://en.wikipedia.org/wiki/Wayve |
| round | Series B $200M · 2022-01, lead Eclipse Ventures | verified | https://pymnts.com/?p=1224834 · https://en.wikipedia.org/wiki/Wayve |
| round | Series C $1.05B · 2024-05-07, lead SoftBank Group | verified | https://sifted.eu/articles/wayve-1bn-raise-nvidia-microsoft-softbank-news · https://coverager.com/wayve-raises-1-05-billion/ |
| round | Series D $1.20B · 2026-02-25, lead Eclipse / Balderton / SoftBank Vision Fund 2 (co-leads), valuation $8.60B | verified | https://www.uktech.news/ai/wayve-series-d-20260225 · https://autotechinsight.spglobal.com/news/5286893/wayve-secures-12-billion-in-series-d-to-expand-autonomous-driving-ai-platform |
| not scored | Seed — · 2018 | unknown | Seed from Compound and Firstminute Capital; amount not traced. |

## Vercel (`vercel`)

Website: https://vercel.com · hard cases: rebrand_domain_change

> Founded as ZEIT (zeit.co), renamed Vercel (vercel.com) on 2020-04-21 together with its Series A announcement. Founding year conflicts: Wikipedia 2015, the company's own blog 'In 2016, we started'. Argentine founder, San Francisco HQ.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | San Francisco | verified | https://en.wikipedia.org/wiki/Vercel |
| country | United States | verified | https://en.wikipedia.org/wiki/Vercel |
| founded_year | — | unknown | 2015 (Wikipedia, timelines) vs 2016 (the company's own ZEIT-is-now-Vercel post). |
| founder | Guillermo Rauch (Founder & CEO) | verified | https://en.wikipedia.org/wiki/Vercel |
| round | Series A $21M · 2020-04-21, lead Accel / CRV (co-leads) | verified | https://vercel.com/blog/zeit-is-now-vercel · https://sdtimes.com/softwaredev/vercel-raises-21-million-to-transform-javascript-front-end-development |
| round | Series B $40M · 2020-12-16, lead GV | likely | https://www.alexanderjarvis.com/vercel-pitch-deck-to-raise-40m-series-b-round/ — One timeline dates it June 2020. |
| round | Series C $102M · 2021-06, lead Bedrock Capital, valuation $1.10B | likely | https://en.wikipedia.org/wiki/Vercel |
| round | Series D $150M · 2021-11, lead GGV Capital, valuation $2.50B | likely | https://news.crunchbase.com/cloud/vercels-cloud-web-applications-funding-valuation-accel/ |
| round | Series E $250M · 2024-05, lead Accel, valuation $3.25B | verified | https://www.nasdaq.com/articles/vercels-valuation-jumps-325b-after-250m-series-e · https://latamlist.com/argentine-unicorn-vercel-secures-250m-series-e/ |
| round | Series F $300M · 2025-09, lead Accel / GIC (co-leads), valuation $9.30B | verified | https://en.wikipedia.org/wiki/Vercel |

## Mistral AI (`mistral-ai`)

Website: https://mistral.ai · hard cases: non_us, common_name

> Paris. Every round announced in euros. 'Mistral' is also a wind, a French warship class and other companies.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Paris | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C |
| country | France | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C |
| founded_year | 2023 | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C |
| founder | Arthur Mensch (Co-Founder & CEO) | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C |
| founder | Guillaume Lample (Co-Founder) | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C |
| founder | Timothée Lacroix (Co-Founder) | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C |
| round | Seed $113M · 2023-06, lead Lightspeed Venture Partners | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C · https://www.longtermwiki.com/funding-rounds/mistral-ai-series-c — €105M. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series A $415M · 2023-12, lead Andreessen Horowitz | likely | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C — €385M. Lead per press at the time, not re-confirmed in this pass. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series B $640M · 2024-06, lead General Catalyst, valuation $6.20B | verified | https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C · https://www.longtermwiki.com/funding-rounds/mistral-ai-series-c — €600M. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |
| round | Series C $2.00B · 2025-09, lead ASML, valuation $13.70B | verified | https://sifted.eu/articles/mistral-confirms-series-c-asml · https://www.orrick.com/en/News/2025/09/Orrick-conseille-Mistral-AI-dans-le-cadre-de-sa-levee-de-fonds-en-Serie-C — €1.7B at €11.7B post-money; ASML put in €1.3B. Announced in euros; amount_usd converted at the rate of the announcement month (eval tolerance is ±10%). |

## eToro (`etoro`)

Website: https://www.etoro.com · hard cases: went_public, non_us

> Public on Nasdaq (ETOR) since 2025-05-14 after an earlier SPAC attempt was abandoned in 2022. Originally RetailFX. Headquarters given as Bnei Brak (current Wikipedia) or Tel Aviv (older coverage) — city not scored. The pipeline should mark it public.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | — | unknown | Bnei Brak (current Wikipedia) vs Tel Aviv (older coverage). |
| country | Israel | verified | https://en.wikipedia.org/wiki/EToro |
| founding_country | Israel | verified | https://en.wikipedia.org/wiki/EToro |
| founded_year | 2007 | verified | https://www.renaissancecapital.com/Profile/ETOR/eToro/IPO |
| public company | yes | verified | https://www.renaissancecapital.com/Profile/ETOR/eToro/IPO |
| founder | Yoni Assia (Co-Founder & CEO) | verified | https://en.wikipedia.org/wiki/EToro |
| founder | Ronen Assia (Co-Founder) | verified | https://en.wikipedia.org/wiki/EToro |
| founder | David Ring (Co-Founder) | verified | https://en.wikipedia.org/wiki/EToro |

## Klarna (`klarna`)

Website: https://www.klarna.com · hard cases: went_public, non_us

> Public on the NYSE (KLAR) since 2025-09-10. Long private funding history (2005-2022) deliberately not scored here; the test is that the pipeline recognises a listed company.

| Field | Value | Confidence | Source |
|---|---|---|---|
| city | Stockholm | verified | https://en.wikipedia.org/wiki/Klarna |
| country | Sweden | verified | https://en.wikipedia.org/wiki/Klarna |
| founding_country | Sweden | verified | https://en.wikipedia.org/wiki/Klarna |
| founded_year | 2005 | verified | https://en.wikipedia.org/wiki/Klarna |
| public company | yes | verified | https://fortune.com/2025/09/10/klarna-ipo-2025-stock-debut-nyse-shares-rise-15-percent-wall-street-investors |
| founder | Sebastian Siemiatkowski (Co-Founder & CEO) | verified | https://en.wikipedia.org/wiki/Klarna |
| founder | Niklas Adalberth (Co-Founder) | verified | https://en.wikipedia.org/wiki/Klarna |
| founder | Victor Jacobsson (Co-Founder) | verified | https://en.wikipedia.org/wiki/Klarna |
