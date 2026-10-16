// One posting per external_job_id, first occurrence wins.
//
// A board can list the same job twice — Workable's ?details=true payload
// repeats a shortcode per location (seen 2026-10-15 on workable/triptease).
// The upsert on (company_id, external_job_id) then carries two rows for one
// key and Postgres refuses the whole batch: "ON CONFLICT DO UPDATE command
// cannot affect row a second time", so none of that board's jobs were saved.
// Pure, so it is unit-tested under vitest.

export function uniqueByJobId<T extends { external_job_id: string }>(jobs: T[]): T[] {
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.external_job_id) ? false : (seen.add(j.external_job_id), true)));
}
