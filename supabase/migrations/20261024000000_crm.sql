-- =============================================================================
-- "Check a company", stage 4: the investor's CRM in My Area.
--
-- Everything here belongs to one user and nobody else: RLS on every table,
-- documents in a private Storage folder per user. Nothing in these tables
-- feeds anything shared (the opportunity engine, candidates, statistics,
-- other users' notifications) — the spec's privacy section.
--
--   crm_companies   one row per company the user tracks: a company in
--                   AlphaMap (startup_id), a company they checked
--                   (check_id), or both. Pipeline stage, notes, tags, next step.
--   crm_deal_terms  the user's own investment terms (instrument, amount,
--                   valuation, date, ownership).
--   crm_documents   file metadata; the files live in Storage bucket
--                   crm-documents under <user id>/<crm company id>/...
--
-- Automatic, both private to the user:
--   * a confirmed check (or one matched to an AlphaMap company) gets a CRM row;
--   * a CRM row for an AlphaMap company puts it on the user's watchlist.
--
-- Rollback: supabase/rollback/20261024000000_crm_down.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm_companies (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  startup_id     uuid        REFERENCES startups (id) ON DELETE SET NULL,
  check_id       uuid        REFERENCES company_checks (id) ON DELETE SET NULL,
  name           text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  website        text        CHECK (website IS NULL OR char_length(website) <= 300),
  stage          text        NOT NULL DEFAULT 'watching' CHECK (stage IN (
                               'watching', 'reviewing', 'diligence', 'term_sheet', 'invested', 'passed')),
  notes          text        CHECK (notes IS NULL OR char_length(notes) <= 20000),
  tags           text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 30),
  next_step      text        CHECK (next_step IS NULL OR char_length(next_step) <= 500),
  next_step_date date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE crm_companies IS
  'A user''s own CRM. Private (RLS). Never read by anything shared.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_companies_startup ON crm_companies (user_id, startup_id) WHERE startup_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_companies_check ON crm_companies (user_id, check_id) WHERE check_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_companies_user ON crm_companies (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_deal_terms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_company_id  uuid        NOT NULL REFERENCES crm_companies (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  instrument      text        NOT NULL CHECK (instrument IN ('safe', 'equity', 'convertible_note', 'other')),
  round_label     text        CHECK (round_label IS NULL OR char_length(round_label) <= 60),
  amount          numeric     CHECK (amount IS NULL OR amount >= 0),
  valuation       numeric     CHECK (valuation IS NULL OR valuation >= 0),
  valuation_kind  text        CHECK (valuation_kind IS NULL OR valuation_kind IN ('pre', 'post', 'cap')),
  invested_on     date,
  ownership_pct   numeric     CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
  notes           text        CHECK (notes IS NULL OR char_length(notes) <= 5000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_deal_terms_company ON crm_deal_terms (crm_company_id);

CREATE TABLE IF NOT EXISTS crm_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_company_id  uuid        NOT NULL REFERENCES crm_companies (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  file_name       text        NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  storage_path    text        NOT NULL UNIQUE,
  size_bytes      bigint      CHECK (size_bytes IS NULL OR size_bytes >= 0),
  mime_type       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_documents_company ON crm_documents (crm_company_id);

-- updated_at
CREATE OR REPLACE FUNCTION crm_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_crm_companies_touch ON crm_companies;
CREATE TRIGGER trg_crm_companies_touch BEFORE UPDATE ON crm_companies FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
DROP TRIGGER IF EXISTS trg_crm_deal_terms_touch ON crm_deal_terms;
CREATE TRIGGER trg_crm_deal_terms_touch BEFORE UPDATE ON crm_deal_terms FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();

-- ── RLS: the owner only ──────────────────────────────────────────────────────
ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_companies_own ON crm_companies;
CREATE POLICY crm_companies_own ON crm_companies FOR ALL
  USING (user_id = auth.uid())
  -- a check can only be linked by its owner
  WITH CHECK (user_id = auth.uid()
    AND (check_id IS NULL OR EXISTS (SELECT 1 FROM company_checks c WHERE c.id = check_id AND c.user_id = auth.uid())));

DROP POLICY IF EXISTS crm_deal_terms_own ON crm_deal_terms;
CREATE POLICY crm_deal_terms_own ON crm_deal_terms FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM crm_companies c WHERE c.id = crm_company_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS crm_documents_own ON crm_documents;
CREATE POLICY crm_documents_own ON crm_documents FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
    AND storage_path LIKE auth.uid()::text || '/' || crm_company_id::text || '/%'
    AND EXISTS (SELECT 1 FROM crm_companies c WHERE c.id = crm_company_id AND c.user_id = auth.uid()));

REVOKE ALL ON crm_companies, crm_deal_terms, crm_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_companies, crm_deal_terms, crm_documents TO authenticated;

-- ── Storage: one private folder per user ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('crm-documents', 'crm-documents', false, 26214400)   -- 25 MB per file
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS crm_documents_owner_read ON storage.objects;
CREATE POLICY crm_documents_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crm-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS crm_documents_owner_insert ON storage.objects;
CREATE POLICY crm_documents_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS crm_documents_owner_delete ON storage.objects;
CREATE POLICY crm_documents_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'crm-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── A confirmed check enters its owner's CRM ─────────────────────────────────
CREATE OR REPLACE FUNCTION crm_add_checked_company() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phase = 'check' AND NEW.status IN ('queued', 'matched')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.phase IS DISTINCT FROM NEW.phase) THEN
    INSERT INTO crm_companies (user_id, check_id, startup_id, name, website)
    VALUES (NEW.user_id, NEW.id, NEW.matched_startup_id,
            left(coalesce(nullif(NEW.identity->>'name', ''), NEW.input->>'name'), 200),
            left(coalesce(nullif(NEW.identity->>'website', ''), NEW.input->>'website'), 300))
    ON CONFLICT DO NOTHING;   -- already tracked (same check, or the same AlphaMap company)
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_company_checks_to_crm ON company_checks;
CREATE TRIGGER trg_company_checks_to_crm AFTER INSERT OR UPDATE OF status, phase ON company_checks
  FOR EACH ROW EXECUTE FUNCTION crm_add_checked_company();

-- ── An AlphaMap company in the CRM is on the watchlist (spec item 9) ─────────
CREATE OR REPLACE FUNCTION crm_watch_company() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.startup_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.startup_id IS DISTINCT FROM NEW.startup_id) THEN
    INSERT INTO watchlist_items (user_id, entity_type, entity_id)
    VALUES (NEW.user_id, 'startup', NEW.startup_id)
    ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_watch_company ON crm_companies;
CREATE TRIGGER trg_crm_watch_company AFTER INSERT OR UPDATE OF startup_id ON crm_companies
  FOR EACH ROW EXECUTE FUNCTION crm_watch_company();

REVOKE ALL ON FUNCTION crm_add_checked_company() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm_watch_company() FROM PUBLIC, anon, authenticated;

-- Checks made before the CRM existed (stage 2-3) join it once.
INSERT INTO crm_companies (user_id, check_id, startup_id, name, website, created_at)
SELECT c.user_id, c.id, c.matched_startup_id,
       left(coalesce(nullif(c.identity->>'name', ''), c.input->>'name'), 200),
       left(coalesce(nullif(c.identity->>'website', ''), c.input->>'website'), 300),
       c.created_at
  FROM company_checks c
 WHERE c.phase = 'check' AND c.status NOT IN ('cancelled', 'failed')
ON CONFLICT DO NOTHING;
