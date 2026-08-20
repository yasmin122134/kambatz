-- Run once in Supabase → SQL Editor

create table if not exists mission_days (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  mission_type text not null
    check (mission_type in ('guards', 'base_work', 'kitchen')),
  mission_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  positions jsonb not null default '[]'::jsonb,
  assignments jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_days_date_idx on mission_days(mission_date desc);
create index if not exists mission_days_status_idx on mission_days(status);

alter table mission_days enable row level security;

create policy "mission_days_read" on mission_days for select using (true);
create policy "mission_days_insert" on mission_days for insert with check (true);
create policy "mission_days_update" on mission_days for update using (true);
create policy "mission_days_delete" on mission_days for delete using (true);
