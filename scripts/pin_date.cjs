/**
 * scripts/pin_date.cjs — a replay of recordings made on another day (owner, 2026-11-20). Requests that carry today's date in their text (model prompts, searches) change at midnight, so after midnight
 * every replay misses its recordings, calls the model live and drifts (the regression gate of batches 5–7 lost 6 values and cost $0.20 on the day after the recordings, with the same code).
 * Pins the clock of the process to PIN_DATE (YYYY-MM-DD) at 08:00 UTC; it then runs on from there, so durations and ordering stay real. Not used in a live run.
 *   NODE_OPTIONS="--require $PWD/scripts/pin_date.cjs" PIN_DATE=2026-11-19 npx tsx scripts/regression.ts
 * Children of the run inherit NODE_OPTIONS, so the gate's own runs are pinned as well.
 */
const pin = process.env.PIN_DATE;
if (pin && /^\d{4}-\d{2}-\d{2}$/.test(pin)) {
  const RealDate = Date, start = RealDate.now(), fixed = RealDate.parse(`${pin}T08:00:00Z`);
  const now = () => fixed + (RealDate.now() - start);
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  globalThis.Date = PinnedDate;
}
