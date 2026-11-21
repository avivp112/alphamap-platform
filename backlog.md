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
