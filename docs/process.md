# The batch process (owner's update, 2026-11-19)

Goal: stop the repeated runs. Each batch gets **one dry run, one sample check, one write.**

```
regression gate  →  one dry run  →  sample + check  →  write
```

A second dry run only when the infrastructure failed (rate limit, cache, git) — never because of errors in the data.

## 1. The regression gate — `scripts/regression.ts`
- Runs every batch already written (`baseline/batches.json`: 5, 6, 7 and every batch written from now on, added by its own wet run) again with `REPLAY=1 DRY_RUN=true`, from the recordings and the cache: no search, no fetch, the memory off, and the database's own values left out (a clean slate, `REGRESSION=1`).
- Compares with `baseline/batch_<N>.json` (the good values `company:field:value` and the acceptance results). **Fails** when (a) an acceptance check is an ERROR, or (b) a value that was good is rejected now. Every loss is printed with its `reason_code`; the new values are printed apart; a single-valued field (description, sector, hq_*, founded_year…) that has *another* value now is listed as "changed", not as a failure.
- Cost: a model call a fix made new (a prompt changed) runs live for the values of these batches only; the cost is printed (aim: under $0.10 a run).
- On a pass it writes `regression_pass_<commit>.json`. **`bulk_enrich_v2.ts` with `DRY_RUN=false` refuses to run without a pass for the code it runs on** (the commit's own file, or a file of any commit whose code — all tracked files except `baseline/` — is the same, so a merge commit does not ask for a new run).
- The baseline is changed only by an explicit command with the values, after the owner approves: `APPROVED_BY=aviv npx tsx scripts/regression.ts accept-lost "Company:field:value" …`. `init` makes a first baseline from the code as it is; a batch's baseline can also come from the report that was written: `REPORT=pilot_report_write.csv npx tsx scripts/regression.ts init 7`.

```
npx tsx scripts/regression.ts                        # the gate
npx tsx scripts/regression.ts init 5 6 7             # the first baselines (once)
```

## 2. No re-run of a batch for a few data errors
- A wrong value found in the check is excluded **by content** (`company:field[:value]`), written to `pending_fixes.csv` with its reason, and everything else is written. A wet run reads `pending_fixes.csv` for its batch by itself.
- The rule's fix goes in before the next batch and passes the regression gate.
- Values already written and hurt are corrected in **one clean-up every three batches** (`undo_value`, then REPLAY) — not in every batch.

## 3. Acceptance per field
- Each field passes its own acceptance checks. A field that fails is the only one not written; every other field is. Held fields are listed in `held_fields.csv`.
- Every three batches one completion run writes the held fields, after their rules were fixed and passed the gate.

## 3b. Fields with no history — `field_track_record.json`
- `sample_verdicts.ts` adds every batch's checked values (per field: checked, wrong) to `field_track_record.json` (committed). `report_lint.ts` widens the next sample: a field with fewer than 15 checked values so far gets enough values of this batch to reach 15 (or all of them) on top of the five strata of ten.

## 4. Error threshold — `scripts/sample_verdicts.ts`
- Up to **5%** wrong values in a field in `sample_50.csv` is fine: the wrong ones are excluded and listed (`pending_fixes.csv`), the rest is written.
- Over 5% in a field: only that field is held (`held_fields.csv`).

```
BATCH=8 npx tsx scripts/sample_verdicts.ts                       # the sample, numbered
BATCH=8 WRONG=3,17=the reason npx tsx scripts/sample_verdicts.ts # the wrong numbers → pending_fixes.csv / held_fields.csv
```

## The order of a batch
1. `npx tsx scripts/regression.ts` — must pass.
2. One live dry run (`ALL_FIELDS=true …`), acceptance + lint.
3. `sample_verdicts.ts` (and `rejected_review.ts` for the rejected sample) — one pass.
4. The wet run (`REPLAY=1`): it reads `pending_fixes.csv` and `held_fields.csv` for the batch, checks the database against the report, and undoes itself on any difference; when it succeeds the batch joins the gate.
