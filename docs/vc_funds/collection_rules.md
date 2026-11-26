# Funds — what we collect, how, why and for whom (v2, 2026-11-26)

Approved by Aviv: two depths, non-VC institutions are not skipped, events with valid_from / valid_to. Nothing is written to the database before the open decisions are answered.

## 1. Customers and what each needs
| Customer | Question | Needs |
|---|---|---|
| Small funds (first) | How do I compare to my peers? Who will lead my portfolio's next round? | firm profile, peer sets, an investments table with role and source, computed metrics with n |
| Sales teams (first) | Which companies just raised, who backs them, who is "hot"? They care about the company; the fund is a signal | every institution that appears in rounds (minimal depth), role in the round, round date, "the backer closed a fund" |
| Larger funds, corporate growth teams (later) | peer intelligence, M&A / partnership targets | same data, wider coverage, CVC links |

Both first customers lean on the same table: **investments with a role and a source.**

## 2. Scope of entities
- **In:** VC, CVC, micro-VC, accelerator, PE, family office — institutions only. Non-VC institutions enter at **minimal depth** with the type marked; they are not skipped.
- **Out for now:** private individuals and angel networks / syndicates. Stage 0 marks them (`individual`, `angel_group`) and creates no entity. The name stays as written in the round; nothing in existing data is deleted.
  `individual` is set automatically only for a rarely-seen name that looks like a person and is not on Aviv's list; a frequent one stays `possible_individual` for the manual pass (firms named after people look like persons).
