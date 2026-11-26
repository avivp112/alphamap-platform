# Follow-up list: companies a wet v2 run wrote that have no description or too little data

Owner request, 2026-11-16: keep the list, and bring it back in exactly two weeks (2026-11-30) to work through the companies one by one.

## Batch 5 (run bc1c528e, 2026-11-16)
Written by the wet run and still without a description in the database:

| Company | Note |
|---|---|
| Choiz | no description written |
| Medipass | no description written, although the dry report had one ("Tyro Health, formerly Medipass …"); find why it was not written |
| Conotoxia | no description written |

Not on the platform until a description is written (the Private Market lists a company with a v2 description, or with a description and completeness ≥ 7).

## The live list
`npx tsx scripts/followup_missing.ts` reads every wet v2 run from the database and prints every company it wrote that has no description or a completeness_score under 7, with its batch; it writes followup/missing_<date>.csv. Run it again at the follow-up date: it also covers batch 6 and later.
