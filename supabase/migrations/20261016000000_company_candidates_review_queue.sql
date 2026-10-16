-- =============================================================================
-- Migration: company candidates — the engine proposes, an admin disposes
-- Created:   2026-10-16
-- Description:
--   Until now a government filing that matched no known company CREATED one
--   (ingest_gov_entity_filing's last step). From here on it creates a
--   CANDIDATE instead, and a company is created only when an admin approves
--   it. A filing about a company that already exists still links to it
--   directly — there is nothing to approve.
--
--   1. app_admins + is_app_admin(): the app had no admin concept. Seeded with
--      the owner's account.
--   2. company_candidates: one row per proposed company (per source and
--      registry key — CIK, Companies House number, or normalised applicant
--      name), with the quality gate's tier ('queue' = review only, 'alert' =
--      review + user alert, see _shared/company-gate.ts), the evidence an
--      admin needs to decide, and the review outcome. Visible to admins only.
--   3. raw_gov_filings gains gate_tier / gate_reasons / candidate_id, so every
--      record keeps what the gate decided and why.
--   4. ingest_gov_entity_filing(... p_gate jsonb): resolution unchanged; when
--      nothing resolves, a 'reject' verdict stores the filing alone, anything
--      else upserts a candidate. A caller that sends no verdict (an Edge
--      Function deployed before this) gets 'queue' — review only, never a
--      company and never an alert. The old signature is dropped so PostgREST
--      cannot pick between two overloads.
--   5. approve_company_candidate() / reject_company_candidate(): the only way
--      a candidate becomes a company, or is set aside for good. Admins (or the
--      service role) only. A rejected candidate stays rejected: later filings
--      link to it and it is never proposed again.
--
-- Rollback: supabase/rollback/20261016000000_company_candidates_review_queue_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. Admins ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_admins (
  user_id   uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;   -- no policies: read only through is_app_admin()
REVOKE ALL ON app_admins FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION is_app_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_app_admin() TO authenticated, service_role;

INSERT INTO app_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'avivp112@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── 2. Candidates ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_candidates (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text        NOT NULL,
  -- Registry identity within the source: CIK, Companies House number, or the
  -- normalised applicant name. Two filings of one company share it.
  candidate_key  text        NOT NULL,
  name           text        NOT NULL CHECK (btrim(name) <> ''),
  country        text,
  founded_year   integer,
  cik            text,
  entity_number  text,
  website        text,
  gate_tier      text        NOT NULL CHECK (gate_tier IN ('queue', 'alert')),
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- What the reviewer needs: codes, officers, industry, offering, title/abstract.
  evidence       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  filings_count  integer     NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  startup_id     uuid        REFERENCES startups (id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  reviewed_by    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  review_note    text,
  UNIQUE (source, candidate_key)
);
CREATE INDEX IF NOT EXISTS idx_company_candidates_queue ON company_candidates (status, first_seen_at DESC);

COMMENT ON TABLE company_candidates IS
  'Companies the sourcing engine proposes from government filings, awaiting an admin decision. A company enters startups only through approve_company_candidate(). gate_tier: queue = review only; alert = review + immediate user alert (_shared/company-gate.ts).';

ALTER TABLE company_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_candidates FROM PUBLIC, anon;
GRANT SELECT ON company_candidates TO authenticated;
DROP POLICY IF EXISTS company_candidates_admin_read ON company_candidates;
CREATE POLICY company_candidates_admin_read ON company_candidates
  FOR SELECT TO authenticated USING (is_app_admin());

-- ── 3. What the gate decided, on every filing ────────────────────────────────
ALTER TABLE raw_gov_filings
  ADD COLUMN IF NOT EXISTS gate_tier    text,
  ADD COLUMN IF NOT EXISTS gate_reasons text[],
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES company_candidates (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_candidate ON raw_gov_filings (candidate_id) WHERE candidate_id IS NOT NULL;

-- ── 4. Ingest: resolve, else propose ─────────────────────────────────────────
DROP FUNCTION IF EXISTS ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb);
DROP FUNCTION IF EXISTS ingest_gov_entity_filing(
  text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb,boolean,text);

CREATE OR REPLACE FUNCTION ingest_gov_entity_filing(
  p_source         text,
  p_accession      text,
  p_entity_name    text,
  p_filing_date    date,
  p_cik            text            DEFAULT NULL,
  p_entity_number  text            DEFAULT NULL,
  p_form_type      text            DEFAULT NULL,
  p_year_of_inc    integer         DEFAULT NULL,
  p_jurisdiction   text            DEFAULT NULL,
  p_country        text            DEFAULT NULL,
  p_industry_group text            DEFAULT NULL,
  p_codes          text[]          DEFAULT NULL,
  p_title          text            DEFAULT NULL,
  p_abstract       text            DEFAULT NULL,
  p_officers       jsonb           DEFAULT '[]'::jsonb,
  p_tech_summary   text            DEFAULT NULL,
  p_total_offering numeric         DEFAULT NULL,
  p_total_sold     numeric         DEFAULT NULL,
  p_raw            jsonb           DEFAULT NULL,
  p_unlinked       boolean         DEFAULT false,
  p_website        text            DEFAULT NULL,
  -- {"tier": "reject"|"queue"|"alert", "reasons": [...]} from _shared/company-gate.ts
  p_gate           jsonb           DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug              text;
  v_startup_id        uuid;
  v_candidate_id      uuid;
  v_year              integer;
  v_filing_id         uuid;
  v_domain            text;
  v_candidate_country text;
  v_tier              text;
  v_reasons           text[];
  v_key               text;
BEGIN
  IF p_entity_name IS NULL OR btrim(p_entity_name) = '' THEN
    RAISE EXCEPTION 'ingest_gov_entity_filing: entity_name is required';
  END IF;
  IF p_accession IS NULL OR btrim(p_accession) = '' THEN
    RAISE EXCEPTION 'ingest_gov_entity_filing: accession/document id is required (it is the dedupe key)';
  END IF;

  -- No verdict (an older caller) is review-only: never a company, never an alert.
  v_tier := coalesce(nullif(p_gate->>'tier', ''), 'queue');
  IF v_tier NOT IN ('reject', 'queue', 'alert') THEN
    RAISE EXCEPTION 'ingest_gov_entity_filing: unknown gate tier %', v_tier;
  END IF;
  v_reasons := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_gate->'reasons', '[]'::jsonb)));

  v_year := p_year_of_inc;
  IF v_year IS NOT NULL AND (v_year <= 1900 OR v_year > EXTRACT(YEAR FROM now())::integer) THEN
    v_year := NULL;
  END IF;

  IF NOT p_unlinked THEN
    v_slug := gov_company_slug(p_entity_name);

    -- ── Resolution to an EXISTING company (unchanged) ─────────────────────
    IF p_cik IS NOT NULL AND btrim(p_cik) <> '' THEN
      SELECT startup_id INTO v_startup_id FROM company_identifiers
       WHERE kind = 'cik' AND value = btrim(p_cik) LIMIT 1;
    END IF;
    IF v_startup_id IS NULL AND p_source = 'uk_companies_house'
       AND p_entity_number IS NOT NULL AND btrim(p_entity_number) <> '' THEN
      SELECT startup_id INTO v_startup_id FROM company_identifiers
       WHERE kind = 'ch_number' AND value = btrim(p_entity_number) LIMIT 1;
    END IF;
    IF v_startup_id IS NULL AND p_website IS NOT NULL THEN
      v_domain := registrable_domain(p_website);
      IF v_domain IS NOT NULL THEN
        SELECT startup_id INTO v_startup_id FROM company_identifiers
         WHERE kind = 'domain' AND value = v_domain LIMIT 1;
      END IF;
    END IF;
    IF v_startup_id IS NULL THEN
      SELECT id, country INTO v_startup_id, v_candidate_country
        FROM startups WHERE lower(btrim(name)) = lower(btrim(p_entity_name))
       ORDER BY created_at LIMIT 1;
      IF v_startup_id IS NOT NULL
         AND p_country IS NOT NULL AND btrim(p_country) <> ''
         AND v_candidate_country IS NOT NULL AND btrim(v_candidate_country) <> ''
         AND lower(btrim(v_candidate_country)) <> lower(btrim(p_country)) THEN
        v_startup_id := NULL;
      END IF;
    END IF;
    IF v_startup_id IS NULL AND v_slug IS NOT NULL THEN
      SELECT id INTO v_startup_id FROM startups WHERE slug = v_slug LIMIT 1;
    END IF;

    IF v_startup_id IS NOT NULL THEN
      -- Known company: enrich gaps and record identifiers, as before.
      UPDATE startups
         SET founded_year = COALESCE(founded_year, v_year),
             country      = COALESCE(country, p_country),
             slug         = COALESCE(slug, CASE WHEN v_slug IS NOT NULL
                                    AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.slug = v_slug AND s.id <> v_startup_id)
                                   THEN v_slug END),
             updated_at   = now()
       WHERE id = v_startup_id;
      IF p_cik IS NOT NULL AND btrim(p_cik) <> '' THEN
        INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
        VALUES (v_startup_id, 'cik', btrim(p_cik), 'raw_gov_filings.cik', 1.00) ON CONFLICT (kind, value) DO NOTHING;
      END IF;
      IF p_source = 'uk_companies_house' AND p_entity_number IS NOT NULL AND btrim(p_entity_number) <> '' THEN
        INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
        VALUES (v_startup_id, 'ch_number', btrim(p_entity_number), 'raw_gov_filings.entity_number', 1.00) ON CONFLICT (kind, value) DO NOTHING;
      END IF;
      IF v_domain IS NOT NULL THEN
        INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
        VALUES (v_startup_id, 'domain', v_domain, 'raw_gov_filings.website', 0.80) ON CONFLICT (kind, value) DO NOTHING;
      END IF;

    ELSIF v_tier <> 'reject' THEN
      -- ── NEW: unknown company → a candidate, never a startups row ────────
      v_key := coalesce(nullif(btrim(p_cik), ''),
                        CASE WHEN p_source = 'uk_companies_house' THEN nullif(btrim(p_entity_number), '') END,
                        'name:' || normalize_applicant_name(p_entity_name));
      INSERT INTO company_candidates AS c (
        source, candidate_key, name, country, founded_year, cik, entity_number, website, gate_tier, evidence
      ) VALUES (
        p_source, v_key, btrim(p_entity_name), p_country, v_year, nullif(btrim(p_cik), ''),
        nullif(btrim(p_entity_number), ''), p_website, v_tier,
        jsonb_strip_nulls(jsonb_build_object(
          'form_type', p_form_type, 'jurisdiction', p_jurisdiction, 'industry_group', p_industry_group,
          'codes', to_jsonb(p_codes), 'officers', p_officers, 'summary', p_tech_summary,
          'total_offering', p_total_offering, 'total_sold', p_total_sold,
          'title', p_title, 'abstract', left(p_abstract, 2000), 'filing_date', p_filing_date))
      )
      ON CONFLICT (source, candidate_key) DO UPDATE
        SET last_seen_at  = now(),
            filings_count = c.filings_count + CASE WHEN EXISTS (
                              SELECT 1 FROM raw_gov_filings x
                               WHERE x.source = p_source AND x.accession_number = btrim(p_accession)) THEN 0 ELSE 1 END,
            -- a pending candidate can be upgraded to 'alert' by a later filing; decided ones keep their state
            gate_tier     = CASE WHEN c.status = 'pending' AND EXCLUDED.gate_tier = 'alert' THEN 'alert' ELSE c.gate_tier END,
            website       = coalesce(c.website, EXCLUDED.website),
            founded_year  = coalesce(c.founded_year, EXCLUDED.founded_year)
      RETURNING id INTO v_candidate_id;
    END IF;
  END IF;

  INSERT INTO raw_gov_filings (
    source, accession_number, cik, entity_number, form_type, entity_name, filing_date,
    year_of_inc, jurisdiction, country, industry_group, classification_codes,
    title, abstract, officers, tech_summary, total_offering, total_sold,
    raw_payload, startup_id, gate_tier, gate_reasons, candidate_id
  ) VALUES (
    p_source, btrim(p_accession), p_cik, p_entity_number, p_form_type, btrim(p_entity_name), p_filing_date,
    p_year_of_inc, p_jurisdiction, p_country, p_industry_group, p_codes,
    p_title, p_abstract, COALESCE(p_officers, '[]'::jsonb), p_tech_summary, p_total_offering, p_total_sold,
    p_raw, v_startup_id,
    CASE WHEN p_unlinked OR v_startup_id IS NOT NULL THEN NULL ELSE v_tier END,
    CASE WHEN p_unlinked OR v_startup_id IS NOT NULL THEN NULL ELSE v_reasons END,
    v_candidate_id
  )
  ON CONFLICT (source, accession_number) DO UPDATE
    SET startup_id           = COALESCE(raw_gov_filings.startup_id, EXCLUDED.startup_id),
        candidate_id         = COALESCE(raw_gov_filings.candidate_id, EXCLUDED.candidate_id),
        gate_tier            = COALESCE(EXCLUDED.gate_tier, raw_gov_filings.gate_tier),
        gate_reasons         = COALESCE(EXCLUDED.gate_reasons, raw_gov_filings.gate_reasons),
        officers             = CASE WHEN jsonb_array_length(EXCLUDED.officers) > 0
                                    THEN EXCLUDED.officers ELSE raw_gov_filings.officers END,
        tech_summary         = COALESCE(EXCLUDED.tech_summary, raw_gov_filings.tech_summary),
        classification_codes = EXCLUDED.classification_codes,
        title                = EXCLUDED.title,
        abstract             = EXCLUDED.abstract,
        raw_payload          = EXCLUDED.raw_payload
  RETURNING id INTO v_filing_id;

  RETURN jsonb_build_object(
    'filing_id',       v_filing_id,
    'startup_id',      v_startup_id,
    'candidate_id',    v_candidate_id,
    'gate_tier',       CASE WHEN p_unlinked OR v_startup_id IS NOT NULL THEN NULL ELSE v_tier END,
    'created_startup', false,
    'slug',            v_slug,
    'founded_year',    v_year,
    'unlinked',        p_unlinked
  );
