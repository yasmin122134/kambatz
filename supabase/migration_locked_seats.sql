-- Run once in Supabase → SQL Editor (after migration_mission_days.sql)

alter table mission_days
  add column if not exists locked_seats jsonb not null default '{}'::jsonb;
