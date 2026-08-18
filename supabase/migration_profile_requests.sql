-- Run once in Supabase → SQL Editor

create table if not exists profile_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete cascade,
  person_name text not null,
  km boolean not null default false,
  exam boolean not null default false,
  no_weapon boolean not null default false,
  no_guard boolean not null default false,
  no_mag boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists profile_requests_status_idx on profile_requests(status);
create index if not exists profile_requests_person_idx on profile_requests(person_id);

alter table profile_requests enable row level security;

create policy "profile_requests_read" on profile_requests for select using (true);
create policy "profile_requests_insert" on profile_requests for insert with check (true);
create policy "profile_requests_update" on profile_requests for update using (true);
