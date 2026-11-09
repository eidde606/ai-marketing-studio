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

From the project root:

```bash
uvicorn app.main:app --app-dir backend --reload
```

Alternatively, run Uvicorn with `backend` as the working directory:

```bash
cd backend
uvicorn app.main:app --reload
```

## Health check

The server provides:

```text
GET /health
```

Check it locally at:

```text
http://127.0.0.1:8000/health
```

A healthy response is:

```json
{"status":"healthy"}
```

## Campaign management

Campaign endpoints use the existing Supabase authentication and authorized-user
restriction. Every route is scoped to a business; draft associations must belong
to that same business. This preserves the existing single-authorized-user model;
it does not add multi-user business memberships.

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
