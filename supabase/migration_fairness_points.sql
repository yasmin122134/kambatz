-- Run once in Supabase → SQL Editor (after migration_mission_days.sql)

create table if not exists fairness_assignment_points (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  mission_id uuid not null references mission_days(id) on delete cascade,
  slot_id text not null,
  mission_date date not null,
  mission_title text not null,
  mission_type text not null,
  position_name text not null,
  time_label text not null,
  hours numeric not null default 0,
  bucket text not null,
  points numeric not null default 0,
  burden_base numeric,
  burden_rest numeric,
  burden_is_solo boolean,
  computed_at timestamptz not null default now(),
  unique (mission_id, slot_id, person_name)
);

create index if not exists fairness_assignment_points_person_idx
  on fairness_assignment_points (person_name, mission_date desc);

create index if not exists fairness_assignment_points_mission_idx
  on fairness_assignment_points (mission_id);

alter table fairness_assignment_points enable row level security;

drop policy if exists "fairness_points_read" on fairness_assignment_points;
drop policy if exists "fairness_points_write" on fairness_assignment_points;
drop policy if exists "fairness_points_update" on fairness_assignment_points;
drop policy if exists "fairness_points_delete" on fairness_assignment_points;

create policy "fairness_points_read" on fairness_assignment_points for select using (true);
create policy "fairness_points_write" on fairness_assignment_points for insert with check (true);
create policy "fairness_points_update" on fairness_assignment_points for update using (true);
create policy "fairness_points_delete" on fairness_assignment_points for delete using (true);
