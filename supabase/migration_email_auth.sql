-- Run once in Supabase → SQL Editor (after schema.sql + migration_scheduler.sql)

alter table people add column if not exists email text;
alter table people add column if not exists auth_user_id uuid unique;

create unique index if not exists people_email_unique_idx
  on people (lower(email))
  where email is not null;

create index if not exists people_auth_user_idx on people (auth_user_id);
