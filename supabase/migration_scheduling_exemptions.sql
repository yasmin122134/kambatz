-- Run once in Supabase → SQL Editor (after migration_scheduler.sql)

alter table people add column if not exists no_standby boolean not null default false;
alter table people add column if not exists no_standing boolean not null default false;
alter table people add column if not exists no_base_work boolean not null default false;
alter table people add column if not exists no_kitchen boolean not null default false;

comment on column people.no_standby is 'פטור מכוננות — כרמל א׳/ב׳';
comment on column people.no_standing is 'פטור עמידה — שיבוץ לתצפיתן בלבד';
comment on column people.no_base_work is 'פטור מעב״ס';
comment on column people.no_kitchen is 'פטור מטבח';

alter table profile_requests add column if not exists no_standby boolean not null default false;
alter table profile_requests add column if not exists no_standing boolean not null default false;
alter table profile_requests add column if not exists no_base_work boolean not null default false;
alter table profile_requests add column if not exists no_kitchen boolean not null default false;
