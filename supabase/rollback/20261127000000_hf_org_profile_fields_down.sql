-- Rollback of 20261127000000: the columns stay (harmless); restore the 9-argument record_hf_org_profile from 20261126000000 by re-running that file.
DROP FUNCTION IF EXISTS record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean,text,integer,boolean);
