-- =============================================================================
-- Migration: registrable_domain() must never return a bare public suffix
-- Created:   2026-07-26
-- Description:
--   FIXES A DEFECT THAT WOULD HAVE MERGED FIVE UNRELATED COMPANIES.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────
--   The tier-1 dry run against production proposed these groups:
--
--     co.kr   -> DeepBio, Spacebit, Timely AI
--     com.cn  -> Inventchip Technology, Flagchip, Innoscience, Tinychip
--
--   Seven companies, two "duplicates". None of them are related. The original
--   registrable_domain() carried a hand-written list of multi-part suffixes —
--   co.uk, com.au, co.jp, com.br and nine others — and anything not on it fell
--   through to the generic "last two labels" rule. So deepbio.co.kr reduced to
--   co.kr, and every Korean company in the corpus became the same company.
--
--   Caught by the dry run, which is the entire reason resolve_tier1() defaults
--   to p_dry_run => true. Had it defaulted the other way, the first invocation
--   would have destroyed five companies' rows and repointed their filings,
--   funding history and watchlist entries onto the wrong survivor.
--
-- ── THE TWO CHANGES ─────────────────────────────────────────────────────────
--   1. The suffix list is now substantially complete for the jurisdictions
--      this corpus actually contains — KR, CN, TW, HK, IN, SG, ID, TH, MY, VN,
--      TR, IL, BR, AR, MX, CO, ZA, NG, KE, AE, SA, RU, UA, PL, ES, GR, PT and
--      the anglophone set that was already there.
--
--   2. A FAIL-CLOSED backstop for everything still missing. A list can only
--      ever be incomplete, and the failure mode of an incomplete list is a
--      silent wrong merge — the worst outcome this system can produce. So if
--      the computed result is exactly <label>.<two-letter-cctld> and that first
--      label is a registry-level word (co, com, net, org, ac, gov, edu, or,
--      ne, go, gob, govt, ...), the function returns NULL rather than a value
--      it cannot vouch for.
--
--      NULL costs a missed match: the company simply is not grouped by domain.
--      A wrong value costs a destroyed company. Those are not comparable, and
--      the guard resolves every unknown case toward the recoverable one.
--
-- ── THIS INVALIDATES AN INDEX ───────────────────────────────────────────────
--   idx_startups_domain is a functional index ON registrable_domain(website).
--   Postgres does not know the function's results changed — that is precisely
--   what declaring it IMMUTABLE promises — so entries computed under the old
--   definition survive until the index is rebuilt. The REINDEX at the end is
--   mandatory, not hygiene: without it, queries using the index would return
--   rows grouped by the OLD, WRONG domain values.
--
--   (The same constraint is why the suffix list is hardcoded rather than held
--   in a table. Reading a table would make the function STABLE at best, and a
--   functional index requires IMMUTABLE.)
--
-- Rollback: supabase/rollback/20260726210000_registrable_domain_public_suffix_down.sql
-- Tests:    supabase/tests/entity_resolution.test.sql (registrable_domain section)
--
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION registrable_domain(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h       text;
  parts   text[];
  n       int;
  m       text;
  sld     text;
  tld     text;
  -- Registry-level second-level labels. Not company names — nobody registers
  -- "co.kr"; they register "something.co.kr".
  generic text[] := ARRAY[
    'co','com','net','org','ac','gov','govt','gob','edu','mil','int',
    'or','ne','go','re','pe','lg','hs','ms','sch','res','nic',
    'firm','gen','ind','nom','web','info','biz','ltd','plc','me','id','in','tm'
  ];
  multi   text[] := ARRAY[
    -- Anglophone
    'co.uk','org.uk','ac.uk','gov.uk','net.uk','sch.uk','ltd.uk','plc.uk','me.uk',
    'com.au','net.au','org.au','edu.au','gov.au','id.au','asn.au',
    'co.nz','net.nz','org.nz','ac.nz','govt.nz','geek.nz','school.nz',
    'co.za','org.za','net.za','ac.za','gov.za','web.za',
    'co.ke','or.ke','ne.ke','ac.ke','go.ke',
    -- Asia-Pacific. co.kr and com.cn are the two that caused the incident.
    'co.kr','or.kr','ne.kr','re.kr','pe.kr','go.kr','ac.kr','hs.kr','ms.kr','es.kr',
    'com.cn','net.cn','org.cn','gov.cn','edu.cn','ac.cn','mil.cn',
    'com.tw','net.tw','org.tw','edu.tw','gov.tw','idv.tw',
    'com.hk','net.hk','org.hk','edu.hk','gov.hk','idv.hk',
    'co.jp','or.jp','ne.jp','ac.jp','go.jp','lg.jp','ad.jp','ed.jp','gr.jp',
    'com.sg','net.sg','org.sg','edu.sg','gov.sg','per.sg',
    'co.in','net.in','org.in','firm.in','gen.in','ind.in','ac.in','edu.in','gov.in','res.in',
    'co.id','or.id','net.id','web.id','ac.id','go.id','sch.id','my.id','biz.id',
    'co.th','or.th','in.th','ac.th','go.th','net.th','mi.th',
    'com.my','net.my','org.my','edu.my','gov.my','mil.my',
    'com.vn','net.vn','org.vn','edu.vn','gov.vn','biz.vn','info.vn',
    'com.ph','net.ph','org.ph','edu.ph','gov.ph',
    'com.pk','net.pk','org.pk','edu.pk','gov.pk','biz.pk',
    'com.bd','net.bd','org.bd','edu.bd','gov.bd',
    'com.lk','net.lk','org.lk','edu.lk','gov.lk',
    'com.np','net.np','org.np','edu.np','gov.np',
    -- Middle East
    'co.il','org.il','net.il','ac.il','gov.il','muni.il','k12.il',
    'co.ae','net.ae','org.ae','ac.ae','gov.ae','sch.ae',
    'com.sa','net.sa','org.sa','edu.sa','gov.sa','med.sa',
    'com.tr','net.tr','org.tr','edu.tr','gov.tr','bel.tr','web.tr','gen.tr',
    'com.qa','net.qa','org.qa','edu.qa','gov.qa',
    'com.kw','net.kw','org.kw','edu.kw','gov.kw',
    'com.jo','net.jo','org.jo','edu.jo','gov.jo',
    'com.lb','net.lb','org.lb','edu.lb','gov.lb',
    'com.eg','net.eg','org.eg','edu.eg','gov.eg',
    -- Latin America
    'com.br','net.br','org.br','gov.br','edu.br','art.br','ind.br',
    'com.ar','net.ar','org.ar','gob.ar','edu.ar','int.ar',
    'com.mx','net.mx','org.mx','edu.mx','gob.mx',
    'com.co','net.co','org.co','edu.co','gov.co','nom.co',
    'com.pe','net.pe','org.pe','edu.pe','gob.pe','nom.pe',
    'com.cl','gob.cl','gov.cl',
    'com.uy','net.uy','org.uy','edu.uy','gub.uy',
    'com.ve','net.ve','org.ve','edu.ve','gob.ve',
    'com.ec','net.ec','org.ec','edu.ec','gob.ec','fin.ec',
    'com.bo','net.bo','org.bo','edu.bo','gob.bo',
    'com.gt','net.gt','org.gt','edu.gt','gob.gt',
    -- Europe / CIS
    'com.ru','net.ru','org.ru','edu.ru','ac.ru',
    'com.ua','net.ua','org.ua','edu.ua','gov.ua','in.ua','kiev.ua',
    'com.pl','net.pl','org.pl','edu.pl','gov.pl','biz.pl','info.pl','waw.pl',
    'com.es','org.es','nom.es','gob.es','edu.es',
    'com.gr','net.gr','org.gr','edu.gr','gov.gr',
    'com.pt','org.pt','edu.pt','gov.pt','int.pt',
    'com.cy','net.cy','org.cy','ac.cy','gov.cy',
    'com.mt','net.mt','org.mt','edu.mt','gov.mt',
    'com.hr','com.ro','com.by','com.ge','com.mk','com.al',
    'co.rs','org.rs','edu.rs','gov.rs',
    'gov.it','edu.it','gov.uk',
    -- North America / other
    'gc.ca','qc.ca','on.ca','ab.ca','bc.ca',
    'com.ng','net.ng','org.ng','edu.ng','gov.ng',
    'com.gh','com.tz','co.tz','co.ug','co.zm','co.mz','co.bw'
  ];
BEGIN
  h := lower(btrim(coalesce(p_url, '')));
  IF h = '' THEN RETURN NULL; END IF;

  h := regexp_replace(h, '^[a-z][a-z0-9+.-]*://', '');   -- scheme
  h := split_part(h, '/', 1);                            -- path
  h := split_part(h, '?', 1);
  h := split_part(h, '#', 1);
  h := split_part(h, '@', 2 - (CASE WHEN position('@' in h) > 0 THEN 0 ELSE 1 END)); -- userinfo
  h := split_part(h, ':', 1);                            -- port
  h := regexp_replace(h, '^www\.', '');
  h := regexp_replace(h, '\.+$', '');

  IF h = '' OR position('.' in h) = 0 THEN RETURN NULL; END IF;

  -- Known multi-part suffix: keep one more label than the suffix has.
  FOREACH m IN ARRAY multi LOOP
    IF h LIKE '%.' || m THEN
      parts := string_to_array(h, '.');
      n := array_length(parts, 1);
      IF n >= 3 THEN RETURN array_to_string(parts[n-2:n], '.'); END IF;
      RETURN h;
    END IF;
  END LOOP;

  parts := string_to_array(h, '.');
  n := array_length(parts, 1);
  IF n < 2 THEN RETURN NULL; END IF;

  IF n > 2 THEN
    h := array_to_string(parts[n-1:n], '.');
    parts := string_to_array(h, '.');
    n := 2;
  END IF;

  -- ── FAIL-CLOSED BACKSTOP ──────────────────────────────────────────────────
  -- Two labels left. If the first is a registry-level word and the second is a
  -- two-letter ccTLD, this is a public suffix that the list above does not
  -- know, NOT a company domain. Returning it would group every company under
  -- that ccTLD into one entity — the co.kr / com.cn incident.
  --
  -- NULL loses a match. A wrong value loses a company. Resolve toward the
  -- recoverable failure.
  sld := parts[1];
  tld := parts[2];
  IF length(tld) = 2 AND sld = ANY(generic) THEN
    RETURN NULL;
  END IF;

  RETURN h;
END;
$$;

COMMENT ON FUNCTION registrable_domain(text) IS
  'eTLD+1 for a URL. Knows the common multi-part public suffixes, and FAILS CLOSED (returns NULL) on an unrecognised <registry-label>.<cctld> rather than emitting a bare public suffix — which would group every company in that country as one entity. Must stay IMMUTABLE: idx_startups_domain is a functional index on it.';

-- ── Mandatory: the functional index holds values from the old definition ─────
-- IMMUTABLE tells Postgres the results cannot change, so it will not rebuild on
-- its own. Stale entries here mean lookups grouped by the wrong domain.
REINDEX INDEX idx_startups_domain;
