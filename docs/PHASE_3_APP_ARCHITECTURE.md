# Phase 3: application shell and business state

## Architecture and ownership

The target is a **feature-based layered architecture within a modular monolith**, not microservices. Phase 3 separates cohesive application responsibilities without introducing dependencies, context providers, or layers for their own sake. Later feature extraction is not part of this phase.

- `frontend/src/App.tsx`: `App` owns authentication through `useAuthSession`. It displays loading, sign-in, or a user-keyed `AuthenticatedApp`. The authenticated workspace owns navigation, business selection through its hook, and the existing draft/media/publishing state and handlers.
- `frontend/src/app/useAuthSession.ts`: starts the Supabase session lookup, subscribes to auth changes, handles account-scoped recovery mode, exposes sign-out, and unsubscribes on unmount. A newer auth event takes precedence over an older initial lookup. API services still retrieve access tokens themselves; token storage, request headers, and API contracts were not changed.
- `frontend/src/app/useBusinessSelection.ts`: loads businesses, selects the current valid ID, otherwise the saved valid ID, otherwise the first business. It persists selection under `ai-marketing-studio:business:<userId>` and adds/selects newly created businesses. Empty lists and failures retain the existing Spanish UI. Storage failures are tolerated. Its owner must remain keyed by user ID so accounts never share its state.
- `frontend/src/app/AppShell.tsx`: renders the existing sidebar, heading, business selector, add-business button, account menu, and business error. It receives data and callbacks; it does not fetch data or own workflow state. Page content is passed as React children. Spanish labels and CSS classes are retained.
- `frontend/src/App.test.tsx`: exercises the app through the real shell/navigation with API services and expensive page bodies mocked. These are application integration tests, not live provider tests.

## Navigation

`AuthenticatedApp` keeps `activeSection`. The sidebar calls its section-change handler, which selects a page and closes the business form. The shell displays that section's heading; conditional page composition stays in App.tsx. Navigation is saved under `ai-marketing-studio:section`.

The original restore allowlist remains unchanged: Resumen, Campañas, Contenido, Equipo IA, and Aprobaciones. Analíticas and Configuración remain available in navigation but reloading those saved values falls back to Resumen, as before.

## Password recovery and authenticated accounts

The final review identified an unintended difference: returning the recovery page directly from App unmounted the authenticated workspace. That finding is now corrected.

The recovery page is returned **inside AuthenticatedApp, after its hooks**. For the same authenticated user, its component identity stays unchanged. Navigation, selected business, unsaved draft-edit state, loaded data, and operation locks survive recovery. Pending operations can finish and update workspace-owned state while recovery is visible. Completion restores the page without reloading the workspace's businesses or drafts.

The normal page subtree is not rendered during recovery. Its own child-local state is not retained; this matches the original App behavior, which also returned AuthPage instead of its normal page tree. For example, this change does not newly preserve fields owned privately by BusinessForm. Existing child mount effects may run again when returning to the page, as before. No hidden workspace DOM is kept behind recovery.

Security boundaries remain explicit:

- Logout/no session unmounts the workspace and displays sign-in.
- A different user ID creates a fresh workspace, even if the event is password recovery. Old callbacks cannot update that new workspace.
- Recovery belongs to the authenticated user ID. Logout or switching accounts clears the previous account's recovery marker, so it cannot reactivate on a later login.
- A token refresh for the same user preserves the workspace and recovery mode.

Preserving same-account workspace state therefore does not require weakening account isolation or changing Supabase token handling. The revised recovery behavior has no remaining approval conflict identified in this review.

## Business changes and asynchronous work

Selecting a business updates the hook's ID. The draft-loading effect clears old drafts, image/revision UI, editing selection, and errors, then calls `getDrafts(id, true)`. Effect cleanup ignores stale results, failures, and loading completion. Visible drafts are also filtered by business ID. Facebook connection status retains its effect-cleanup guard.

Mutation handlers stay in App.tsx. Each business visit has a distinct identity, including A → B → A. A handler checks that its original visit is still current before applying a delayed result or error. Logout/account changes invalidate the visit. Same-account recovery does not change the business visit. This protects App-owned generation, publishing, editing, image/revision results, and Sofía's draft callback.

