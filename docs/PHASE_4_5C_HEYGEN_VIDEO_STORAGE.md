# Phase 4.5C — HeyGen video completion and private storage

## Scope and flow

This phase adds provider-authoritative completion handling and recovery to the
backend media feature. The frontend generation editor remains disconnected.

- `GET /businesses/{business_id}/drafts/{draft_id}/heygen-generation` refreshes
  status and stores the video once HeyGen reports completion.
- `POST /businesses/{business_id}/drafts/{draft_id}/heygen-generation/reconcile`
  performs the same authorized recovery explicitly. It recovers completions
  that happened while the browser or application was unavailable.
- `POST /webhooks/heygen` receives HeyGen `avatar_video.success` and
  `avatar_video.fail` events. It verifies the signature over the raw body,
  stores a deduplicated delivery, then uses a FastAPI background task to
  retrieve authoritative video state and process it. Callback URLs and status
  fields are never used as download authority.

The existing HeyGen v3 provider client downloads the `video_url` from
`GET /v3/videos/{video_id}` only after that endpoint reports `completed`. The
download client requires HTTPS and an allowlisted HeyGen delivery hostname,
revalidates every redirect, limits redirects, sets connect/read timeouts, caps
the transfer at 100 MB and five minutes, and relies on the existing MP4
container validation before upload. An expired signed URL (401/403/404) causes
one fresh status lookup and one download retry; it never submits generation
again.

The private Supabase upload uses a unique path for each completion claim:
`businesses/{business_id}/heygen/{attempt_id}/{object_uuid}.mp4`, with
`upsert=false`. An expired worker cannot overwrite a successor's object.
Storage progress, a completion lease, and the winning path are persisted.
Final attachment locks and refreshes the draft before the attempt, matching
submission's lock order. It requires an unexpired matching lease, the latest
attempt, matching business and generation association, and a pending,
undeleted, unpublished draft still awaiting this video with no replacement
video or active image generation. Provider status updates use the same draft
eligibility check so they cannot restore an obsolete association.

An ineligible draft is left unchanged; the attempt retains provider completion
but records storage `FAILED` and is not automatically attached later. An
expired claim without a successor becomes `RETRY`. Storage retries never
resubmit paid generation and use a fresh private object path. Manual uploads
remain blocked while a completed HeyGen video is not stored. Existing signed
previews continue to serve the winning business-prefixed private path.

A losing worker, a lifecycle change during upload, or a crash after upload can
leave an unattached private object. This patch deliberately does not delete
objects during concurrent completion; safe orphan cleanup remains future work.
The mocked race tests use interleaved requests and SQLite, which does not
exercise PostgreSQL row-lock scheduling. Production locking uses `FOR UPDATE`;
a real PostgreSQL concurrency test remains an additional validation option.

## Webhook configuration

The public receiver uses `HEYGEN_WEBHOOK_SECRET`, the one-time signing secret
returned when registering an endpoint in HeyGen. Configure a webhook endpoint
for the deployed Render URL ending in `/webhooks/heygen`, subscribed to
`avatar_video.success` and `avatar_video.fail`, then add its secret to the
backend environment. Registration and secret provisioning are operational
steps; this implementation does not call the authenticated HeyGen endpoint
management API.

HeyGen documents the raw-body HMAC-SHA256 `signature` header and recommends
deduplicating avatar-video events by `event_data.video_id` plus `event_type`.
This implementation follows that method and also stores the echoed
`callback_id`. New generation submissions send their persisted attempt UUID
as `callback_id`, allowing a signed callback to recover an attempt even when
the submission response was lost before its provider video ID was saved.
Provider state is re-fetched and the returned video ID checked before binding
that callback to the attempt.

References: [HeyGen Webhooks](https://developers.heygen.com/docs/webhooks),
[Webhook Events](https://developers.heygen.com/docs/webhook-events),
[Get Video](https://developers.heygen.com/reference/get-video), and
[Create Video](https://developers.heygen.com/reference/create-video).

## Reliability limitations

The webhook receiver durably records the event before acknowledging it and
uses an in-process FastAPI background task for prompt processing. There is no
queue or always-on worker. A process restart can interrupt that task, but the
stored delivery and attempt remain; the authenticated reconcile endpoint
resumes persisted callback deliveries (including attempts whose submission
response was lost) and re-fetches HeyGen status before storage. For attempts
with a saved provider video ID, it can also recover by polling. An operator or
client must call reconciliation for attempts that are not revisited; there is
no scheduled sweep across every business. An ambiguous generation attempt
without a provider ID can be correlated by the new `callback_id` if HeyGen
delivers its event; older attempts without that callback ID remain
unreconcilable unless they already have a provider video ID.

The application still has its existing single-authorized-account model rather
than per-business user memberships. Authenticated reconciliation requires the
business and draft to match, and callbacks are accepted only with the
configured HeyGen signing secret.

## Validation

Automated tests mock HeyGen responses, downloads, webhook signatures,
background processing, and Supabase uploads. They cover completion, polling
and webhook deduplication, invalid signatures, callback recovery when the
submission response was lost, authoritative provider URLs, expired links,
storage retries, completion concurrency, download host/redirect/size
validation, private storage paths, and recovery of persisted callbacks after a
restart. No live HeyGen requests or generation charges are used.
