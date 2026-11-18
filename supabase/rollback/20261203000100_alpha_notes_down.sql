-- Rollback of 20261203000100_alpha_notes.sql. Drops every user's Journal notes — export first.
DROP TABLE IF EXISTS alpha_note_links;
DROP TABLE IF EXISTS alpha_notes;
