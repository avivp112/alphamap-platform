# Backlog — findings after the batch-8 sample (owner, 2026-11-19: recorded here, not fixed before the write)

- Humi Series A $15M; Sunrise / 6DG entity; Kontent.ai index-page and cut headline; SAMCO two articles; Snupit eBook; `RETRY_FAILED` wiring.
- WebBank: a bank — written only after Aviv's decision (excluded from batch 8's wet run).
- Punkta (insurance broker, not technology?) and Vibe (technology undetermined): decisions open.
- Headcount point date from a live site: rule open (Aviv).
- Vaulta / Walley name collisions: need a concrete example.
- `acquired` field stays closed until 20 marks at ≥90%.
- Fields held only for "too few values" with 0 errors (company_number, legal_name, registered_address, acquired, …): confirm that this is wanted.
- Oiti Technologies: certiface.com.br blocks (403) — Aviv's list.
- Nordigen, Triskell, Multiable: dry run (`rerun_some`) result to check.

## Maintenance window after batch 10 (owner, 2026-11-19) — each item must pass the regression gate with 0 lost values
- (a) A date read from the page's code is rejected only when another source of the same event gives a date more than 7 days apart. With no contradicting source the date stays.
- (b) A tag whose quote is not the verified description: replace the quote with the verified description when the description supports the tag; delete only when it does not.
- (c) A role that is not in the quote: delete only the role, never the founder. In the gate, founders are compared by name.
- Reverted before the batch 8 write (gate failed with 45 lost values in batches 5-7): the three rules above in their strict form, and the lead-investor cue ("led by") of round 3, which lost Kontent.ai's and ShopX's lead.

## Method of 2026-11-20 (docs/process.md)
- New rules only in a maintenance window (every 4 batches) with Aviv's approval; a rule is aimed at a stated condition, not a global tightening.
- The application does not yet read `field_status` (pilot visibility): the table and the script exist.
- `sample_verdicts.ts`, `reason_marks.ts`, `import_marks.ts`, the old tracker scripts (`field_review*.ts`) belong to the old method and are not part of a batch.

## From batch 8 (2026-11-20)
- `acquired` was not written in batch 8 (0/26) although found for Weezy (Getir, 2021-11-23, CNBC) and Nordigen: in a wet run the news rows are not open, and `acquired` is derived from them.
- Zro: "Av. Brigadeiro Faria Lima" was read as Lima (Peru); it is an avenue in São Paulo.

## Cost reduction (maintenance window, not now — owner, 2026-11-21)
- Any change to which pages are read or which searches run must first pass a `REPLAY_FILL` run that completes the recordings of batches 5–8; only then compare in the gate. The news search stays on (round types and acquired come from it). The attempt of bd5bc10 (Tier 3 extraction off, 10 pages, deep dive for gaps only) lost 57 values in the gate and was reverted.
- Screaming Frog: Will Hodson came back.
- WebBank: must be excluded.
- Paid-for sources (Lendo): to be excluded.

## Founder exclusion (maintenance window, from batch 9 — owner, 2026-11-21)
- When a junk founder is excluded (Buildium / Monteiro, Nuro / Zhu and Ferguson, Travelier / Toister), the company's real founders must not be held back with it. The exclusion has to be by value, not by field.

## From the batch 9 audit (2026-11-23) — for the maintenance window; each must pass the gate
- A grant ("bags $2.5M grant from EC", MinerEye) and a contract ("$318M contract with the U.S. Department of War", Dataminr) are not funding rounds.
- A founder is declared only when the quote attributes the founding to our company: Usersnap's founders came from another blog quoted in a Usersnap post; CorPower's from Oscilla's SEC filing (a founder of another company, Oscilla); Bloom Security's name is not in its quote.
- A founder's title must match its quote (Deliverect: the quote says CTO and CPO, the value CPO and President).
- `acquired` is not written in a wet run (0/348 in batches 8 and 9): it is derived from the news rows, and in a wet run the news rows are not built because the news field is closed (Tier 3). Derive it from the news without writing the news. Found and not written: Buildium (RealPage), Weezy (Getir), Nordigen (GoCardless) and others in pilot_report_dry.csv.

