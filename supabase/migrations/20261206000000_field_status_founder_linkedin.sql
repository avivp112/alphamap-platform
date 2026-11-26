-- The founder's LinkedIn link is a core field of tier 2 (owner, 2026-11-24): audited and shown in the pilot like the others (150 random audited values above 95%).
insert into public.field_status (field, tier) values ('founder_linkedin', 2) on conflict (field) do nothing;
