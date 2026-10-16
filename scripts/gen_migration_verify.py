#!/usr/bin/env python3
# Generates supabase/scripts/verify_migration_history.sql: one query that, for
# every migration file, checks whether the objects it creates (tables, views,
# functions, indexes, added columns, cron jobs) exist in the database. Used to
# baseline supabase_migrations.schema_migrations from evidence rather than
# memory, since this project's migrations were applied by hand in the SQL
# Editor before CI ran `supabase db push`.
#
#   python3 scripts/gen_migration_verify.py supabase/migrations > supabase/scripts/verify_migration_history.sql
import re, os, sys
mig_dir = sys.argv[1]
files = sorted(f for f in os.listdir(mig_dir) if f.endswith(".sql"))
ident = r'(?:"?[A-Za-z_][\w]*"?\.)?"?([A-Za-z_][\w]*)"?'
def strip_comments(s):
    s = re.sub(r'--[^\n]*', '', s)
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)
rows = []
for f in files:
    v = f.split("_")[0]
    s = strip_comments(open(os.path.join(mig_dir, f)).read())
    checks = set()
    for m in re.finditer(r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][\w]*)"?\s*\(', s, re.I):
        checks.add(("table", m.group(1).lower(), ""))
    for m in re.finditer(r'create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][\w]*)"?', s, re.I):
        checks.add(("table", m.group(1).lower(), ""))
    for m in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][\w]*)"?\s*\(', s, re.I):
        checks.add(("function", m.group(1).lower(), ""))
    for m in re.finditer(r'create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][\w]*)"?\s+on', s, re.I):
        checks.add(("index", m.group(1).lower(), ""))
    for m in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_][\w]*)"?(.*?);', s, re.I | re.S):
        t = m.group(1).lower()
        for c in re.finditer(r'add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][\w]*)"?', m.group(2), re.I):
            checks.add(("column", t, c.group(1).lower()))
    for m in re.finditer(r"cron\.schedule\(\s*'([^']+)'", s, re.I):
        checks.add(("cron", m.group(1), ""))
    rows.append((v, f, sorted(checks)))
q = lambda x: "'" + x.replace("'", "''") + "'"
vals = []
SEP = ",\n"
for v, f, cs in rows:
    if not cs:
        vals.append(f"({q(v)},{q(f)},'none','','')")
    for k, a, b in cs:
        vals.append(f"({q(v)},{q(f)},{q(k)},{q(a)},{q(b)})")
sql = f"""-- Which migrations are really applied? One row per migration file.
-- verified = every object it creates exists; missing = lists what is absent;
-- no_checks = it creates nothing checkable (data fixes, grants, drops).
WITH c(version, file, kind, a, b) AS (VALUES
{SEP.join(vals)}
),
r AS (
  SELECT c.*, CASE kind
    WHEN 'table'    THEN to_regclass('public.' || quote_ident(a)) IS NOT NULL
    WHEN 'index'    THEN to_regclass('public.' || quote_ident(a)) IS NOT NULL
    WHEN 'function' THEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                  WHERE p.proname = a AND n.nspname = 'public')
    WHEN 'column'   THEN EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema = 'public' AND table_name = a AND column_name = b)
    WHEN 'cron'     THEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = a)
    ELSE NULL END AS ok
  FROM c
)
SELECT version,
       CASE WHEN bool_and(kind = 'none') THEN 'no_checks'
            WHEN bool_and(ok) THEN 'verified'
            ELSE 'missing' END AS status,
       count(*) FILTER (WHERE kind <> 'none') AS checks,
       string_agg(CASE WHEN ok = false THEN kind || ':' || a || CASE WHEN b <> '' THEN '.' || b ELSE '' END END, ', ') AS missing,
       min(file) AS file
FROM r
GROUP BY version
ORDER BY (CASE WHEN bool_and(kind = 'none') THEN 1 WHEN bool_and(ok) THEN 2 ELSE 0 END), version;
"""
print(sql)
sys.stderr.write(f"{len(rows)} migrations, {sum(1 for r in rows if not r[2])} with no checks, {sum(len(r[2]) for r in rows)} checks\n")
for v,f,cs in rows:
    if not cs: sys.stderr.write(f"  no_checks: {f}\n")
