# Funds — what we collect and how (proposal for approval; starting from scratch)

The legacy `investors` table (558 rows, hand-collected, no sources) is used for ONE thing: the input list (`name`, `website`).
Every other legacy value is a hint to re-verify (`source_type=legacy`), never shown as verified. Known problems in it:
round-number AUM / portfolio sizes, `firm_type='vc'` on 100% (including CVCs and PE), 4 pairs of rows sharing a domain, no LATAM, US only 71 rows.

## Per firm — collected from the firm's own site first (tier 1), then registries, then press
| Field | Where | Rule |
|---|---|---|
| investor_type | gate over About page + Form ADV | 7 types; the decision is saved; out-of-scope types are skipped and listed for Aviv |
| description, thesis | About / Strategy page | quote required; the firm is the sentence's subject ("we", its name) |
| HQ, offices | contact page, Form ADV, registers | two parts (city + country) or an explicit "headquartered in"; latest dated statement wins |
| founded_year | About page, registers, press | quote required |
| stages, sectors, geography | Strategy / FAQ page | only what the firm states; otherwise empty |
| check size | site, press | as written; weak maturity |
| AUM | Form ADV, site, press | as written ("over $1B") + the source's date; latest date wins |
| partners | Team page | full name + title; only Partner / General / Managing / Founding Partner counted; Venture Partner, Advisor, EIR, Operating Partner kept apart |
| team size | Team page, Form ADV | count only when the page is complete |
| news | press | weak; last priority |

## Per fund (stage 3)
Name + number, size (`final close` / `closed` / `raised`, or Form D total sold only), `target_size` and `first_close` separately, vintage (Form D first sale), status raising/closed, LPs when published, performance (IRR/TVPI/DPI) only from official public-pension reports with an as-of date — never from press.

## Per investment (stage 4) — the key table
Firm or fund, startup (matched by domain, or full name + city; unclear → waitlist), round, role (`led by` / `co-led` / `with participation from`; otherwise Unknown), date, source + quote.
From the firm: the portfolio page (active vs exited only if the site separates them; logo-only pages via alt text / file name / link) and press releases.
From the company: rounds already in the database (the other side's announcement counts as evidence).

## Computed (stage 4+, never collected)
Deal pace, lead rate, mix by stage/sector/geography, graduation rate (next round within 24 months), exits/mortality, time to next round, peer comparison — each with the number of data points it rests on.

## Not collected
LinkedIn / Glassdoor scraping; paid databases; performance from press; fund size from "target" language.
