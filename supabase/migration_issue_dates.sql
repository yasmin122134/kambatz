-- Constraints apply to a specific calendar date, not every day at that hour.
alter table issues add column if not exists constraint_date date;

update issues
set constraint_date = (created_at at time zone 'Asia/Jerusalem')::date
where constraint_date is null;

alter table issues alter column constraint_date set not null;

create index if not exists issues_constraint_date_idx on issues(constraint_date);