## Added 2026-11-23 (decisions of the owner; not for now)
- Orb (batch 9): the dry report says "acquired by Adyen, 2026-06-11"; the database says active. Orb is one of the five strict-failed companies.
- `acquired` is written to the database (43 of 46 in batch 9; 45 of 46 identical to the reviewed dry report) and does not appear in the wet report: the report is not a full record of what was written. Find where the write takes the acquired value from.
- 75 companies of batch 9 have no HQ city and 73 no country (found for 40). Cause not known.
- The baselines of batches 5–7 hold what today's code extracts from the recordings, not what the wet runs wrote (Humi, Mintifi, Mastertrust, Ruya, Okra, Brighte, Estimote, Conotoxia, Sami, Six Degrees: no provenance row for the values). Missing values are filled by the separate run for missing fields, after the maintenance window.
- startups_search carries the 768-d `embedding` of startups (~25 MB), read by hybrid_lookalikes; leave it unless space needs it, and then change hybrid_lookalikes to read startups.embedding first.
- Travelier (batch 9 preview, 2026-11-24): `startups.founders` holds an entry named "<UNKNOWN>" with no title. Count how many companies have such an entry (`select count(*) from startups where founders::text ilike '%<UNKNOWN>%'`) and remove them in a maintenance window, with the owner's approval.

- (2026-11-23) LinkedIn links of founders and leaders: the component `linkedin_people` has been off since 2026-11-02 ("LinkedIn is never a source for any field"). Stage 2 asks for a link found by a Google search and written only when the result names the person in full and the company; not built. Decide before it is.
- (2026-11-23) Tavily is already a last resort (called only when Serper and Jina both failed); "only when the results are too few" is a different trigger and was not built.
- (2026-11-23) The fixed search "funding_round" was dropped as overlapping "raises" and "funding": if the gate loses a Tier 1 round because of it, put it back.
- (2026-11-24) Lendo, Series B $28M: the round now rests on einpresswire.com (paid distribution) and the acceptance check `no_paid_distribution` rejects it; the same event is on lendo.sa's own press release (`/en/press-releases/lendo-secures-28m-in-series-b-funding-led-by-sanabil-investments-gears-up-for-ipo`). When a round has several sources, prefer the company's own site over a paid-distribution page. Not built; maintenance window, with the gate.
- (2026-11-24) The old round values that read a figure in another currency as dollars (Weezy's £1M written as $1M) are wrong data in baselines 5–8; look for others when the baselines are rebuilt.

- (2026-11-24, owner) Mergers in the acquisition read: "Equativ and Sharethrough merge / operate under one brand" is not "acquired", so a purchase announced in that form is not found (Sharethrough: the 2025 merger articles are what the search returns now; the reviewed purchase, Equativ 2024-06-13, is kept in the database and is out of the acquired check with the note "search results unstable"). A merger rule is a new rule: only with the owner's approval, and only after examples from the logs.
- (2026-11-24, owner) Acquired values: every acquired value of a batch goes into the targeted audit sample (lib/enrichment/audit.ts). Three wrong purchases reached batch 9 (Aperio: another company of the same name; Phenom: the buyer, not the acquired; Rubicon Carbon: carbon credits bought, not the company). A stricter acceptance for acquisitions (the quote shows that OUR company, in the right direction, was bought) waits for the owner's approval after examples.
- (2026-11-24, owner) Domain-identity check: a domain that belongs to another company (Aperio: the database had aperio.com, the domain of Aperio Technologies, the digital pathology company Leica bought; our Aperio is aperio.ai) or that redirects to or describes another company → the company is flagged and not enriched. Today the name decides the site, and a wrong site makes every value of the company that of another one. Needs the owner's approval of the rule and examples from the logs before any code.
