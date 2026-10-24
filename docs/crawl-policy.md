# How AlphaMap reads job boards and company websites

Owner's decisions of 2026-10-24. Code: `supabase/functions/_shared/crawl-policy.ts`,
`worker/boards.ts`, `supabase/functions/sourcing-crawl`, `supabase/functions/discover-boards`.
Database: migration `20261102000000_crawl_policy.sql`.

## Rules for every fetch

1. **An honest User-Agent:** `AlphaMapBot/1.0 (+<the product's Vercel site>)` on every request (`crawlerUserAgent()`). There is no email, by the owner's decision.
2. **robots.txt first.** Before every request, the site's robots.txt is read once per run (once a day in the worker) and obeyed:
   - **A company's website that disallows us** is not read. No board is found or verified from it.
   - **A provider whose own data path is disallowed is switched off automatically.**
     - What it sets: `ats_providers.enabled = false`, along with the reason and the time.
     - What then stops: the provider's boards are not read or registered, and their roles are not shown.
     - **A person switches it back on** after looking at it: `update ats_providers set enabled = true, disabled_reason = null where provider = '…';`
   - **A robots.txt that cannot be read** (5xx or a timeout) means the fetch is skipped this time. Nothing is concluded and nothing is closed.
3. **Minimal storage:** only a role's title, link, department and location. Descriptions are read only to verify that a board is the company's, and are never stored.
4. **Comeet:**
   - **The hosted careers page only** (`comeet.com/jobs/{slug}/{uid}`), subject to the same automatic robots.txt check as every provider.
   - **The careers API, and any token, are never used.** Comeet gives that token to the company for its own site.

## Opt-out (take-down) requests

A company that asks us not to collect its jobs (through the product's site — the crawler carries no email) is blocked at once. Run in the SQL Editor:

```sql
select add_crawl_optout(p_domain => 'acme.com', p_note => 'email from …, 2026-11-02');
-- or by AlphaMap company:  p_startup_id => '…uuid…'
-- or one board:            p_provider => 'greenhouse', p_token => 'acme'
```

It records the request, blocks every board it covers (`sourcing_companies.crawl_blocked`), and **deletes their stored roles**. From then on:
- the company is not looked for by `discover-boards`;
- its website is not read;
- nothing of it is registered or crawled;
- its profile shows no hiring section.

The list is in `crawl_optouts`.

## Providers and their legal review

| Provider | Read | Legal status | Notes |
|---|---|---|---|
| SmartRecruiters | yes | approved by owner | The Posting API is documented as public, with no authentication. |
| Recruitee | yes | **legal review before commercial launch** | The Careers Site API is documented as needing no authorisation. Recruitee's 2022 API terms limit bulk copying. |
| Personio | yes | **legal review before commercial launch** | A public XML feed, switched on by the employer for its own site. Redistribution is not addressed. |
| Teamtailor | yes | **legal review before commercial launch** | A public `jobs.json` feed. No official terms were found. |
| Comeet | hosted page only | robots.txt checked automatically | The careers API and tokens are never used. |
| Greenhouse, Lever, Ashby, Workable | yes | **legal review before commercial launch** | Public job-board APIs, in use since before this policy. Added to the list on 2026-10-24. |

The status per provider is kept in `ats_providers.legal_status`.
