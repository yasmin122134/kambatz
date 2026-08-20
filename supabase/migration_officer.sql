-- Run once in Supabase → SQL Editor (after migration_scheduler.sql)

alter table people add column if not exists is_officer boolean not null default false;

comment on column people.is_officer is 'קצין תורן — זכאי לתפקיד קצין תורן ביום שמירות';
