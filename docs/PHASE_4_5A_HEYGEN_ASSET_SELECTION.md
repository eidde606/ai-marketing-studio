# Phase 4.5A: HeyGen asset selection

This step adds authenticated browsing and selection of HeyGen avatar looks and
voices. It does not submit video-generation requests or change manual MP4 upload.

## Backend

The media feature exposes cursor-paginated endpoints:

- `GET /heygen/assets/avatars` accepts `avatar_type`, `ownership`, `limit`, and
  `token`. It returns look IDs, names, avatar types, default voice IDs, preview
  metadata, and supported rendering engines.
- `GET /heygen/assets/voices` accepts `type` (`private` or `public`), `limit`,
  and `token`. It returns voice IDs, names, language, status, mode, and preview
  audio metadata.

The HeyGen client now uses `GET /v3/avatars/looks` and
`GET /v3/models/audio/voices`. The existing `/heygen/avatars` and
`/heygen/voices` routes remain authenticated list-shaped compatibility routes;
the voice route follows all v3 pages for its response.

Routes and response schemas live in `backend/app/features/media/`. The provider
client remains in `backend/app/heygen_service.py`. The API key is read only by
the backend and is never returned to the frontend.

## Frontend

The approval media feature includes a collapsed HeyGen resource browser. It
allows filtering private/public avatars, avatar type, private/public voices,
and loading additional cursor pages. A selected avatar displays its supported
engines; its default voice is selected when present. Voice language and active
status are shown. Selection is local UI state and is not persisted to a draft
or used for generation yet.

The browser is read-only with respect to HeyGen. Existing script-copy and manual
MP4 upload controls remain in place.

## Verification and limitations

Backend provider and route tests mock responses; the test harness blocks
external network access. Frontend tests mock the asset service. No authenticated
HeyGen requests or paid generation are performed.

Validation completed:

- `cd backend && python3 -m pytest tests -q`: 92 passed.
- `cd frontend && npm test`: 122 passed.
- `cd frontend && npx tsc -b`: passed.
- `cd frontend && npm run lint`: passed with two existing Fast Refresh warnings
  in shared badge/button components.
- `cd frontend && npm run build`: passed; Vite reports the existing large-chunk
  warning.

HeyGen v3 endpoints use cursor pagination. Legacy list routes retain their
array-shaped response, but the voice route now returns the account's private
voices through v3 pagination; public voices are available through the new
paginated endpoint. Asset selection currently lasts only for the mounted
approval page and is not yet attached to a draft. Generation, idempotency,
video download, private-storage persistence, and completion recovery remain
out of scope.

The dormant legacy video editor no longer relies on its former test voice ID;
it uses the selected avatar's default voice when available and prevents
submission when that avatar has no default. The asset browser's selections are
not yet connected to that editor.

Official references: [Avatar Looks](https://developers.heygen.com/docs/avatar-looks.md),
[Voices](https://developers.heygen.com/docs/voices/overview.md),
[API version comparison](https://developers.heygen.com/endpoint-version-comparison.md).
