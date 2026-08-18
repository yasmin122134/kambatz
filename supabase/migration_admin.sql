-- Run once in Supabase → SQL Editor

alter table people add column if not exists is_admin boolean not null default false;

update people
set is_admin = true
where lower(email) = 'yasmin.haddad.yh.47@gmail.com'
   or name = 'יסמין חדד';
