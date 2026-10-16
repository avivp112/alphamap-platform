-- Rollback of 20261021000000_user_plans.sql. The app falls back to reading
-- the plan from user_metadata only if src/lib/plan.ts is reverted too.
DROP FUNCTION IF EXISTS set_user_plan(uuid, text);
DROP FUNCTION IF EXISTS request_plan_upgrade(text, boolean);
DROP TABLE IF EXISTS plan_requests;
DROP TABLE IF EXISTS user_plans;
