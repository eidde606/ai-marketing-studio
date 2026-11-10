# Phase 4.5D — HeyGen generation UI

The approval queue now offers **Crear o recuperar video con HeyGen** on each
pending draft (and video drafts for recovery). The editor starts with Leo's
`video_script`, not the publication caption. Ángela can edit the script, select
an available avatar and active catalog voice, and explicitly confirm the paid
request. Generation never approves or publishes content.

## Ownership and data flow

- `features/media/services/heygenGenerationApi.ts` authenticates requests with
  Supabase and uses the existing business/draft-scoped endpoints. It sends only
  `avatar_id`, `voice_id`, and `script`. There are no generation retries.
- `features/media/hooks/useHeyGenGeneration.ts` owns per-draft job state and
  synchronous submission locks in the authenticated workspace. It shares the
  existing draft operation flags and refreshes the affected draft from the
  backend after an authoritative job response. Navigation and same-account
  password recovery retain the controller; logout/account changes unmount it.
  The collection's business-visit guard rejects stale A → B → A responses.
- `HeyGenGenerationPanel.tsx` renders Spanish status, script editing, paid
  confirmation entry, recovery, and private previews. While processing, it
  polls the GET status endpoint every five seconds, one request at a time.
  Closing the editor stops polling. Errors and unknown outcomes require an
  explicit recovery action, which calls `/reconcile`, never generation.
- `HeyGenAssetSelector.tsx` remains the existing catalog browser, now with a
  validated selection callback and unique label IDs. Missing/inactive voices,
  unavailable avatars, and known incompatible engines cannot enable generation.
  An avatar's default voice must appear in the loaded voice catalog. Paging
  responses from obsolete filter visits are ignored.
- `DraftMediaPanel` keeps manual MP4 upload and the existing stored-media UI.
  Upload and generation editors are mutually exclusive. `App` passes the
  workspace controller through the approval presentation components.

The obsolete standalone editor and its API service have been removed. No
frontend code calls the deleted generic HeyGen generation/status endpoints.

## Safety and recovery

A status lookup runs when opening the editor; it cannot submit generation.
Only the backend's specific “no generation attempt” response enables a fresh
submission. Authorization, missing-draft, and network errors do not count as an
empty history. A failed submission is treated as uncertain until an existing
attempt is recovered. Even a temporary “no attempt” recovery response cannot
clear the in-memory uncertainty after a submission. A definitively failed
provider attempt permits a new, separately confirmed request.

The backend remains authoritative for eligibility, idempotency, private
storage, attachment leases, and publication safety. Shared operation flags
block conflicting UI actions while generation is pending. Read failures stop
polling and expose recovery. Only `COMPLETED` plus `STORED` enables the generated
video preview, obtained from the existing authenticated signed-preview endpoint.
Expired/unplayable previews have a refresh action. Provider video URLs are never
used for playback. No provider key is sent to the browser.

## Limits and deployment prerequisites

No backend contracts, schema, migrations, or provider payloads changed. The
existing Phase 4.5B/C database migrations must already be applied by the deployment
operator before enabling this UI; this phase does not run them. The backend needs
its existing HeyGen API key, private Supabase storage configuration, and webhook
secret/registration if webhook delivery is desired. Polling/reconciliation can recover jobs after the browser was interrupted. There is still no always-on recovery
worker; an unrevisited job may need an operator to reconcile it.

The API provides no exact price quote or percent-progress field. The UI states
that generation consumes API credits and shows the fixed vertical 1080p setting;
it does not invent a price or progress percentage. Unsubmitted script edits and
asset selections are local to the open editor, while generation attempts persist
on the backend. An ambiguous attempt without a recoverable provider ID can still
require operator assistance. Unattached private objects from lost storage leases
remain the previously documented cleanup limitation.

## Verification

Mocked frontend tests cover confirmation/cancellation, selected payload, restored
state, processing polls, unknown and failed attempts, ambiguous network errors,
duplicate prevention, business switching, logout, unavailable configuration,
private preview renewal, and authenticated API contracts. Existing approval,
upload, publishing, authentication, and recovery tests remain in the full suite.
No live HeyGen or paid generation is used in verification.

Final checks: 142 frontend tests passed (20 added), TypeScript and production
build passed, and all 163 backend tests passed. ESLint completed with zero
errors and two existing fast-refresh warnings in `ui/badge.tsx` and
`ui/button.tsx`. The JSON formatter was used because the installed Node 20.11
cannot run ESLint's default formatter (`util.styleText`). Existing test warnings
include the Radix sheet ref warning and backend Starlette/httpx deprecation.
The production bundle still exceeds Vite's 500 kB advisory threshold.
`git diff --check` passed. No migrations, deployment, or live provider requests
were performed.
