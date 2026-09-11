-- Manual fairness point overrides (admin edits on person profile)
-- Run after migration_fairness_points.sql

alter table fairness_assignment_points
  add column if not exists manual_override boolean not null default false;

create index if not exists fairness_assignment_points_manual_idx
  on fairness_assignment_points (person_name)
  where manual_override = true;
