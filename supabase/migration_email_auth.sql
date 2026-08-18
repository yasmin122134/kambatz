-- Run once in Supabase → SQL Editor (combines email + admin setup)

-- Emails for Google login matching
alter table people add column if not exists email text;
alter table people add column if not exists auth_user_id uuid unique;

create unique index if not exists people_email_unique_idx
  on people (lower(email))
  where email is not null;

create index if not exists people_auth_user_idx on people (auth_user_id);

-- Admin flag
alter table people add column if not exists is_admin boolean not null default false;

-- יסמין חדד — מנהלת
update people
set is_admin = true
where lower(email) = 'yasmin.haddad.yh.47@gmail.com'
   or name = 'יסמין חדד';

-- After this: Admin → "סנכרן מיילים מהדוק" to fill all 53 emails
