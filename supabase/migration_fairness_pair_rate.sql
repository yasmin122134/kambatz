-- Run once in Supabase → SQL Editor
-- שמירה בזוג: 0.9 נק׳ לשעת יום (במקום 1.0)

update fairness_rules
set
  rules = jsonb_set(rules, '{pair}', '0.9'::jsonb, true),
  updated_at = now()
where id = 1
  and coalesce((rules->>'pair')::numeric, 1) = 1;
