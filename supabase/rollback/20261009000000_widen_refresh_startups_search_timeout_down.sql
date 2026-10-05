-- Rollback: revert service_role to inheriting whatever statement_timeout
-- the database/cluster default provides.

ALTER ROLE service_role RESET statement_timeout;