In-flight locks remain in the authenticated workspace across business changes and same-account recovery. Existing `finally` blocks release them when their requests finish. The Facebook verification interval remains 30 seconds and clears on cleanup; an obsolete loop stops before the next draft. No automatic retries or new provider operations were introduced.

Already-started server operations are not canceled or rolled back by switching businesses or signing out. Obsolete UI responses are ignored; revisiting/reloading retrieves authoritative server state. Locks are not durable across logout, account changes, or a page reload and are not a substitute for server-side duplicate-operation protection.

## Regression evidence

Before extraction, 16 baseline tests passed on the original App.tsx. Three more tests reproduced existing failures:

1. A late initial session response undoing a newer logout event.
2. Old account businesses/selection leaking into a new account while its businesses load.
3. Generation from an earlier A visit changing the current visit after A → B → A.

All three now pass. Final review added explicit pending-draft logout tests (success/failure) and publishing-success tests for the current visit, A → B → A, and logout/login.

For the recovery correction, the revised recovery test and four additional cases failed against the preceding implementation, then passed after the fix. They verify:

- No workspace business/draft reload on same-account recovery completion.
- Unsaved draft-edit text, selected business, navigation, and a pending publishing lock survive recovery and token refresh.
- A pending generation result can finish during recovery without rendering workspace content until recovery completes.
- Logout and account changes during recovery discard the previous workspace and ignore its pending generation result, including after returning to the original account.

The complete app suite now has **36 tests**. Existing tests also cover authentication failure, business creation, empty lists, storage failure, Spanish desktop/mobile navigation, stale draft/image/Facebook responses, publishing errors, operation-lock release, and unchanged token-refresh behavior.

## Verification after the recovery correction

- `cd frontend && npm test`: **90 passed** across four files.
- `cd frontend && npx tsc -b`: passed.
- `cd frontend && npx eslint src/App.tsx src/App.test.tsx src/app -f json`: no errors or warnings.
- `cd frontend && npx eslint . -f json`: no errors; two existing warnings in unchanged UI files.
- `cd frontend && npm run build`: passed.
- `git diff --check`: passed.
- Backend tests passed **83/83** during the preceding final review. They were not rerun for this frontend-only recovery correction; backend files remain unchanged.

## Unrelated warnings and remaining limits

- The existing mobile Sheet logs a React 18 function-component ref warning for SheetOverlay. Its navigation test passes; shared UI components were not changed.
- Existing fast-refresh export warnings remain in `components/ui/badge.tsx` and `components/ui/button.tsx`.
- ESLint's default stylish formatter is incompatible with the installed Node 20.11.0 (`util.styleText`); the JSON formatter completes and reports the results above. No dependency/runtime configuration was changed.
- Vite warns about the main JavaScript chunk exceeding 500 kB (approximately 584 kB). Bundle splitting is outside this phase.
- The preceding backend run reported the existing Starlette/httpx test-client deprecation warning.
- Unchanged FacebookConnection page-selection/connect callbacks and ApprovalPage video-preview/download callbacks are not protected by App's visit guard. Their child-local state can still receive late responses; downloads already started may complete. These internals are mocked in the app integration tests.
- Same-business response ordering, initial business-list versus creation races, and durable operation deduplication were not redesigned. Dedicated new tests do not exhaustively cover every TikTok, approval, or revision handler.
- Real OAuth redirects, provider publishing, charged AI generation, and full visual/browser acceptance were not exercised.

## Scope and review status

Production Phase 3 changes are confined to App.tsx and the three new app modules. The recovery correction changes App.tsx and useAuthSession.ts, plus tests and these notes. Publishing/generation service calls, payloads, confirmation prompts, backend rules, API services, database/migrations, dependencies, and production configuration remain unchanged.

App.tsx intentionally still contains the higher-risk workflows. This phase improves application ownership without moving them into an oversized hook or beginning Phase 4. The generated TypeScript build-info file is restored after checks. Pre-existing untracked `facebook_tiktok_review.txt` and `main_diff.txt` remain untouched.

The recovery finding is resolved. Phase 3 is stopped for final approval. No commit, push, merge, or deployment has been performed.
