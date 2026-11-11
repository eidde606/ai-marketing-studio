# Phase 4: drafts, approvals, and media UI

## Purpose and scope

This is a feature-based layered architecture within the existing modular monolith. It is a structural refactor, not a rewrite or a move to microservices. React, TypeScript, the backend, API contracts, Spanish UI, and provider integrations remain in place.

The starting branch was `refactor/drafts-approvals-media`, with only the unrelated untracked `facebook_tiktok_review.txt` and `main_diff.txt` files present. Those files were not changed.

## Original responsibilities

| Starting file | Responsibility and problem |
| --- | --- |
| `App.tsx` (1,178 lines) | Authenticated workspace composition plus draft loading, generation, edits, deletion, approval, publication, verification, image generation/revisions, locks, errors, and navigation. Related workflows were difficult to find among unrelated shell code. |
| `components/ApprovalPage.tsx` (994 lines) | Approval rendering, draft edit form, image/video/revision UI, publishing confirmations, clipboard work, authenticated video fetches, downloads, and local media state. |
| `components/VideoUpload.tsx` (415 lines) | MP4 validation, upload state, authentication, HTTP requests, drag/drop UI, and styling. |
| `services/draftsApi.ts` | Shared draft types and authenticated draft, publishing, verification, image, and revision contracts. Already an appropriate data-access boundary; left unchanged. |
| `hooks/useDraftImages.ts` | Image instruction text and editor-open state; reused unchanged by the media feature. |
| `app/` | Phase 3 authentication, user-specific business selection, and application shell. Left unchanged. |
| `components/SofiaChat.tsx`, `services/sofiaApi.ts` | Conversation-based draft creation. The existing App callback still checks its business visit before adding a draft. These files were not moved or changed. |
| `components/HeyGenVideoEditor.tsx`, `services/heygenApi.ts` | Avatar selection, paid video request, and five-second status polling. The editor currently has no rendered import in the active frontend; it was inspected and left unchanged, rather than activating or redesigning it. |
| `features/campaigns/` | Existing Phase 2 feature. Its API, UI, associations, and backend were not changed. |

## New organization

All paths in this table are relative to `frontend/src/`.

| File | Ownership |
| --- | --- |
| `features/drafts/hooks/useDraftCollection.ts` | The single draft list, loading/error state, visible/history filters, pending count, local draft replacement, and current-business-visit guard. |
| `features/drafts/hooks/useDraftOperations.ts` | Shared approval/publish/busy IDs, image lock set, and approval/edit/delete error. One instance allows different workflows to observe the same locks. |
| `features/drafts/hooks/useDraftActions.ts` | Content generation, unsaved edit values, save, soft deletion, rejection, and deletion lock. |
| `features/drafts/components/DraftEditForm.tsx` | Controlled title/caption fields and save/cancel buttons. No requests or duplicate form state. |
| `features/approvals/hooks/useApprovalActions.ts` | Destination selection, approval ordering, Facebook/TikTok publication and verification, existing Facebook video polling, and publication errors. |
| `features/approvals/components/ApprovalPage.tsx` | Composes approval cards and controlled child panels. Retains publishing confirmation prompts, availability rules, destination controls, and Spanish statuses. |
| `features/approvals/types/ApprovalPageProps.ts` | The existing public page interface, extracted without changing its fields. |
| `features/media/hooks/useDraftMedia.ts` | Workspace-owned image URLs, image/revision errors and busy indicators, original generation/preview/revision handlers, and instruction-helper integration. |
| `features/media/hooks/useApprovalMedia.ts` | Approval-page-local video preview state, upload-panel visibility, clipboard feedback, and browser download lifecycle. |
| `features/media/hooks/useVideoUpload.ts` | Selected file, MP4 validation, upload/error state, and success callback order. |
| `features/media/services/videoApi.ts` | The authenticated preview/download/upload HTTP code previously embedded in components. It keeps the distinct existing preview/download error messages, URL encoding, headers, FormData, and request order. |
| `features/media/components/DraftMediaPanel.tsx` | Existing image preview/generation controls, video preview, script copying, and MP4 upload panel markup. |
| `features/media/components/ImageRevisionEditor.tsx` | Controlled instructions, original/new comparison, revision status, accept/reject actions, and cost notice. |
| `features/media/components/VideoUpload.tsx` | Existing upload UI, drag/drop state, file-size display, and styling. Calls its feature hook. |

