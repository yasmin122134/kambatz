-- Run once in Supabase → SQL Editor (after migration_mission_days.sql)

alter table mission_days
  add column if not exists scheduling_rules jsonb not null default '{
    "rest_hours": 7,
    "guard_ratio": 2,
    "board_start": "20:00",
    "standby_carmel_a_weight": 0.45,
    "standby_carmel_b_weight": 0.15
  }'::jsonb;

-- Extend published fairness defaults for Carmel A/B (optional — app falls back if missing)
update fairness_rules
set rules = rules || '{"standby_a": 0.45, "standby_b": 0.15}'::jsonb
where id = 1
  and not (rules ? 'standby_a');
