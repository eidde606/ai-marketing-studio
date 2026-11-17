# Backend

## Setup

From the project root, create and activate a Python virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

On Windows:

```powershell
.venv\Scripts\Activate.ps1
```

Install the backend requirements:

```bash
python -m pip install -r backend/requirements.txt
```

## Run the server

For local development, use the guarded launchers below. Do not launch Uvicorn
directly: `backend/.env` contains the production database configuration, while
the local launchers explicitly load and verify the isolated development target.

## Isolated local PostgreSQL development

The development database is `ai_marketing_studio_dev` on the existing local
Postgres.app server (`localhost:5432`). It is owned by a dedicated non-superuser
role with a generated SCRAM password. The new database starts empty; no
production data is copied. A narrow `pg_hba.conf` rule requires SCRAM only for
this database/role on IPv4 and IPv6 loopback. Existing databases and roles keep
their prior authentication rules.

The connection string and local-only feature overrides are stored in the
Git-ignored, owner-only `backend/.env.development.local`. Do not copy it into
`backend/.env` or commit it. The launcher loads that file so its database URL
overrides the production `DATABASE_URL`, and refuses to migrate or start unless
both the configured URL and the connected server confirm the expected local
database, role, and port:

```bash
bash backend/dev.sh verify
bash backend/dev.sh current
bash backend/dev.sh migrate
bash backend/dev.sh current
bash backend/dev.sh serve
```

`verify` is read-only. `migrate` applies Alembic `head` only after verifying the
connection; `current` reports the verified target's Alembic revision. `serve`
starts FastAPI bound to `127.0.0.1:8001` by default and performs the same
connection check first. Run `migrate` once for a fresh local database, then use
`serve`.

### Isolated local Supabase authentication

Local development uses the separate Supabase project
`https://jcktibvwgyijdckvcdno.supabase.co`; it does not use or modify the
production Supabase project. After verifying the local database and the
development project's public JWKS endpoint, enter its publishable key at the
hidden terminal prompt:

```bash
bash backend/configure_dev_supabase.sh
```

The script writes the development URL and key only to the Git-ignored backend
and frontend development env files, sets both to mode `0600`, and enables public
registration, trials, and the Google sign-in option only in the local backend
file. It never prints the key. The backend launcher refuses to serve unless the
database and Supabase URL/key target the expected local development resources.
Vite likewise refuses to start unless its Supabase URL, publishable key, and
FastAPI URL are the expected development values.

Start the applications in separate terminals from the repository root:

```bash
bash backend/dev.sh serve
bash frontend/dev.sh
```

FastAPI is bound to `127.0.0.1:8001`; Vite is bound to `127.0.0.1:5173`.
Registration and trials remain disabled in production and Render. These local
settings do not create or alter any Supabase accounts; test registration only
with isolated development identities.

## Health check

The server provides:

```text
GET /health
```

Check it locally at:

```text
http://127.0.0.1:8001/health
```

A healthy response is:

```json
{"status":"healthy"}
```

## Customer registration and OAuth

`PUBLIC_REGISTRATION_ENABLED` and `TRIALS_ENABLED` are fail-closed and default
to `false`. The local configuration helper enables them only in the ignored
development file after its database and Supabase-project checks. Registration
requires the development `SUPABASE_PUBLISHABLE_KEY` so the backend verifies
the Supabase user's confirmed email through Auth. Never use a service-role key
for this check.

The local helper enables the Google sign-in option only in development. To make
Google OAuth work, configure the Google provider in the development Supabase
dashboard and allow `http://127.0.0.1:5173` as a Supabase Auth redirect URL
(also allow `http://localhost:5173` if using that origin). In Google Cloud,
create/use a Web application OAuth client and add this exact Authorized
redirect URI:

```text
https://jcktibvwgyijdckvcdno.supabase.co/auth/v1/callback
```

Enter that client's ID and secret in the development Supabase project's
Authentication → Providers → Google settings. Do not reuse the production
Supabase callback or OAuth credentials. The application uses Supabase Auth for
provider redirects and session handling; it does not store passwords or link
accounts based on matching email addresses.

## Social account connections and publishing

Social OAuth is disabled until the corresponding provider app is configured.
The development launcher intentionally removes inherited Meta and TikTok
credentials. Use a provider development/test app and place its settings only in
the ignored `backend/.env.development.local`; do not copy production credentials
or values into the frontend environment.

For Meta, configure the app's Facebook Login for Business configuration with
the required Page permissions: `pages_show_list`, `pages_read_engagement`, and
`pages_manage_posts` for Facebook publishing. Set `FACEBOOK_APP_ID`,
`FACEBOOK_APP_SECRET`, `FACEBOOK_CONFIG_ID`, and `FACEBOOK_REDIRECT_URI`.
Register the exact value of `FACEBOOK_REDIRECT_URI` in the Meta app's Valid
OAuth Redirect URIs; its path must be `/auth/facebook/callback`. The redirect
is environment-configured, not hard-coded.
Facebook publishing is deliberately blocked if more than one Page is connected
to the business; disconnect extras so the intended Page is unambiguous.