`components/ApprovalPage.tsx` and `components/VideoUpload.tsx` are now thin compatibility re-exports. Existing imports, props, and callers remain valid. App still composes pages using those paths.

App.tsx is now **490 lines** and the feature ApprovalPage is **366 lines**. This reduction comes from separating responsibilities, not deleting features. Each extracted presentation component returns the original DOM fragment without extra layout wrappers.

Shared domain/API types stay in `services/draftsApi.ts`; creating redundant aliases in a new drafts/types directory would add no useful boundary. There is no new generic client, context provider, dependency, global store, or hook wrapping all workflows. Hooks use ordinary arguments and return values. Type-only references describe those values without creating runtime coupling or extra state.

## Following the data

### Draft collection and editing

1. `AuthenticatedApp` gets the selected business from the unchanged Phase 3 hook.
2. It calls `useDraftCollection` and creates one shared operation-state owner.
3. `useDraftCollection` calls the existing `getDrafts(businessId, true)` service and exposes history, visible drafts, and the pending count.
4. `useDraftActions` receives that collection and the shared operation state. Editing sets controlled title/caption values. Saving keeps the existing trimming and validation, calls `updateDraft`, and replaces the returned draft locally.
5. The server-returned draft retains its campaign association and authoritative state. Soft deletion still calls DELETE; it does not delete published provider content or campaign associations in the frontend. Deleted published content remains eligible for history while approvals hide deleted entries.

Content generation remains one explicit `generateContent` call. The existing Sofía callback still adds its returned draft and selects Aprobaciones only for the current business visit. No AI prompt, model, provider setting, attempt ID, billing rule, or generation endpoint was changed.

### Approval and publishing

The approval page renders controls and asks for the same publishing confirmations. It calls the hook handler supplied by App.

Approval still saves publishing destinations first, awaits that request, and then approves the draft. The same pending/busy/image-lock guards remain. Publication still requires an approved, not-yet-published draft and uses the same in-flight IDs. Facebook response mapping, TikTok payload fields, needs-review handling, error messages, and manual verification are unchanged. Nothing retries automatically.

The direct TikTok handlers and page props remain available for compatibility; the current rendered TikTok flow remains manual video download and caption copying. This refactor does not turn on a direct-publishing UI.

Facebook video verification retains its original immediate check and 30-second interval. The dependencies now explicitly include the stable React draft setter; that setter does not cause additional runs. Cleanup and the check before proceeding to the next draft remain unchanged.

### Media

Image generation and revision handlers retain their confirmation prompts, shared image lock, API call order, authoritative reloads, and stale-result checks. A failed/ambiguous revision request still queries status rather than submitting a second generation. Accepting a revision still awaits acceptance and then loads drafts and the preview together. Backend image-attempt and revision safety mechanisms are untouched.

Video preview now follows:

`ApprovalPage → useApprovalMedia → videoApi → authenticated preview endpoint → signed URL → video element`

Download follows:

`button → hook → preview endpoint → fetch signed URL → Blob → object URL → temporary anchor click → remove anchor → revoke URL after 60 seconds`

The hook owns browser effects; the service owns HTTP. Download filenames and alerts are unchanged. Upload still uses the current Supabase token, an encoded draft ID, and FormData without setting Content-Type manually. After success it clears the file and invokes the original callback. The parent callback still closes the upload panel and reloads the page.

## Lifetime, business isolation, and recovery

The custom hooks do not create new mounted components. They all run inside the existing **user-keyed AuthenticatedApp**, above its password-recovery return.

- Account changes create fresh state; logout unmounts it.
- Same-account recovery preserves workspace-owned edits, locks, selected business, and pending work, exactly as finalized in Phase 3. The normal page subtree still unmounts during recovery.
- Each business visit has its own identity, including A → B → A. Async handlers capture the original visit and cannot update a later visit.
- Draft-loading effect cleanup ignores obsolete success, failure, and loading completion.
- Each feature now clears its own business-specific display state in its effect. These setters are the same resets formerly grouped in App. No extra request or retry is added.
- Shared busy IDs and lock refs are deliberately not cleared on business switching. Existing finally blocks release them when requests finish.
- The browser media hook remains page-local, with the same lifetime as the original ApprovalPage state. It is not recreated for each card or business prop change.

## Regression tests and verification

The prior suite contained 90 tests. **25 new characterization cases passed before production extraction**, giving a 115-test baseline. Two additional high-risk checks were added for direct TikTok payload/verification and Facebook polling. The entire final **117-test suite was also rerun against the original HEAD implementations of App, ApprovalPage, and VideoUpload**, and passed. The extracted implementation was restored and verified afterward.