- **Identity** is by domain (the list's website), or full name + city. Never by name alone.

## 3. Two depths
| | Minimal | Full |
|---|---|---|
| Who | any institution seen in rounds | the 558 on Aviv's list that are also at the top of the rounds; then the rest of the list |
| Fields | name, domain, investor type, name key | everything below |
| Built when | right after stage 0 | after stage 0, in priority order (section 8) |

## 4. Fields — firm (full depth), by tier of source: the firm's own site → registry → press
| Field | Source | Rule | Why / for whom |
|---|---|---|---|
| investor_type | About page + Form ADV; decision saved | 6 types; out-of-scope listed for Aviv | the main filter for everyone; peer sets |
| description, thesis | About / Strategy | quote; the firm is the subject ("we", its name) | context; thesis-vs-behaviour gap |
| HQ, offices | contact page, Form ADV, registers | city + country, or "headquartered in"; latest dated statement wins | peers by geography |
| founded_year | About, registers, press | quote | peers |
| stages, sectors, geographies | Strategy / FAQ | only what the firm states; the same sector taxonomy as companies | peers; fit; thesis vs actual |
| check size | site, press | as written; weak | fit |
| AUM | Form ADV, site, press | as written + the source's date; latest wins | scale; never confused with a fund's size |
| partners | Team page | full name + title; only Partner / General / Managing / Founding counted; Venture Partner, Advisor, EIR, Operating Partner kept apart | who to talk to |
| partner background | Team page | former founder / operator, only as the page says | founders' interest |
| team size | Team page, Form ADV | only when the page is complete | scale |
| accepts pitches + url | site | a form or general address the firm publishes; no personal emails or phones | practical for founders |
| news | press | weak, last | — |

## 5. Fields — fund vehicle
Name + number; size **only** with "final close" / "closed" / "raised", or Form D total sold; `target_size` and `first_close` separately; vintage (Form D first sale); status; LPs only from public sources; performance (IRR / TVPI / DPI) only from official public-pension reports, always with as-of — never from press. For: peers by vintage; "fresh money" signal.

## 6. The investments table (the key table)
One row per (round, investor name). Raw name kept; linked to an institution when resolved. Individuals and angel networks get no row.
- **Role** — `lead` / `co_lead` / `participant` only from explicit words ("led by", "co-led", "with participation from") in a source that attributes the action to **that** investor; otherwise `unknown`. Every role has a `role_source`:
  - `verified_quote` — a source and a quote exist;
  - `legacy_unverified` — every lead that exists today (98.6% have no source). Moved into the table, **never counted in a metric, never shown as a fact**;
  - `none` — no role claimed.
- A portfolio page gives no date and no round: such a row has no `investment_date` and never enters pace metrics. Portfolio status active / exited only if the site separates them; otherwise `listed_in_portfolio` + scan date.
- Company match: domain, or full name + city; unclear → waitlist, never an assumed link.
- Debt is not a round (`capital_type`).

## 7. Role verification run (proposal — not run, needs approval)
**Goal:** turn `legacy_unverified` leads into `verified_quote` roles, or leave them `unknown`.
**Method (the same as company enrichment):** per round, read the round's own `source_url` first (free), then press and articles about the round (up to 8, `MAX_ARTICLES=8`); a model extracts, per investor, `lead` / `co_lead` / `participant` **with a verbatim quote** about that investor; the quote is verified against the page (translated first if not English); the sentence's subject must be that investor (rule 8: "Led by X with participation from Y and Z" yields three separate roles).
**Order:** (1) rounds from the last 12 months, (2) 12–24 months, each ordered by how often the round's investors appear in stage 0; older rounds later.
**Process:** dry run → sample → write, with the regression gate, the 5% error threshold per field, and a field held on its own.
**Cost and volume:** the number of rounds comes from Query C in `scripts/sql/vc_funds_stage0_names.sql`. Estimate: about $0.012 per round on Haiku (the v2 figure per company; an assumption until a 3-fund dry run measures it), search extra; e.g. 3,000 rounds ≈ $36 before search. I will give the real figure from Query C and a measured sample before any paid run.

## 8. Who gets full depth first
After stage 0: funds that are **both** on the list of 558 **and** near the top of the rounds. Frequent institutions that are not on the list go to an **addition queue** that is shown to Aviv — nothing is built for them until he approves.

## 9. Form D (fund filings) → firm
A filing has no website, so the match is in steps and one signal is only a candidate:
1. the fund name cleaned of "Fund III", "L.P." equals a firm name (signal `name`);
2. the filing's related persons appear **by full name** on the firm's team page (signal `related_persons`), or the filing's address equals an office of the firm (signal `address`).
`confirmed` needs the name plus one of the others; a single signal stays `candidate`. Stored in `fund_filing_links`; `vc_fund_filings.investor_id` (name-only, 0.4% linked) is not used. Note: the stored filings start 2026-06-01, so vintage history needs a Form D backfill (stage 3).

## 10. Events and history
`fund_events`: fund opened / closed, partner joined / left, new office, investment, exit, thesis changed, rebrand, merger, closure — each with a date, a source and a quote (`fund_provenance`, `entity_type='event'`). Every value has `valid_from` / `valid_to`; an old value is closed, never deleted. Provenance keeps `retrieved_at` and `match_method`.

## 11. Computed metrics (never collected) — each stored with n and coverage
Deals in the last 12 / 24 months and the trend; new vs follow-on; lead rate; mix by stage / sector / geography and the gap between thesis and behaviour; top co-investors; graduation rate (next round within 24 months); exits and closures (from company status); time to the next round; peer comparison by stage, geography, vintage. Below the minimum n a metric is not shown. A metric also carries the share of the firm's rounds the database knows: weak coverage = an estimate, not a fact.
Only `fund_investments_for_metrics` feeds them (verified roles, resolved institutions).

## 12. Products from this data
1. **Peer benchmark** for small funds (first).
2. **Backers of a company** for sales teams: who invested, who led (when verified), when, and whether the backer is active.
3. **"The investor closed a fund"** alert. A new fund goes mostly to **new investments**, not to follow-on in its existing portfolio — so this is a signal about the **investor** ("will invest now in new companies in sector X"), not about its portfolio companies. Needs the Form D link (section 9).
4. Later: active-investor finder, warm paths by co-investment.

## 13. Not collected
LinkedIn / Glassdoor scraping; paid databases; performance from press; fund size from "target" language; private emails, phones and addresses; angel individuals and networks; dry-powder estimates until fund size and deployed capital per fund are known.
