-- Seed 3 sample hours_log rows for the most-recently-created non-admin user.
-- Run in Supabase → SQL Editor (uses service role automatically there, so it
-- can write rows on behalf of the user without tripping RLS).
--
-- Dates are computed from current_date so they always fall in the last 30 days
-- and the Hours screen's year filter picks them up.

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from public.users
  where coalesce(is_admin, false) = false
  order by created_at desc
  limit 1;

  if v_user_id is null then
    raise exception 'No non-admin user found in public.users. Create a client account first, then re-run this seed.';
  end if;

  insert into public.hours_log (user_id, description, category, hours, activity_date) values
    (v_user_id, 'Walkthrough of Scottsdale duplex with property manager', 'Property Management', 3.5, current_date - 4),
    (v_user_id, 'Tenant meeting at Mesa rental — lease renewal discussion',  'Leasing',             1.5, current_date - 11),
    (v_user_id, 'Coordinated HVAC repair vendor for Tempe condo',           'Maintenance',          2.0, current_date - 22);
end $$;

-- Confirm: should print 3 rows for the seeded user.
select id, description, category, hours, activity_date
from public.hours_log
where user_id = (
  select id from public.users
  where coalesce(is_admin, false) = false
  order by created_at desc
  limit 1
)
order by activity_date desc;
