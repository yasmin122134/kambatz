-- Run once in Supabase → SQL Editor (after migration_scheduler.sql)

alter table people
  add column if not exists squad smallint check (squad is null or (squad >= 1 and squad <= 4));

comment on column people.squad is 'צוות 1–4 — לשיבוץ מטבח (מנוחה אחת לצוות ביום)';
