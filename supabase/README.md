# Supabase schema

`schema.sql` is the single source of truth.

## Apply it

Easiest path:

1. Supabase dashboard → SQL Editor → New query
2. Paste the entire contents of `schema.sql` → Run

CLI path (if you have `supabase`):

```bash
supabase link --project-ref hlmyalvpioddkrnbvguz
supabase db push        # or: psql ... < schema.sql
```

The script is idempotent — re-running it is safe. Every CREATE uses
`IF NOT EXISTS`, every policy is dropped before being recreated, and the seed
uses `ON CONFLICT DO NOTHING`.

## Promoting an admin

There's no admin UI. To grant a user the `is_admin` flag (which unlocks
`compliance_rules` writes and the `regulatory_alerts` table), run in the SQL
Editor while logged in as an admin or via the service role:

```sql
update public.users set is_admin = true where email = 'you@example.com';
```

## Edge function — rss-scanner

Daily job that pulls IRS / TaxCourt / Congress RSS feeds, asks GPT-4-turbo
whether each new item affects any of the firm's tax strategies, and inserts
non-null impact analyses into `regulatory_alerts` with
`status = 'pending_review'`. The admin inbox subscribes to that table in
realtime, so the inbox badge updates without polling.

Set secrets, then deploy and schedule:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy rss-scanner
supabase functions schedule create rss-scanner --cron "0 9 * * *"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by
the Supabase runtime. The function records every processed item's GUID in
`processed_rss_items` so it never re-analyzes the same article.

## Notes

- `users.travel_days_count_as_business` is not stored in `compliance_rules`. The
  deductibility engine treats it as `true` by default. If you want to make it
  configurable, add a row to `compliance_rules` and read it in
  `src/services/complianceRules.ts`.
- Realtime is enabled for the full admin-config surface: `compliance_rules`,
  `regulatory_alerts`, `strategies`, `document_templates`, `form_fields`,
  `alert_messages`, `irc_references`, and `announcements`.