New tests:

- `App.test.tsx`: 14 added cases covering trimmed edits and preserved campaign association; invalid/failed saves; stale edit results after A → B → A; delete/reject cancellation; pending delete lock and soft deletion; rejection; destination-before-approval order and its failure path; image cost confirmation and shared lock; ambiguous revision failure without retry; revision acceptance/reload; TikTok payload and pending lock; Facebook polling and logout cleanup.
- `components/ApprovalPage.test.tsx`: 10 cases covering the actual text/image/video publishing prompts; cancellation; busy and verification-only UI; loading/empty/error rendering; video preview/close/failure; download request order, anchor removal, and 60-second URL cleanup; missing authentication; and the known late-preview behavior.
- `components/VideoUpload.test.tsx`: 3 cases covering invalid MP4 selection; one pending authenticated FormData upload and success cleanup; and preserving the file after failure without retry.

The Phase 3 tests still cover draft creation/generation, business loading/isolation, A → B → A, logout during pending reads and mutations, Spanish navigation, token refresh, and password-recovery state/locks. API/provider calls are mocked in new tests; no real publishing or paid generation was performed.

Final results:

| Check | Result |
| --- | --- |
| `cd frontend && npm test` | **117 passed**, six files; App suite has 50 tests |
| `cd frontend && npx tsc -b` | Passed |
| `cd frontend && npx eslint . -f json` | Zero errors; two pre-existing shared UI warnings; no findings in changed/new files |
| `cd frontend && npm run build` | Passed |
| `.venv/bin/python -m pytest backend/tests -q` | **83 passed** |
| `git diff --check` | Passed |

Additional diff review used the TypeScript parser/printer to compare all **17 moved App workflow function bodies** with HEAD, ignoring comments/formatting: no differences. The moved JSX text and human-readable string literals also matched. The HTTP extraction was reviewed against the original preview/download/upload code and exercised through real component tests with mocked fetch.

## Warnings and known limitations

Pre-existing warnings remain separate from test failures:

- React 18 logs the existing SheetOverlay ref warning when the mobile navigation test opens the drawer.
- Full ESLint reports the same fast-refresh export warnings in `components/ui/badge.tsx` and `components/ui/button.tsx`. Its JSON formatter is used because the installed Node version is incompatible with its default stylish formatter.
- Vite warns about the main JavaScript chunk exceeding 500 kB (approximately 588 kB after extraction).
- Backend tests report the existing Starlette/httpx test-client deprecation warning.

An initial full-lint run overlapped Vite's temporary config-file creation/removal and failed with ENOENT. Lint was rerun after the build finished and passed with only the two existing warnings; no configuration was changed to hide the failure.

Questionable existing behaviors were preserved, not silently corrected:

- Page-local video preview/download callbacks have no business-visit guard. A delayed preview can be stored after switching businesses and reappear when returning; a new characterization test explicitly records this. In-progress downloads can finish after navigation.
- The download object URL is revoked by its existing 60-second timer, not by page-unmount cleanup. A failure between object-URL creation and timer registration still has the original cleanup limitation.
- Facebook connection/OAuth callbacks, HeyGen generation, and Sofía's internal conversation callbacks were not redesigned. Their existing child-local lifecycle risks remain.
- The frontend's pending IDs/locks are not durable deduplication across logout, reload, or multiple tabs. They retain the existing guards, including the distinction between state-based busy arrays and synchronous ref locks.
- Same-business request ordering and already-started multi-request operations retain their original semantics. Switching business/logout prevents obsolete local updates; it does not cancel server mutations.
- New tests do not exhaustively cover every provider failure or revision status. No live OAuth, provider publishing, charged generation, or full browser visual acceptance was performed. Offline backend tests do not prove production concurrency behavior.

These are follow-up candidates requiring separate behavioral decisions and tests. No such change was necessary for this extraction.

## Final scope

Modified: App.tsx, App.test.tsx, and the two compatibility component files. Added: the 14 feature files listed above, two component test files, and this document. No existing API service, app authentication/business hook, backend file, migration, production configuration, or dependency file was changed. The generated tracked TypeScript build-info file was restored after verification.

Future work may address the documented stale child callbacks, same-business request ordering, more complete provider failure coverage, and remaining legacy screens/services. Phase 5 has not been started.

No commit, push, merge, or deployment was performed. The work is stopped for review.
