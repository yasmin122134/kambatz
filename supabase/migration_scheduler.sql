-- Run once in Supabase → SQL Editor (after initial schema.sql)

alter table people add column if not exists km boolean not null default false;
alter table people add column if not exists exam boolean not null default false;
alter table people add column if not exists no_weapon boolean not null default false;
alter table people add column if not exists no_guard boolean not null default false;
alter table people add column if not exists no_mag boolean not null default false;
alter table people add column if not exists prior_score numeric not null default 0;

create table if not exists scheduler_state (
  id int primary key default 1 check (id = 1),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into scheduler_state (id, state) values (1, '{}'::jsonb)
on conflict (id) do nothing;

alter table scheduler_state enable row level security;

drop policy if exists "scheduler_state_read" on scheduler_state;
drop policy if exists "scheduler_state_write" on scheduler_state;
drop policy if exists "scheduler_state_update" on scheduler_state;

create policy "scheduler_state_read" on scheduler_state for select using (true);
create policy "scheduler_state_write" on scheduler_state for insert with check (true);
create policy "scheduler_state_update" on scheduler_state for update using (true);
