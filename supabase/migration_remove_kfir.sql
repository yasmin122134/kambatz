-- Remove כפיר אליה — no longer in the platoon.
-- Safe to re-run (no-op if already deleted).

delete from people
where lower(trim(email)) = 'kfirelya@gmail.com'
   or name in ('כפיר אליה', 'כפיר');
