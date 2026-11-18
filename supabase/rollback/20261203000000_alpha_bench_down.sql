-- Rollback of 20261203000000_alpha_bench.sql. Drops every user's Bench — export first.
DROP TRIGGER IF EXISTS alpha_bench_cap ON alpha_bench;
DROP TRIGGER IF EXISTS trg_alpha_bench_touch ON alpha_bench;
DROP TABLE IF EXISTS alpha_bench;
DROP FUNCTION IF EXISTS alpha_bench_cap();
