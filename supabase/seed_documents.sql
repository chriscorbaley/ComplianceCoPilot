-- Seed 6 sample documents — one per strategy_category — for the most-recently
-- created non-admin user. Run in Supabase → SQL Editor (service role bypasses
-- RLS there, so it can write rows on behalf of the user).
--
-- created_at is staggered so the Documents list has a deterministic order.

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

  insert into public.documents (user_id, name, strategy_category, file_type, file_url, created_at) values
    (v_user_id, 'Augusta Rule rental agreement 2025',          'augusta_rule',      'pdf', null, now() - interval '1 day'),
    (v_user_id, 'Material participation hours log Q1-Q3',      'real_estate',       'pdf', null, now() - interval '2 days'),
    (v_user_id, 'S-Corp reasonable compensation analysis',     's_corp',            'pdf', null, now() - interval '3 days'),
    (v_user_id, 'Business trip log — full year 2025',          'business_travel',   'pdf', null, now() - interval '4 days'),
    (v_user_id, 'Home office square footage verification',     'home_office',       'pdf', null, now() - interval '5 days'),
    (v_user_id, 'Family management company agreement',         'family_management', 'pdf', null, now() - interval '6 days');
end $$;

-- Confirm: should print 6 rows for the seeded user.
select id, name, strategy_category, file_type, created_at
from public.documents
where user_id = (
  select id from public.users
  where coalesce(is_admin, false) = false
  order by created_at desc
  limit 1
)
order by created_at desc;
