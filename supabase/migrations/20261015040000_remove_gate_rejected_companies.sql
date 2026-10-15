-- =============================================================================
-- Migration: remove the companies the quality gate rejects (engine-created only)
-- Created:   2026-10-15
-- Description:
--   Until 2026-10-15 every UK incorporation, EPO patent applicant and Form D
--   filer became a startups row. The quality gate
--   (supabase/functions/_shared/company-gate.ts), run over all 487 production
--   filings, rejects 354 of the companies they created: one-director contractor
--   companies, holding/consultancy shells, corporations (Disney, Microsoft,
--   Intuit, Bosch...), universities and private inventors. The (source, name)
--   pairs below are that verdict, generated from the gate — not hand-picked.
--
--   A company is deleted only when ALL of these hold — anything else is kept
--   and counted in the NOTICE:
--     1. it was CREATED by the engine: its row is no older than its first
--        filing (the ingest RPC inserts both in one transaction, so a company
--        that existed before and was merely linked to a filing is older);
--     2. every filing linked to it is on the reject list (a company with one
--        passing filing stays);
--     3. no user has it on a watchlist or has interacted with it;
--     4. nobody marked it is_manually_verified.
--
--   Every deleted row is copied whole into deleted_startups_archive first
--   (restore: supabase/rollback/20261015040000_remove_gate_rejected_companies_down.sql).
--   Rows that reference a company cascade with it (funding rounds, headcount,
--   provenance, identifiers); raw filings are kept with startup_id set NULL, so
--   the record of what was seen survives. Competitor entries elsewhere that
--   pointed at a deleted company keep the name and lose the dangling id.
--
--   Refuses to run (raises) if more than 380 companies qualify — the data has
--   changed beyond this verdict and it must be regenerated.
--
-- Idempotent: a second run finds nothing left to delete.
-- =============================================================================