Instagram currently uses the Facebook Login/Page relationship flow, not
Instagram Login. The business must first connect a Facebook Page that is linked
to an Instagram **professional** account (Business or Creator). Keep exactly
one Facebook Page connected to that business so the linked Page is unambiguous.
Set `INSTAGRAM_CONFIG_ID` and `INSTAGRAM_REDIRECT_URI` and register that exact
redirect in the same Meta app; its path must be `/auth/instagram/callback`.
The Login for Business configuration must grant `instagram_basic`,
`instagram_content_publish`, `pages_show_list`, and `pages_read_engagement` to
report a fully authorized connection. Without the content-publish permission,
the linked professional account is reported as missing permission. Instagram
publishing is not implemented and remains unavailable; the permission does
not enable publishing in this application.

For a one-time local OAuth diagnosis, the callback can report sanitized Meta
token and Page-list metadata. In `backend/.env.development.local`, temporarily
set `INSTAGRAM_OAUTH_DIAGNOSTICS_ENABLED=true`, then start the backend with
`bash backend/dev.sh serve` and complete one local Instagram OAuth attempt.
Remove the setting (or set it to `false`) and restart the backend immediately
afterward. The diagnostic is disabled by default and refuses to run unless the
development environment and isolated local PostgreSQL target are verified; do
not enable it in production.

