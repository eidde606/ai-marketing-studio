# Phase 4.5B — Durable HeyGen generation

## Scope

This phase adds backend-only, draft-scoped HeyGen v3 generation submission and
status recovery. It does not reconnect the dormant editor, add a generation
control to the frontend, download provider videos, or write videos to private
storage.

The media feature now owns the generation route, schema, orchestration service,
and persistence repository. A new Alembic migration creates
`heygen_generation_attempts`. The HeyGen API key remains in the backend
provider client.

## API

- `POST /businesses/{business_id}/drafts/{draft_id}/heygen-generation`
  accepts the selected `avatar_id`, `voice_id`, and `script`.
- `GET /businesses/{business_id}/drafts/{draft_id}/heygen-generation`
  returns the latest persisted attempt and refreshes its status from HeyGen
  when a provider video ID is known.

The former unassociated `POST /heygen/videos` route and provider-ID-only
`GET /heygen/videos/{video_id}` route were removed. The previous draft
generation route was replaced by the explicitly business-scoped route. These
legacy routes could bypass attempt persistence or business/draft status scope.
The disconnected frontend editor has not been re-enabled.

## Safety and persistence decisions

- The attempt, canonical request fingerprint, selected assets, script, and
  UUID idempotency key are committed before the provider call. The fixed
  aspect ratio and resolution are persisted as well so retries reconstruct the
  same provider payload.
- PostgreSQL draft-row locking serializes reservation. A partial unique index
  allows only one `SUBMITTING`, `UNKNOWN`, or `PROCESSING` attempt per draft.
- Repeating an identical request returns its existing attempt. A different
  request conflicts while an attempt is active.
- Stale submissions can be retried explicitly with the exact persisted payload
  and idempotency key, subject to a 60-second submission lease and a
  conservative 23-hour retry cutoff within the provider's 24-hour idempotency
  window.
- Timeouts, connection failures, provider 5xx responses, malformed successful
  responses, and provider 409 responses are treated as ambiguous. The attempt
  remains active as `UNKNOWN`; after 24 hours it is never resubmitted
  automatically or with a new key. Reconciliation is currently manual and
  requires a future operational workflow.
- Clearly rejected requests and missing backend configuration are marked
  `FAILED`; a later explicit request may start a new attempt.
- Provider completion is stored as `COMPLETED`, but the draft remains
  `uploading` until the MP4 is stored privately. Manual MP4 upload remains
  available and is rejected while any generation attempt is active.
- Generation and status lookups resolve the authenticated application principal,
  require fresh business membership, and use business-scoped draft and attempt
  persistence. User-initiated writes recheck permission after provider calls.
- Avatar and voice IDs are accepted only when present in the explicit access
  registry: platform-stock assets are globally shareable only after trusted
  designation; private assets require a business assignment by an Owner/Admin.
  Existing provider assets are not automatically registered.
- Signed webhooks resolve their attempt through the persisted callback/provider
  identifiers. The worker uses a trusted tenant context derived from that
  persisted attempt rather than a business ID in the payload.

## Verified application limitations

The authentication gate still enforces the configured `ALLOWED_USER_ID`; this
slice does not enable multi-user admission. The application also requires an
active local user and business membership. Initial ownership provisioning is a
separate reviewed operation, and no existing business is assigned automatically.

The frontend asset browser from Phase 4.5A is preserved, but its selections
are not connected to generation. The frontend does not expose a generation or
automatic reprocessing control.

## Regression coverage

Mocked tests cover stable idempotency keys, repeated and conflicting requests,
concurrent in-flight submission, retry behavior before and after the provider
window, timeouts, HeyGen 409 responses, definitive provider failures, persisted
status recovery, account/business/draft scope, the active-attempt database
index, and manual MP4 upload behavior. Provider-client HTTP is mocked; tests do
not contact HeyGen or incur charges.

## Validation

- Backend: 106 tests passed.
- Frontend: 122 tests passed.
- TypeScript check and production build passed.
- Frontend lint completed with two pre-existing React Fast Refresh warnings in
  `badge.tsx` and `button.tsx`; no lint errors.
- Production build reports the existing large-chunk warning.
- Alembic reports `f3a8b61c2d90` as the migration head.