CREATE TABLE IF NOT EXISTS deleted_startups_archive (
  id          uuid        NOT NULL,
  name        text,
  row_data    jsonb       NOT NULL,
  reason      text        NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE deleted_startups_archive IS
  'Whole startups rows removed by cleanup migrations, kept so a deletion can be reviewed or restored.';
REVOKE ALL ON deleted_startups_archive FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_ids      uuid[];
  v_matched  integer;
  v_not_new  integer;
  v_mixed    integer;
  v_used     integer;
  v_verified integer;
  v_refs     integer;
BEGIN
  WITH targets(source, name) AS (
    VALUES
      ('epo_ops', 'Abotchie David D.'),
      ('epo_ops', 'Ahilan Geetha Y'),
      ('epo_ops', 'Aldahwi Samara'),
      ('epo_ops', 'Algreatly Cherif'),
      ('epo_ops', 'Amdocs Development Limited'),
      ('epo_ops', 'Avago Technologies International Sales Pte. Limited'),
      ('epo_ops', 'Avalara, Inc.'),
      ('epo_ops', 'B/E Aerospace, Inc.'),
      ('epo_ops', 'Beijing Zitiao Network Technology Co., Ltd.'),
      ('epo_ops', 'Bertalan George A.'),
      ('epo_ops', 'Bitdefender IPR Management Ltd.'),
      ('epo_ops', 'Blue Yonder Defense Solutions, LLC'),
      ('epo_ops', 'Blue Yonder Group, Inc.'),
      ('epo_ops', 'BlueHalo, LLC'),
      ('epo_ops', 'Brubaker William'),
      ('epo_ops', 'Byron Nathan'),
      ('epo_ops', 'Camelot UK Bidco Limited'),
      ('epo_ops', 'Capital One Services, LLC'),
      ('epo_ops', 'Carl Zeiss Microscopy GmbH'),
      ('epo_ops', 'Carnegie Mellon University'),
      ('epo_ops', 'Cerner Innovation, Inc.'),
      ('epo_ops', 'Cianfrocca Francis'),
      ('epo_ops', 'City University of Hong Kong'),
      ('epo_ops', 'Core Scientific Operating Company'),
      ('epo_ops', 'DISH Network L.L.C.'),
      ('epo_ops', 'DigiCert, Inc.'),
      ('epo_ops', 'Disney Enterprises, Inc.'),
      ('epo_ops', 'Dropbox, Inc.'),
      ('epo_ops', 'Emory University'),
      ('epo_ops', 'FCA US LLC'),
      ('epo_ops', 'FUJIFILM Business Innovation Corp.'),
      ('epo_ops', 'Fluke Corporation'),
      ('epo_ops', 'Ford Global Technologies, LLC'),
      ('epo_ops', 'GALAXY US OPCO INC D/B/A VIALTO PARTNERS'),
      ('epo_ops', 'GDM Holding LLC'),
      ('epo_ops', 'GHOSH Ashish'),
      ('epo_ops', 'GM GLOBAL TECHNOLOGY OPERATIONS LLC'),
      ('epo_ops', 'GM Global Technology Operations LLC'),
      ('epo_ops', 'GWANGJU INSTITUTE OF SCIENCE AND TECHNOLOGY'),
      ('epo_ops', 'Gachon University of Industry-Academic Cooperation Foundation'),
      ('epo_ops', 'Government of the United States, as represented by the Secretary of the Air Force'),
      ('epo_ops', 'Gupta Sandeep'),
      ('epo_ops', 'HOSSEINZADEH TAHER Mohammad Reza'),
      ('epo_ops', 'Helm Kollin Wallace'),
      ('epo_ops', 'Ho Ching-Tien'),
      ('epo_ops', 'Huang Chengjie'),
      ('epo_ops', 'IDEMIA PUBLIC SECURITY FRANCE'),
      ('epo_ops', 'INTUIT INC.'),
      ('epo_ops', 'Intrinsic Innovation LLC'),
      ('epo_ops', 'Intuit Inc.'),
      ('epo_ops', 'KOREA INSTITUTE OF SCIENCE AND TECHNOLOGY'),
      ('epo_ops', 'Khalifa University of Science and Technology'),
      ('epo_ops', 'King Fahd University of Petroleum and Minerals'),
      ('epo_ops', 'LEICA GEOSYSTEMS AG'),
      ('epo_ops', 'LG Energy Solution, Ltd.'),
      ('epo_ops', 'LIN Ella H.'),
      ('epo_ops', 'Levya Chris'),
      ('epo_ops', 'Li Chian Chiu'),
      ('epo_ops', 'MA Szu Cheng'),
      ('epo_ops', 'MAHLE International GmbH'),
      ('epo_ops', 'MANN+HUMMEL GmbH'),
      ('epo_ops', 'MICROSOFT TECHNOLOGY LICENSING, LLC'),
      ('epo_ops', 'MIKUNI CORPORATION'),
      ('epo_ops', 'Magna Electronics Inc.'),
      ('epo_ops', 'Maguire Debbie A'),
      ('epo_ops', 'Microsoft Technology Licensing, LLC'),
      ('epo_ops', 'Mitel Networks Corporation'),
      ('epo_ops', 'NANO AND ADVANCED MATERIALS INSTITUTE LIMITED'),
      ('epo_ops', 'NAVER CORPORATION'),
      ('epo_ops', 'NEC Laboratories America, Inc.'),
      ('epo_ops', 'NICHIA CORPORATION'),
      ('epo_ops', 'Nanjing Chervon Industry Co., Ltd.'),
      ('epo_ops', 'Odeh Samuel'),
      ('epo_ops', 'OpenAI OpCo, LLC'),
      ('epo_ops', 'Oshkosh Defense, LLC'),
      ('epo_ops', 'PACCAR Inc'),
      ('epo_ops', 'PRINCE MOHAMMAD BIN FAHD UNIVERSITY'),
      ('epo_ops', 'Park Jonghyun'),
      ('epo_ops', 'Perez Michael Arthur'),
      ('epo_ops', 'Prime Planet Energy & Solutions, Inc.'),
      ('epo_ops', 'QlikTech International AB'),
      ('epo_ops', 'ROCKWELL AUTOMATION CANADA LTD.'),
      ('epo_ops', 'Rivkin Leon'),
      ('epo_ops', 'Robert Bosch GmbH'),
      ('epo_ops', 'SAS Institute Inc.'),
      ('epo_ops', 'SEMICONDUCTOR ENERGY LABORATORY CO., LTD.'),
      ('epo_ops', 'SK ON CO., LTD.'),
      ('epo_ops', 'SK On Co., Ltd.'),
      ('epo_ops', 'SPHERE ENTERTAINMENT GROUP, LLC'),
      ('epo_ops', 'Samsara Inc.'),
      ('epo_ops', 'Savant Systems, Inc.'),
      ('epo_ops', 'Schneider Eric'),
      ('epo_ops', 'Snap Inc.'),
      ('epo_ops', 'State Farm Mutual Automobile Insurance Company'),
      ('epo_ops', 'TOYOTA RESEARCH INSTITUTE, INC.'),
      ('epo_ops', 'TSUCHIYAMA Wakako'),
      ('epo_ops', 'Takauji Keigo'),
      ('epo_ops', 'The Johns Hopkins University'),
      ('epo_ops', 'The Trustees of Columbia University in the City of New York'),
      ('epo_ops', 'Torc Robotics, Inc.'),
      ('epo_ops', 'Toshiba Tec Kabushiki Kaisha'),
      ('epo_ops', 'Toyota Research Institute, Inc.'),
      ('epo_ops', 'Tuhui Shengchuang Enterprise Management (Suzhou) Partnership (Limited Partnership)'),
      ('epo_ops', 'UIF (University Industry Foundation), Yonsei University'),
      ('epo_ops', 'UIPCO, LLC'),
      ('epo_ops', 'UNIVERSITY OF MARYLAND, BALTIMORE'),
      ('epo_ops', 'UNIVERSITY OF TENNESSEE RESEARCH FOUNDATION'),
      ('epo_ops', 'UOP LLC'),
      ('epo_ops', 'VeriSign, Inc.'),
      ('epo_ops', 'Walmart Apollo, LLC'),
      ('epo_ops', 'Whitfield Robert'),
      ('epo_ops', 'Wistron Corporation'),
      ('epo_ops', 'XUZHOU HIGH TECH ZONE SAFETY EMERGENCY EQUIPMENT INDUSTRIAL TECHNOLOGY RESEARCH INSTITUTE'),
      ('epo_ops', 'Y.E. Hub Armenia LLC'),
      ('epo_ops', 'Yale University'),
      ('epo_ops', 'Yang Teng-Jen'),
      ('epo_ops', 'Yanmar Holdings Co., Ltd.'),
      ('epo_ops', 'Youngblood IP Holdings, LLC'),
      ('epo_ops', 'Zoom Communications, Inc.'),
      ('epo_ops', 'Zoox, Inc.'),
      ('sec_form_d', 'AI Software Holdings, LLC'),
      ('sec_form_d', 'Crafton Equities Inc.'),
      ('sec_form_d', 'Elixir Technology Holdings Inc.'),
      ('uk_companies_house', '99VISIBILITY LTD'),
      ('uk_companies_house', 'A WOODRUFF LTD'),
      ('uk_companies_house', 'ADEX HOME LTD'),
      ('uk_companies_house', 'ADVANCEDKEYSOLUTIONS LTD'),
      ('uk_companies_house', 'AFFORD IT LTD'),
      ('uk_companies_house', 'AHMED IBRAHIM LTD'),
      ('uk_companies_house', 'ALEXTGR8DEV LTD'),
      ('uk_companies_house', 'ALLNEDOO SOLUTIONS LTD'),
      ('uk_companies_house', 'AMAVOLA LTD'),
      ('uk_companies_house', 'ANNAMO LTD'),
      ('uk_companies_house', 'APEX CREATIONS LTD'),
      ('uk_companies_house', 'APPLICATION TECH LTD'),
      ('uk_companies_house', 'ARE INNOVATION LTD'),
      ('uk_companies_house', 'ARMO DIGITAL LIMITED'),
      ('uk_companies_house', 'ARTEM RIAZANTSEV LIMITED'),
      ('uk_companies_house', 'ARVELDON LTD'),
      ('uk_companies_house', 'AVELLANE LIMITED'),
      ('uk_companies_house', 'AVERON TECHNOLOGIES LIMITED'),
      ('uk_companies_house', 'AWW CONSULTANCY LTD'),
      ('uk_companies_house', 'AXENTRA SOFTWARE LTD'),
      ('uk_companies_house', 'BASALTO LTD'),
      ('uk_companies_house', 'BEAST CODES AND SERVICES LTD'),
      ('uk_companies_house', 'BLOOMBOARD LTD'),
      ('uk_companies_house', 'BROADCAST INNOVATION TECHNOLOGIES LIMITED'),
      ('uk_companies_house', 'BRUVÉ JEWELLERY LTD'),
      ('uk_companies_house', 'BTHERE LTD'),
      ('uk_companies_house', 'BUSINESS DATA AI LTD'),
      ('uk_companies_house', 'CA FIBRE SOLUTIONS LTD'),
      ('uk_companies_house', 'CARDIFF GLYCOSCIENCE LTD'),
      ('uk_companies_house', 'CATO TENDERS LIMITED'),
      ('uk_companies_house', 'CENTRIC MANAGEMENT LIMITED'),
      ('uk_companies_house', 'CHAP DIGITECH LTD'),
      ('uk_companies_house', 'CHIFED LTD'),
      ('uk_companies_house', 'CINEMANA PREMIUM LTD'),
      ('uk_companies_house', 'CJ TECH HUB LTD'),
      ('uk_companies_house', 'CODARIS DIGITAL LIMITED'),
      ('uk_companies_house', 'COMMUNITY RANKINGS MEDIA LTD'),
      ('uk_companies_house', 'CONTENT DESIGN STUDIO LONDON LTD'),
      ('uk_companies_house', 'CROWN LAYER LTD'),
      ('uk_companies_house', 'CYBERGENTIC LTD'),
      ('uk_companies_house', 'DEDHIAINFOTECH LTD'),
      ('uk_companies_house', 'DJK LOGIC LTD'),
      ('uk_companies_house', 'DOMILO LTD'),
      ('uk_companies_house', 'DORY LTD'),
      ('uk_companies_house', 'DOUBLE AIGENTS LTD'),
      ('uk_companies_house', 'DRP DIGITAL SERVICES LTD'),
      ('uk_companies_house', 'DUETSCALE CONSULTING LIMITED'),
      ('uk_companies_house', 'EARTHWIRE LTD'),
      ('uk_companies_house', 'EASYSOLVE LIMITED'),
      ('uk_companies_house', 'ELEMENTAL STRATEGY LTD'),
      ('uk_companies_house', 'EMERALD HEXAGON SPORTING VENTURES LIMITED'),
      ('uk_companies_house', 'EMIDU LTD'),
      ('uk_companies_house', 'EMPLOYEE BENEFIT TECHNOLOGIES LIMITED'),
      ('uk_companies_house', 'ENABYL78 LTD'),
      ('uk_companies_house', 'EVCPRO LTD'),
      ('uk_companies_house', 'F21 GROUP LTD'),
      ('uk_companies_house', 'FAERGAARD LTD'),
      ('uk_companies_house', 'FARR WELLNESS TECHNOLOGIES LTD'),
      ('uk_companies_house', 'FERNBYTE LTD'),
      ('uk_companies_house', 'FITEQUANT LTD'),
      ('uk_companies_house', 'FLEETMILE LIMITED'),
      ('uk_companies_house', 'FORECOURT CRM LTD'),
      ('uk_companies_house', 'FORM+FAUNA LTD'),
      ('uk_companies_house', 'FORMA CYCLING LTD'),
      ('uk_companies_house', 'FOUNDATIONAL LABS LIMITED'),
      ('uk_companies_house', 'FRIENDSAPP LTD'),
      ('uk_companies_house', 'FROSTPEAK INTERACTIVE LTD'),
      ('uk_companies_house', 'GAOKUI AD ASTRA LTD'),
      ('uk_companies_house', 'GENETUM TECHNOLOGIES LTD'),
      ('uk_companies_house', 'GEO INFORMATIQUE LTD'),
      ('uk_companies_house', 'GLOBAL AIROBOTICS IMPACT FOUNDATION LIMITED'),
      ('uk_companies_house', 'GLYMORE AI LTD'),
      ('uk_companies_house', 'GOOD & FAITHFUL LTD'),
      ('uk_companies_house', 'GRAYSON TECH LIMITED'),
      ('uk_companies_house', 'GROSSISTAS LTD'),
      ('uk_companies_house', 'GRUPO ALVEZ LTD'),
      ('uk_companies_house', 'HAPTIC MATTER LIMITED'),
      ('uk_companies_house', 'HATRO CAPABILITY GROUP LTD'),
      ('uk_companies_house', 'HAWATEX LTD'),
      ('uk_companies_house', 'HEADINGTON COMMUNICATIONS LTD'),
      ('uk_companies_house', 'HELMWRIGHT LTD'),
      ('uk_companies_house', 'HENDERSON AJ & FAMILY LTD'),
      ('uk_companies_house', 'HERMETIC ADVISORY LTD'),
      ('uk_companies_house', 'HOPECRAFT AI LIMITED'),
      ('uk_companies_house', 'HOTCHKISS CLINICAL SOLUTIONS LTD'),
      ('uk_companies_house', 'HTIS INTERNATIONAL LTD'),
      ('uk_companies_house', 'HYPERLOCAL URBAN FOODHUBS LTD'),
      ('uk_companies_house', 'IDOTTA LIMITED'),
      ('uk_companies_house', 'IMPRONTE LIMITED'),
      ('uk_companies_house', 'INFERA ENGINE LTD'),
      ('uk_companies_house', 'INSTANTSELLER LTD'),
      ('uk_companies_house', 'INTHEKNOW GROUP LIMITED'),
      ('uk_companies_house', 'ISMK SOLUTIONS LTD'),
      ('uk_companies_house', 'JAMES-FROWN HOLDINGS LTD'),
      ('uk_companies_house', 'JCR TECHNOLOGIES LTD'),
      ('uk_companies_house', 'JLOGIC INDUSTRIES LIMITED'),
      ('uk_companies_house', 'JMCDBS LTD'),
      ('uk_companies_house', 'JNS IT LTD'),
      ('uk_companies_house', 'KAGHAZ LESS LTD'),
      ('uk_companies_house', 'KALOTECT LTD'),
      ('uk_companies_house', 'KENZIE AI LTD'),
      ('uk_companies_house', 'KERNOW IMMERSIVE LTD'),
      ('uk_companies_house', 'KESHER MOBILE LTD'),
      ('uk_companies_house', 'KLEOSS LIMITED'),
      ('uk_companies_house', 'KOKOCASE LIMITED'),
      ('uk_companies_house', 'KRAFTA LTD'),
      ('uk_companies_house', 'KREILIO LIMITED'),
      ('uk_companies_house', 'KSR TECHNOLOGIES LIMITED'),
      ('uk_companies_house', 'LEADWOOD GROWTH LTD'),
      ('uk_companies_house', 'LEXPAR GROUP LTD'),
      ('uk_companies_house', 'LIVING WELL PARTNERS LTD'),
      ('uk_companies_house', 'LOCUSD LTD'),
      ('uk_companies_house', 'LRS BIO CONSULTING LTD'),
      ('uk_companies_house', 'LUMINOUS EDGE LIMITED'),
      ('uk_companies_house', 'LUMIS RECOVERY LTD'),
      ('uk_companies_house', 'MACKEY CONSULTANCY LTD'),
      ('uk_companies_house', 'MADE MY WAY C.I.C.'),
      ('uk_companies_house', 'MAKETHATTWO LTD'),
      ('uk_companies_house', 'MALOMA LTD'),
      ('uk_companies_house', 'MDC SOFTWARE LTD'),
      ('uk_companies_house', 'MEANTFOR LTD'),
      ('uk_companies_house', 'MEDYOGRAFYA LTD'),
      ('uk_companies_house', 'MEKANODE LIMITED'),
      ('uk_companies_house', 'MERA MATCH LTD'),
      ('uk_companies_house', 'MINDIN TECHNOLOGY LTD'),
      ('uk_companies_house', 'MISSION COMMAND DYNAMICS LIMITED'),
      ('uk_companies_house', 'MONTECH PVT LTD'),
      ('uk_companies_house', 'MOTASHARE LTD'),
      ('uk_companies_house', 'MULLANIT LTD'),
      ('uk_companies_house', 'MXD DIGITAL LIMITED'),
      ('uk_companies_house', 'MYDIGIT LTD'),
      ('uk_companies_house', 'NACHVEN TECHNOLOGIES LTD'),
      ('uk_companies_house', 'NAZEMIUS LTD'),
      ('uk_companies_house', 'NOBORDA LTD'),
      ('uk_companies_house', 'NOOFA LTD'),
      ('uk_companies_house', 'NORTHAVERE MERCANTILE LTD'),
      ('uk_companies_house', 'NORTHLIGHT TECHNOLOGIES LTD'),
      ('uk_companies_house', 'NORTHVANE PROPERTY LTD'),
      ('uk_companies_house', 'OLY LABS LTD'),
      ('uk_companies_house', 'OPEN DISCOVERY CORPORATION LTD'),
      ('uk_companies_house', 'PADOOKI LTD'),
      ('uk_companies_house', 'PANASIUK SOFTWARE SOLUTIONS LIMITED'),
      ('uk_companies_house', 'PEARL TRADE SERVICES LTD'),
      ('uk_companies_house', 'PER ALTA DEVELOPMENTS LTD'),
      ('uk_companies_house', 'PETSGRAM LTD'),
      ('uk_companies_house', 'PINHEAVEN LTD'),
      ('uk_companies_house', 'PIP & STEM STUDIOS LTD'),
      ('uk_companies_house', 'PMO SAAS LTD'),
      ('uk_companies_house', 'POSHLAYER LTD'),
      ('uk_companies_house', 'POTREK LABS LTD'),
      ('uk_companies_house', 'POWERED BY AI SERVICES LTD'),
      ('uk_companies_house', 'PREDIX DIGITAL LTD'),
      ('uk_companies_house', 'PROJECT E.C.H.O TECHNOLOGIES LTD'),
      ('uk_companies_house', 'PROJECT50CHALLENGE LTD'),
      ('uk_companies_house', 'PROMPTPADDI LIMITED'),
      ('uk_companies_house', 'PRONECTIV LTD'),
      ('uk_companies_house', 'PROVANTAR UK LTD'),
      ('uk_companies_house', 'PROXIMITY IT LTD'),
      ('uk_companies_house', 'PRYNOID TECHNOLOGIES LTD'),
      ('uk_companies_house', 'PULSARGTM LTD'),
      ('uk_companies_house', 'PURPOSE TECHNOLOGIES LTD'),
      ('uk_companies_house', 'QUANTMETRIC LABS LIMITED'),
      ('uk_companies_house', 'QUICKTAC SOLUTIONS LTD'),
      ('uk_companies_house', 'REACT-ER TECHNOLOGIES LTD'),
      ('uk_companies_house', 'RECONTIE LTD'),
      ('uk_companies_house', 'REEFCLOUD LTD'),
      ('uk_companies_house', 'RENVOTEK LTD'),
      ('uk_companies_house', 'REX AUCTIONS LTD'),
      ('uk_companies_house', 'ROAM EDUCATION LIMITED'),
      ('uk_companies_house', 'ROOKWILD LTD'),
      ('uk_companies_house', 'RUJUTA IT CONSULTANCY LTD'),
      ('uk_companies_house', 'SAAD DEVELOPMENT GROUP LTD'),
      ('uk_companies_house', 'SELECTION SOLUTIONS LIMITED'),
      ('uk_companies_house', 'SELKWARE LTD'),
      ('uk_companies_house', 'SEMIDEX LIMITED'),
      ('uk_companies_house', 'SHAKIL UK LIMITED'),
      ('uk_companies_house', 'SHARPEDGE TECH LTD'),
      ('uk_companies_house', 'SHROOM ME UP LTD'),
      ('uk_companies_house', 'SIMPLY ALLIOUAGANA (UK) LTD'),
      ('uk_companies_house', 'SIPFORGE LIMITED'),
      ('uk_companies_house', 'SKS SYSTEMS LTD'),
      ('uk_companies_house', 'SOLUS FM LTD'),
      ('uk_companies_house', 'SONNEL LTD'),
      ('uk_companies_house', 'SOT-AI-TRADING LTD'),
      ('uk_companies_house', 'STRAITLINE DIGITAL LTD'),
      ('uk_companies_house', 'STRONGE CYBER SECURITY LTD'),
      ('uk_companies_house', 'STRVYX LTD'),
      ('uk_companies_house', 'SURFWARE LTD'),
      ('uk_companies_house', 'SWARJ CONSULTANTS LIMITED'),
      ('uk_companies_house', 'SYBEX DESIGNS LIMITED'),
      ('uk_companies_house', 'SYNTABZ LTD'),
      ('uk_companies_house', 'SYSROL TECH LIMITED'),
      ('uk_companies_house', 'TABLE TEND LIMITED'),
      ('uk_companies_house', 'TAPPI TECHNOLOGIES LTD'),
      ('uk_companies_house', 'TAPPINN LTD'),
      ('uk_companies_house', 'TAYLOR MADE CONSULTANTS LIMITED'),
      ('uk_companies_house', 'TBX TECH LIMITED'),
      ('uk_companies_house', 'TCGPOS LTD'),
      ('uk_companies_house', 'TECHCORE IT SOLUTIONS LTD'),
      ('uk_companies_house', 'TESTAVELLE CONSULTING LTD'),
      ('uk_companies_house', 'THE FORMULA FATHER LTD'),
      ('uk_companies_house', 'THE NOSE VITALY LTD'),
      ('uk_companies_house', 'THE PLAIBOOK LTD'),
      ('uk_companies_house', 'THIRD COFFEE STUDIO LTD'),
      ('uk_companies_house', 'TOTAL UPTIME LTD'),
      ('uk_companies_house', 'TOZ INDUSTRIES LTD'),
      ('uk_companies_house', 'TPL INNOVATIONS LTD'),
      ('uk_companies_house', 'TRADEBUDDYS LTD'),
      ('uk_companies_house', 'TRAIN AI JOBS LTD'),
      ('uk_companies_house', 'TWI TECHNOLOGIES LTD'),
      ('uk_companies_house', 'TWIN PALM VENTURES LTD'),
      ('uk_companies_house', 'TWO PLUS THREE LIMITED'),
      ('uk_companies_house', 'UNIPEPT LTD'),
      ('uk_companies_house', 'UNOVIC STRATEGIC PARTNERS LIMITED'),
      ('uk_companies_house', 'VASST BUSINESS SYSTEMS LTD'),
      ('uk_companies_house', 'VERITAS CONNECT LTD'),
      ('uk_companies_house', 'VERTEXES LTD'),
      ('uk_companies_house', 'VERZESOFTWARE LIMITED'),
      ('uk_companies_house', 'VIBES TECHNOLOGIES LIMITED'),
      ('uk_companies_house', 'VIEWLESS LTD'),
      ('uk_companies_house', 'VILOREM LIMITED'),
      ('uk_companies_house', 'VIRTUE LABS LTD'),
      ('uk_companies_house', 'VISTARA GLOBAL LTD'),
      ('uk_companies_house', 'VIYU LTD'),
      ('uk_companies_house', 'VWI LTD'),
      ('uk_companies_house', 'WAGGY LIMITED'),
      ('uk_companies_house', 'WCLOUD LTD'),
      ('uk_companies_house', 'WEBONIQ LTD'),
      ('uk_companies_house', 'WHEAT APPLIED TECHNOLOGIES LTD'),
      ('uk_companies_house', 'WLTRS GROUP LTD'),
      ('uk_companies_house', 'WORK LESS EXPLORE MORE LTD'),
      ('uk_companies_house', 'WYNCORE LTD'),
      ('uk_companies_house', 'YD1L LABS LTD'),
      ('uk_companies_house', 'YGG GLOBAL LIMITED'),
      ('uk_companies_house', 'YOU DIED AGAIN GAMES LTD'),
      ('uk_companies_house', 'ZENFOR DIGITAL LTD')
  ),
  matched AS (
    SELECT DISTINCT f.startup_id AS id
      FROM raw_gov_filings f
      JOIN targets t ON t.source = f.source AND t.name = f.entity_name
     WHERE f.startup_id IS NOT NULL
  ),
  checked AS (
    SELECT m.id,
           s.created_at >= (SELECT min(x.ingested_at) FROM raw_gov_filings x WHERE x.startup_id = m.id) - interval '1 minute'
             AS engine_created,
           NOT EXISTS (SELECT 1 FROM raw_gov_filings x
                        WHERE x.startup_id = m.id
                          AND NOT EXISTS (SELECT 1 FROM targets t WHERE t.source = x.source AND t.name = x.entity_name))
             AS all_rejected,
           NOT EXISTS (SELECT 1 FROM watchlist_items w WHERE w.entity_type = 'startup' AND w.entity_id = m.id)
             AND NOT EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.startup_id = m.id)
             AS unused,
           NOT coalesce(s.is_manually_verified, false) AS unverified
      FROM matched m JOIN startups s ON s.id = m.id
  )
  SELECT array_agg(id) FILTER (WHERE engine_created AND all_rejected AND unused AND unverified),
         count(*),
         count(*) FILTER (WHERE NOT engine_created),
         count(*) FILTER (WHERE engine_created AND NOT all_rejected),
         count(*) FILTER (WHERE engine_created AND all_rejected AND NOT unused),
         count(*) FILTER (WHERE engine_created AND all_rejected AND unused AND NOT unverified)
    INTO v_ids, v_matched, v_not_new, v_mixed, v_used, v_verified
    FROM checked;

  v_ids := coalesce(v_ids, '{}');
  RAISE NOTICE 'gate cleanup: % companies matched the reject list; deleting %; kept: % existed before the engine, % have a passing filing, % used by someone, % manually verified',
    v_matched, cardinality(v_ids), v_not_new, v_mixed, v_used, v_verified;

  IF cardinality(v_ids) > 380 THEN
    RAISE EXCEPTION 'gate cleanup: % companies qualify, more than the % this verdict was generated for — regenerate it', cardinality(v_ids), 354;
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO deleted_startups_archive (id, name, row_data, reason)
  SELECT s.id, s.name, to_jsonb(s), 'quality gate reject (company-gate.ts), migration 20261015040000'
    FROM startups s WHERE s.id = ANY (v_ids);

  -- Competitor entries in other companies keep the name, lose the dangling id.
  UPDATE startups s
     SET competitors = (
           SELECT jsonb_agg(CASE WHEN e ? 'startup_id' AND (e->>'startup_id') = ANY (v_ids::text[]) THEN e - 'startup_id' ELSE e END)
             FROM jsonb_array_elements(s.competitors) e)
   WHERE jsonb_typeof(s.competitors) = 'array'
     AND NOT (s.id = ANY (v_ids))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.competitors) e WHERE (e->>'startup_id') = ANY (v_ids::text[]));
  GET DIAGNOSTICS v_refs = ROW_COUNT;

  DELETE FROM notifications WHERE dedupe_key = ANY (SELECT 'thesis_match:' || i::text FROM unnest(v_ids) i);
  DELETE FROM startups WHERE id = ANY (v_ids);

  RAISE NOTICE 'gate cleanup: deleted % companies (archived), cleared % competitor references', cardinality(v_ids), v_refs;
END
$$;

-- Search and lookalikes read the materialized view; drop the deleted rows from it now.
DO $$
BEGIN
  PERFORM refresh_startups_search();
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'refresh_startups_search() not found — the view refreshes on its own schedule';
END
$$;

SELECT count(*) AS archived_by_this_cleanup
  FROM deleted_startups_archive
 WHERE reason LIKE '%migration 20261015040000%';
