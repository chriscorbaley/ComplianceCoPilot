-- Remove the obsolete augusta_activities table.
--
-- Augusta Rule activities are now logged through the shared minutes pipeline
-- and live entirely in public.meeting_minutes (meeting_type = 'augusta_rule')
-- and public.documents (file_type = 'minutes'). The standalone
-- augusta_activities table created by an earlier iteration is no longer read or
-- written by the app, so it is dropped here.
--
-- Run this against your Supabase project (SQL editor or `supabase db` / psql).

drop table if exists public.augusta_activities;
