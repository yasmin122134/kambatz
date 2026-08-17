-- Run this in Supabase SQL Editor (Dashboard → SQL → New query)

create extension if not exists "pgcrypto";

-- Cadets in the cycle
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  room text,
  gender text check (gender in ('m', 'f')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cadet-submitted unavailability / constraints
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete set null,
  person_name text not null,
  start_time text not null,  -- HH:MM on the 24h board
  end_time text not null,
  issue_type text not null check (issue_type in ('exam', 'trial', 'medical', 'weapon', 'other')),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists issues_status_idx on issues(status);
create index if not exists issues_created_idx on issues(created_at desc);

-- Row Level Security: public read/write for small trusted unit (60 people)
-- Tighten later with Supabase Auth if needed.
alter table people enable row level security;
alter table issues enable row level security;

create policy "people_read" on people for select using (true);
create policy "people_write" on people for insert with check (true);
create policy "people_update" on people for update using (true);
create policy "people_delete" on people for delete using (true);

create policy "issues_read" on issues for select using (true);
create policy "issues_insert" on issues for insert with check (true);
create policy "issues_update" on issues for update using (true);
create policy "issues_delete" on issues for delete using (true);
