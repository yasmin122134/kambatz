-- Run once in Supabase → SQL Editor (after migration_scheduler.sql)

alter table people add column if not exists is_officer boolean not null default false;

comment on column people.is_officer is 'קצין תורן — זכאי לתפקיד קצין תורן ביום שמירות; שקול להרשאות מנהל';

-- רק רני פלג ויסמין חדד — קצינים תורנים ומנהלות האתר
update people
set is_officer = true,
    is_admin = true
where name in ('רני פלג', 'יסמין חדד')
   or lower(email) in (
     'rani.peleg.47@gmail.com',
     'yasmin.haddad.yh.47@gmail.com'
   );

-- ודא שאף אחר לא מסומן בטעות
update people
set is_officer = false
where is_officer = true
  and name not in ('רני פלג', 'יסמין חדד')
  and lower(coalesce(email, '')) not in (
    'rani.peleg.47@gmail.com',
    'yasmin.haddad.yh.47@gmail.com'
  );
