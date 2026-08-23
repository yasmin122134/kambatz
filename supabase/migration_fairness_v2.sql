-- Update published fairness rules to match shift_points_and_rest_penalties document.
-- Run in Supabase SQL Editor after migration_fairness.sql.

update fairness_rules
set rules = jsonb_set(
  jsonb_set(
    rules,
    '{guard_hours_factor}',
    '1'::jsonb
  ),
  '{guard_bands}',
  '[
    {"solo": 10, "paired": 8},
    {"solo": 9, "paired": 7},
    {"solo": 7, "paired": 5},
    {"solo": 8, "paired": 6},
    {"solo": 7, "paired": 5},
    {"solo": 8, "paired": 6}
  ]'::jsonb
)
where id = 1;

update fairness_rules
set rules = jsonb_set(
  rules,
  '{rest_penalties}',
  '[0, 1, 2, 3, 4, 5, 6, 7, 8]'::jsonb
)
where id = 1;

update fairness_rules set updated_at = now() where id = 1;
