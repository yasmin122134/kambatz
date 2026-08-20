-- Run once in Supabase → SQL Editor (after migration_mission_days.sql)

alter table mission_days
  add column if not exists scheduling_rules jsonb not null default '{
    "rest_hours": 7,
    "guard_ratio": 2,
    "board_start": "20:00",
    "shift_hours": 4
  }'::jsonb;

-- אם כבר הרצת גרסה קודמת עם משקלי כרמל — מעדכן למבנה החדש
update mission_days
set scheduling_rules = (scheduling_rules - 'standby_carmel_a_weight' - 'standby_carmel_b_weight')
  || '{"shift_hours": 4}'::jsonb
where scheduling_rules ? 'standby_carmel_a_weight'
   or scheduling_rules ? 'standby_carmel_b_weight';

update fairness_rules
set rules = rules || '{"standby_a": 0.45, "standby_b": 0.15}'::jsonb
where id = 1
  and not (rules ? 'standby_a');
