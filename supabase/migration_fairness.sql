-- Run once in Supabase → SQL Editor

create table if not exists fairness_rules (
  id int primary key default 1 check (id = 1),
  rules jsonb not null default '{
    "solo": 1.5,
    "pair": 1.0,
    "standby": 0.15,
    "standby_a": 0.45,
    "standby_b": 0.15,
    "duty": 0.1,
    "kitchen": 0.1,
    "hist": 0.7,
    "guard_hours_factor": 1,
    "guard_bands": [
      {"solo": 10, "paired": 8},
      {"solo": 9, "paired": 7},
      {"solo": 7, "paired": 5},
      {"solo": 8, "paired": 6},
      {"solo": 7, "paired": 5},
      {"solo": 8, "paired": 6}
    ],
    "rest_penalties": [0, 1, 2, 3, 4, 5, 6, 7, 8]
  }'::jsonb,
  updated_at timestamptz not null default now()
);

insert into fairness_rules (id, rules) values (1, '{
  "solo": 1.5,
  "pair": 1.0,
  "standby": 0.15,
  "standby_a": 0.45,
  "standby_b": 0.15,
  "duty": 0.1,
  "kitchen": 0.1,
  "hist": 0.7,
  "guard_hours_factor": 1,
  "guard_bands": [
    {"solo": 10, "paired": 8},
    {"solo": 9, "paired": 7},
    {"solo": 7, "paired": 5},
    {"solo": 8, "paired": 6},
    {"solo": 7, "paired": 5},
    {"solo": 8, "paired": 6}
  ],
  "rest_penalties": [0, 1, 2, 3, 4, 5, 6, 7, 8]
}'::jsonb)
on conflict (id) do nothing;

create table if not exists fairness_rule_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete set null,
  person_name text not null,
  proposed_rules jsonb not null,
  note text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists fairness_rule_requests_status_idx
  on fairness_rule_requests(status);

alter table fairness_rules enable row level security;
alter table fairness_rule_requests enable row level security;

create policy "fairness_rules_read" on fairness_rules for select using (true);
create policy "fairness_rules_write" on fairness_rules for insert with check (true);
create policy "fairness_rules_update" on fairness_rules for update using (true);

create policy "fairness_rule_requests_read" on fairness_rule_requests for select using (true);
create policy "fairness_rule_requests_insert" on fairness_rule_requests for insert with check (true);
create policy "fairness_rule_requests_update" on fairness_rule_requests for update using (true);