For TikTok, configure Login Kit and the Content Posting API in the TikTok
developer portal. Set `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and
`TIKTOK_REDIRECT_URI`; register the exact redirect with path
`/api/integrations/tiktok/callback`. `user.info.basic` is requested for account
discovery. `video.publish` is requested only when
`TIKTOK_DIRECT_PUBLISHING_ENABLED=1`. Direct posting remains disabled by
default and must not be enabled until the app has the required Content Posting
API permissions and TikTok audit/approval. Without that approval, use manual
export; connection alone does not mean direct posting is available.

Set `FRONTEND_BASE_URL` to the exact UI origin for Facebook/Instagram callback
results. TikTok uses `TIKTOK_FRONTEND_REDIRECT_URL` (or `FRONTEND_BASE_URL` as
fallback). Development may use the guarded local UI/API origins; deployed
origins must use HTTPS. Adding an app to Live mode, requesting Advanced Access,
or completing either provider's review is an owner action in the provider
dashboard and is not performed by this code.

OAuth callback state is short-lived, single-use, and bound to the initiating
user and business. Tokens are encrypted at rest and account management is
Owner/Admin-only. Disconnect removes credentials from this business in AI
Marketing Studio, but does not revoke the provider-wide app grant; the user
must separately remove the app from Meta's or TikTok's connected-app settings
to revoke that grant. Automated tests use mocked providers and do not verify
live authorization or publishing.

## Stripe test-mode billing

Billing is disabled unless `STRIPE_SECRET_KEY` is a test-mode `sk_test_` key,
`STRIPE_MONTHLY_PRICE_ID` references an active monthly Stripe Price
(`interval=month`, `interval_count=1`), and the webhook endpoint has its
`STRIPE_WEBHOOK_SECRET`. Set `FRONTEND_BASE_URL` to the local UI origin. Optional
`STRIPE_MONTHLY_PLAN_NAME` and `STRIPE_MONTHLY_PRICE_DISPLAY` control the plan
label shown in the Billing page; the server's Price lookup remains authoritative
for Checkout. `STRIPE_MONTHLY_LIMITS_JSON` can override the limit keys `businesses`,
`leo_generations`, `sofia_requests`, `edian_analyses`, `campaigns`, and
`heygen_generations`. Existing configurations may omit `edian_analyses`; the
default allowance is applied for that new metric.

Configure a Stripe **test-mode** webhook at `/webhooks/stripe` for
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, and
`invoice.payment_failed`. The endpoint accepts only signed test-mode events and
records event IDs transactionally with entitlement changes. The Billing page
never receives the Stripe secret key; Checkout and the Customer Portal return
only validated Stripe-hosted URLs. No live payments are enabled.

## Public contact form

The public `POST /public/contact` endpoint sends support requests by SMTP only
when the following settings are explicitly configured: `SUPPORT_EMAIL_TO`,
`SUPPORT_EMAIL_FROM`, and `SUPPORT_SMTP_HOST`. `SUPPORT_SMTP_PORT` defaults
to `587`. Optional
`SUPPORT_SMTP_USERNAME` and `SUPPORT_SMTP_PASSWORD` must be set together.
`SUPPORT_SMTP_STARTTLS` defaults to `true`; set `SUPPORT_SMTP_USE_SSL=true` for
an SSL/TLS SMTP endpoint. No support mailbox is assumed. The endpoint returns
unavailable until delivery is configured.

The form rejects a honeypot field and applies an in-memory limit of five
requests per client address per hour. This limit is per application process,
not shared across multiple workers or instances; production deployments with
multiple workers should add a shared rate-limit store before relying on it as
the only abuse control. Requests are sent to the configured mailbox and are
not separately persisted by the application.

## Edian analytics allowance

The authenticated `POST /businesses/{business_id}/analytics/edian` endpoint
accepts a locale (`en` or `es`) and required caller idempotency key.
Edian can interpret only the available Facebook engagement metrics, sampling
at most 10 confirmed published posts per analysis. The default allowance is
5 analyses per 14-day trial and 25 per monthly billing period, shared across
the customer's businesses and configurable with `TRIAL_LIMITS_JSON` and
`STRIPE_MONTHLY_LIMITS_JSON`. There is no pricing change. Analysis runs only
after a customer explicitly requests it; entitlement and usage are reserved
before OpenAI is called. Results are cached per business, locale, and unchanged
metric snapshot, while durable idempotency and an in-progress record prevent
repeat or concurrent OpenAI analysis of the same data. The allowance counts
provider attempts whose outcome may have incurred cost; failures before the
provider call release the reservation.

Alembic revision `d23e4c8a9f10` adds the distinct `edian_analysis` usage metric
and tenant-scoped result cache. Do not apply it without explicit approval for
the target environment.

Migration `f4bca7d20e19` adds tenant-bound Stripe IDs, billing-period fields, and
the webhook idempotency ledger. Test it on a disposable local database before
applying it to any persistent environment.

## Campaign management

Campaign endpoints require a verified Supabase identity with an active
application account and an authorized membership in the selected business.
Every route is scoped to a business; draft associations must belong to that same
business.

Base path: `/businesses/{business_id}/campaigns`

| Method | Path | Action |
| --- | --- | --- |
| GET | Base path | List campaigns, statistics and associated content |
| POST | Base path | Create a campaign |
| GET | `/{campaign_id}` | View a campaign |
| PATCH | `/{campaign_id}` | Edit fields or change status |
| PATCH | `/{campaign_id}/drafts/{draft_id}` | Associate an existing draft |
| DELETE | `/{campaign_id}/drafts/{draft_id}` | Remove the association only |

Campaigns require `name` and `objective`; `status` defaults to `draft` and also
accepts `active`, `paused`, `completed`, and `archived`. Optional `start_date` and
`end_date` use `YYYY-MM-DD`; PATCH accepts null to clear dates. Archiving retains
content and publication history. A draft can belong to at most one campaign;
unlink it before moving it to another.

Progress is computed from persisted draft publication records on each request:
a platform status of `published` **and** its Facebook post ID or TikTok publish ID
are required. A draft published on both platforms counts once. Rejected drafts
remain in totals and pending counts; soft-deleted unpublished drafts are excluded.
Soft-deleted confirmed publications remain in the totals. Empty campaigns show 0%.
Approval, timestamps alone, video downloads and copied descriptions do not count
as publication. No AI or external publishing requests are used to calculate progress.

The Campañas page reloads when opened and has an Actualizar button. Association
changes do not approve, reject, edit, publish, or delete the underlying content.

## Language preferences and HeyGen allowances

Alembic revision `91f6a20d3b8e` follows `8d4c2b17a690`. It adds independent
account and business language preferences plus nullable draft/conversation
language snapshots. Existing text and selections are not rewritten; the new
preference tables start empty and new preference values default to English.
Apply the revision only to an explicitly approved environment after reviewing
its backup and target revision. Tests use disposable PostgreSQL databases; they
do not migrate the configured application database.

New HeyGen jobs require an explicit paid-generation confirmation and an operator
allowance in `HEYGEN_BUSINESS_ALLOWANCES`, a JSON object keyed by business ID:

```json
{"<business-id>":{"max_generations":20,"max_script_characters":2000,"max_concurrent_jobs":2}}
```

`max_generations` counts every persisted attempt for the lifetime of the
business allowance, including failed attempts. Active jobs count against
`max_concurrent_jobs`; no automatic reset or monetary price estimate is implied.
An absent business entry blocks new paid generation, while recovery of an
existing attempt and access to already-generated content remain available.
Malformed configuration fails closed before provider I/O.

### Migration and release

Revision `e7b2c6d901af` follows `c8e913a74b02`. It creates `campaigns` and adds a
nullable indexed `drafts.campaign_id` foreign key; existing drafts remain unassigned.
Apply it to the intended PostgreSQL environment **before** running the updated
backend, then release the frontend. Review the target database and take the usual
backup before an authorized production migration. No remote migration is performed
by tests or frontend builds. Downgrading removes campaign data and associations,
but retains the drafts themselves.

### Tests

From `backend`, with the existing development environment configured:

```bash
DATABASE_URL=sqlite:// ../.venv/bin/python -m pytest tests -q
```

Tests override sessions with isolated in-memory databases and mock external
publishing calls. The explicit database URL prevents loading a remote database URL
from `.env`. From `frontend`, run `npm run build` for the production TypeScript/Vite
build.
