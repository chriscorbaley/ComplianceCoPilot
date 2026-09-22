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
```

There is no `supabase functions schedule` subcommand — scheduling an edge
function is a database concern (pg_cron + pg_net), not a CLI one. Copy the
pattern in `process_deletions_schedule.sql`, swapping the function name and
using the cron expression `0 9 * * *`. rss-scanner is currently **not
deployed and not scheduled**.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by
the Supabase runtime. The function records every processed item's GUID in
`processed_rss_items` so it never re-analyzes the same article.

## Edge function — revenuecat-webhook

Keeps `users.subscription_tier` / `users.subscription_status` in sync with
native App Store and Play Store subscriptions.

This consumes **RevenueCat's** webhook rather than Apple's raw App Store Server
Notifications V2. RevenueCat normalizes Apple, Google and Stripe into one
payload, so a single function covers every store; its `app_user_id` is already
our `public.users.id` (set by `identifyRevenueCatUser()` in `App.tsx`); and it
authenticates with a shared header / HMAC instead of Apple's JWS x5c
certificate-chain verification.

Apply the migration first, or every delivery 500s:

```sql
-- SQL Editor → paste supabase/revenuecat_webhook.sql → Run
```

Then set secrets and deploy. **`--no-verify-jwt` is required** — RevenueCat
does not send a Supabase JWT:

```bash
supabase secrets set REVENUECAT_WEBHOOK_AUTH='<random string>'
# optional, if you enable signature signing in the RevenueCat dashboard:
supabase secrets set REVENUECAT_WEBHOOK_SIGNING_SECRET='<signing secret>'
supabase functions deploy revenuecat-webhook --no-verify-jwt
```

In RevenueCat → Integrations → Webhooks, set the URL to
`https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook` and the
Authorization header to the same value as `REVENUECAT_WEBHOOK_AUTH`. Use the
dashboard's "Send test event" to confirm a 200.

Optional secrets:

- `REVENUECAT_IGNORE_SANDBOX=true` — skip `environment=SANDBOX` events. Leave
  unset while testing; **set it before public launch** so sandbox purchases
  can't move production tiers.
- `REVENUECAT_REVOKE_ON_BILLING_ISSUE=true` — downgrade immediately on
  `BILLING_ISSUE`. Off by default: a billing issue starts the store's retry and
  grace period, during which the customer still holds the entitlement, and
  `EXPIRATION` fires if the retries are exhausted. Turning this on locks out
  paying customers who recover from a declined card.

Every processed notification is written to `admin_audit_log` with
`action = 'apple_subscription_event'`, `admin_email = 'revenuecat-webhook
(system)'` and an `outcome` inside `new_value`.

Event-name mapping, since RevenueCat's names differ from Apple's:

| Apple ASSN V2 | RevenueCat |
| --- | --- |
| `REFUND` | `CANCELLATION` with `cancel_reason = CUSTOMER_SUPPORT` |
| `DID_RENEW` | `RENEWAL` |
| `EXPIRED` | `EXPIRATION` |
| `DID_FAIL_TO_RENEW` | `BILLING_ISSUE` |
| `CANCEL` | `CANCELLATION` with `cancel_reason = UNSUBSCRIBE` |

There is no standalone `REFUND` event type in RevenueCat. Note also that
`CANCELLATION` is not revocation — Apple and Google subscriptions stay usable
until the paid period ends, so the function marks the status `cancelled` but
keeps the tier until `EXPIRATION` arrives. The one exception is a store-issued
refund, which revokes immediately.

## Notes

- `users.travel_days_count_as_business` is not stored in `compliance_rules`. The
  deductibility engine treats it as `true` by default. If you want to make it
  configurable, add a row to `compliance_rules` and read it in
  `src/services/complianceRules.ts`.
- Realtime is enabled for the full admin-config surface: `compliance_rules`,
  `regulatory_alerts`, `strategies`, `document_templates`, `form_fields`,
  `alert_messages`, `irc_references`, and `announcements`.
