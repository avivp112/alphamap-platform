# Company registers — design (owner, round 10; in parallel, does not block a wet run)

## Data model (additive columns, a migration; never replaces what the website says)
| Column | Meaning | Not the same as |
|---|---|---|
| `registered_address` | the address the register holds | `hq_city` / `hq_country` |
| `legal_name` | the legal entity's name | `name` |
| `incorporation_date` | the earliest date among the sources of the same company | `founded_year` |
| `incorporation_jurisdiction` | the register's country / state | `founding_country`, `hq_country` |
| `company_number` | the register's id | |

Each carries its `field_provenance` row (source address of the register entry, quote, run id).

## Rules
1. A register never overwrites a headquarters found on the company's own website; its address is an office unless it is the only address found and the country agrees with a second piece of evidence (domain country, site language, an article).
2. Incorporation date ≠ founding year when the company re-incorporated (a Delaware parent of an Israeli company). With several dates the earliest among sources of the same company wins; a register of a foreign country does not decide alone.
3. A register entry is matched to the company by name AND country AND a second signal (website domain on the entry, or the same address as the site); a namesake is not matched.

## Order
1. Companies House (UK): incorporation date, registered address, officers, average number of employees (accounts) → a `registry` headcount point.
2. Israel's companies register (already connected).
3. KRS (Poland), CNPJ (Brazil; Receita Federal open data).
4. SEC EDGAR Form D (USA): amount sold, filing date → a round candidate with the filing as its source.
5. OpenCorporates, last: an aggregator of registers, used to find the entry, then the register's own page is the source.

## Steps
- A. Migration for the five columns + provenance (a day).
- B. One collector per register behind `lib/enrichment/registers/<name>.ts`, each returning `{ legal_name, company_number, incorporation_date, jurisdiction, registered_address, quote, url }`.
- C. The match rule (3) in one shared function, with namesake tests.
- D. Report lines `legal_name`, `registered_address`, `incorporation_date`; tracker fields opened by marks like every other field.