END;
$$;

COMMENT ON FUNCTION ingest_gov_entity_filing IS
  'Resolves a filing to an EXISTING startups row (CIK, Companies House number, domain, then exact name with country corroboration, then slug). When nothing resolves it never creates a company: a gate verdict of reject stores the filing alone; queue/alert (or no verdict = queue) upsert a company_candidates row for admin review. p_unlinked skips resolution (inventor-held patents).';

REVOKE ALL ON FUNCTION ingest_gov_entity_filing(
  text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb,boolean,text,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_gov_entity_filing(
  text,text,text,date,text,text,text,integer,text,text,text,text[],text,text,jsonb,text,numeric,numeric,jsonb,boolean,text,jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION ingest_form_d_filing(
  p_accession      text,
  p_cik            text,
  p_form_type      text,
  p_entity_name    text,
  p_filing_date    date,
  p_year_of_inc    integer,
  p_jurisdiction   text,
  p_industry_group text,
  p_officers       jsonb,
  p_tech_summary   text,
  p_total_offering numeric,
  p_total_sold     numeric,
  p_raw            jsonb,
  p_gate           jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ingest_gov_entity_filing(
    p_source => 'sec_form_d', p_accession => p_accession, p_entity_name => p_entity_name,
    p_filing_date => p_filing_date, p_cik => p_cik, p_form_type => p_form_type,
    p_year_of_inc => p_year_of_inc, p_jurisdiction => p_jurisdiction, p_country => 'United States',
    p_industry_group => p_industry_group, p_officers => p_officers, p_tech_summary => p_tech_summary,
    p_total_offering => p_total_offering, p_total_sold => p_total_sold, p_raw => p_raw, p_gate => p_gate
  );
$$;
REVOKE ALL ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb,jsonb) TO service_role;

-- ── 5. Review ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_company_candidate(p_candidate_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            company_candidates%ROWTYPE;
  v_startup_id uuid;
  v_slug       text;
BEGIN
  IF NOT (is_app_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'approve_company_candidate: admins only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM company_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_company_candidate: no candidate %', p_candidate_id;
  END IF;
  IF c.status = 'approved' AND c.startup_id IS NOT NULL THEN
    RETURN c.startup_id;
  END IF;

  -- The company may have entered meanwhile (another source, a manual import).
  IF c.cik IS NOT NULL THEN
    SELECT startup_id INTO v_startup_id FROM company_identifiers WHERE kind = 'cik' AND value = c.cik LIMIT 1;
  END IF;
  IF v_startup_id IS NULL AND c.source = 'uk_companies_house' AND c.entity_number IS NOT NULL THEN
    SELECT startup_id INTO v_startup_id FROM company_identifiers WHERE kind = 'ch_number' AND value = c.entity_number LIMIT 1;
  END IF;

  IF v_startup_id IS NULL THEN
    v_slug := gov_company_slug(c.name);
    INSERT INTO startups (name, slug, founded_year, country, website)
    VALUES (c.name,
            CASE WHEN v_slug IS NOT NULL AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.slug = v_slug) THEN v_slug END,
            c.founded_year, c.country, c.website)
    RETURNING id INTO v_startup_id;
  END IF;

  IF c.cik IS NOT NULL THEN
    INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
    VALUES (v_startup_id, 'cik', c.cik, 'company_candidates', 1.00) ON CONFLICT (kind, value) DO NOTHING;
  END IF;
  IF c.source = 'uk_companies_house' AND c.entity_number IS NOT NULL THEN
    INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
    VALUES (v_startup_id, 'ch_number', c.entity_number, 'company_candidates', 1.00) ON CONFLICT (kind, value) DO NOTHING;
  END IF;

  UPDATE raw_gov_filings SET startup_id = v_startup_id
   WHERE candidate_id = c.id AND startup_id IS NULL;

  UPDATE company_candidates
     SET status = 'approved', startup_id = v_startup_id, reviewed_at = now(),
         reviewed_by = auth.uid(), review_note = coalesce(p_note, review_note)
   WHERE id = c.id;

  RETURN v_startup_id;
END;
$$;

CREATE OR REPLACE FUNCTION reject_company_candidate(p_candidate_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_app_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'reject_company_candidate: admins only' USING ERRCODE = '42501';
  END IF;
  UPDATE company_candidates
     SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = coalesce(p_note, review_note)
   WHERE id = p_candidate_id AND status <> 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_company_candidate: no pending/rejected candidate %', p_candidate_id;
  END IF;
  -- An alert already sent about it leaves the users' bells (agreed 2026-10-15).
  DELETE FROM notifications WHERE dedupe_key = 'candidate:' || p_candidate_id::text;
END;
$$;

REVOKE ALL ON FUNCTION approve_company_candidate(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reject_company_candidate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_company_candidate(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reject_company_candidate(uuid, text) TO authenticated, service_role;

SELECT (SELECT count(*) FROM app_admins) AS admins,
       (SELECT count(*) FROM company_candidates) AS candidates;
