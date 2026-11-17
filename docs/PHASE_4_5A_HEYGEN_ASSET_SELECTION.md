# Phase 4.5A: HeyGen asset selection

This step adds authenticated browsing and selection of HeyGen avatar looks and
voices. It does not submit video-generation requests or change manual MP4 upload.

## Backend

The media feature exposes cursor-paginated endpoints:

- `GET /heygen/assets/avatars` accepts `avatar_type`, `ownership`, `limit`, and
  `token`; private requests also require `business_id`. Private results are
  filtered to explicitly assigned business assets. Public provider results are
  filtered to platform-stock assets explicitly designated in the access table.
- `GET /heygen/assets/voices` accepts `type` (`private` or `public`), `limit`,
  and `token`; private requests also require `business_id` and are filtered to
  that business's assignments. Public results are filtered to explicitly
  designated platform stock.
- `POST /businesses/{business_id}/heygen/assets/assignments` assigns one private
  avatar or voice to a business. Only Owners and Admins may assign or revoke
  assets. `POST .../assignments/revoke` removes that grant. A provider ID alone
  grants no access, and each asset type/provider ID can be assigned only once.

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

Platform-stock access is opt-in. The additive `heygen_asset_access` migration
does not seed or classify any existing provider asset. Platform stock must be
explicitly designated by a trusted operator after review; private assets are
explicitly assigned to one business. Until an asset has an access record it is
not listed for selection and cannot be used for generation.

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
array-shaped response but return only explicitly designated platform stock.
Asset selection currently lasts only for the mounted
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
