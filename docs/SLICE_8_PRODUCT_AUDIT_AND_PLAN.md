# AI Marketing Studio — system, product, and UX audit

**Audit baseline:** `feature/multi-tenant-foundation` at `9b3c3405b751a6ba85f2d2936e5824c1a45b76c6` (Slice 8 Phase 1 committed).
**Status:** Audit and revised plan approved. Slice 8 Phase 2 frontend foundation is complete locally at `ef4bddf9ed6e3d5205e3cc6f2cc2938ff03d13e9`; no backend, database, billing, or deployment changes were made.

## Scope and evidence

This audit follows the current React/TypeScript/Vite application, FastAPI feature routes and services, SQLAlchemy models, Alembic graph, provider adapters, and current API contracts. Current source takes precedence over older phase notes. The local Alembic graph has one head, `91f6a20d3b8e`; this audit did not connect to any database, call external APIs, run the app in a browser, or perform a penetration test. Responsive and usability observations are therefore code-based risks, not reproduced user-study findings. The repository has no applicable `AGENTS.md`.

The working tree was already dirty before this documentation change: `frontend/tsconfig.tsbuildinfo` was modified, and `facebook_tiktok_review.txt` and `main_diff.txt` were untracked. They are outside this audit and must remain untouched. No implementation code, database, credentials, or provider was changed.

## Executive assessment

The product has a credible small-business problem to solve: turn limited business information into usable, brand-aware social content, then help the owner review, distribute, and learn from it. Its strongest potential is a **closed-loop content workflow**, not the number of named AI agents.

The technical foundation is stronger than the current user journey. The backend is a feature-based modular monolith with explicit tenant authorization, scoped repositories, durable publishing/media records, and provider boundaries. The frontend has useful feature hooks and account/business lifetime guards. But the current experience still feels like several tools: a one-click generator, a separate Sofía chat, a draft/history library, an approval-and-media workbench, campaign CRUD, and a Facebook metrics page.

**Conclusion:** continue with Slice 8 as an incremental product workflow redesign, not a rewrite. A private, single-allowlisted-user pilot is materially closer than a self-service SaaS launch. Do not remove `ALLOWED_USER_ID` or present disabled capabilities as available until the admission, spend, role-aware UI, language, and end-to-end release gates below are met and separately approved.

## A. Current system assessment — verified source behavior

### Frontend and application shell

- `frontend/src/main.tsx` mounts a React 18 SPA. `App.tsx` owns authentication state, the selected business, section navigation, and composition of draft, approval, media, and publishing hooks. Sections are stored as Spanish display strings in local storage; there is no route/deep-link layer or browser-history workflow.
- The root screen is a branded login page rather than a separate public landing page. `useAuthSession.ts` uses Supabase email/password sign-in, session events, sign-out, password recovery, and profile-name update. `AuthPage.tsx` renders login, reset-link, and new-password flows; it has no signup or locale-selection UI.
- `useBusinessSelection.ts` loads the server-filtered business list and remembers a valid selection per Supabase user. `BusinessForm.tsx` asks for many optional business-profile fields in one form. Business creation is supported, but profile editing and resumable onboarding are not.
- The shell exposes seven peer sections: Resumen, Campañas, Contenido, Equipo IA, Aprobaciones, Analíticas, and Configuración. The dashboard has both a one-click “Crear contenido” action and shortcuts to review, campaigns, and the AI team. `ContentPage` is a searchable/filterable library and preview/metrics surface, not a composer.
- The UI is predominantly hard-coded Spanish, including navigation, errors, date formatting, and forms. The package has no localization or routing library. English-first UI and Spanish as an explicit choice are not implemented.
- `SettingsPage.tsx` edits the display name and shows social integrations. It does not expose interface, conversation, or marketing-content language, role/team management, usage, or account lifecycle controls.

### Backend, persistence, authorization, and integrations

- FastAPI is a modular monolith. Feature routes translate HTTP into application-service calls; services enforce policy and coordinate repositories, transactions, and providers. The reviewed modules include accounts, access, memberships, businesses, campaigns, content, drafts, media, Facebook, Instagram, TikTok, and analytics.
- Supabase JWT verification validates signature, issuer, audience, required claims, and the configured `ALLOWED_USER_ID`. Protected access also requires an active `app_users` identity. Business operations use the existing Owner/Admin/Member policy and tenant-scoped persistence. Membership changes recheck authority and preserve an active Owner.
- An `/account/register` endpoint exists, but it only provisions the already-allowlisted, authenticated identity. Its registration dependency rejects anonymous tokens but does not itself enforce an email-confirmed claim; this is not public admission today, but verified-email policy must be explicit before it is opened. `/account` returns per-business roles/capabilities and feature flags; the response declares public registration, TikTok direct publishing, Instagram publishing, Mía analysis, and scheduling unavailable. The frontend does not consume this capability response.
- Business membership list/change endpoints exist at `/businesses/{business_id}/memberships`; there is no invitation/acceptance workflow or corresponding team UI. The `/businesses` list contract does not include role/capability data. Existing initial ownership is provisioned separately, not inferred.
- User interface/conversation language preferences and business marketing-content language are stored independently. The content service snapshots effective language on conversations/drafts and passes language into Sofía/Leo provider calls. Defaults are English. This backend contract exists, but the frontend neither loads nor updates it; current Spanish users can receive English assistant/content output by default.
- `POST /businesses/{business_id}/generate-content` and Sofía conversation generation both use the same `_generate` application path. It reads the authorized business profile and recent drafts, calls Sofía for a strategy, calls Leo for strict structured content, and saves a pending `Draft`. The generated platform is separate from the selected publish destinations; current code does not silently default unsupported creative platforms to Facebook.
- `POST /drafts` supports backend manual draft creation, but the frontend has no manual-draft API/form. Its “Crear contenido” button calls automatic AI generation without a topic/brief. Drafts have optional campaign linkage and language snapshots; `DraftCreate` currently does not accept a campaign association.
- Campaign CRUD and draft association are tenant-scoped. Campaigns are optional in the data model. Their progress is a count/ratio of drafts with confirmed provider publication IDs; dates and statuses do not schedule posts or measure sales/business outcomes.
- Facebook supports direct text/image/video publishing and Facebook post metrics. TikTok has backend direct-publishing routes/services, but the account capability is false and the rendered approval workflow exposes manual completed-video download and caption copy, not direct posting. Instagram has connection/authorization status, not a publishing flow.
- Media uses business-prefixed private storage paths and tenant-validated signed URLs. Image generation/revisions and video upload are draft-scoped. HeyGen platform stock assets require explicit trusted designation to be shared; private assets are business-assigned, and generated video remains business-scoped. HeyGen generation has persisted attempts, idempotency/recovery, authenticated webhook processing, explicit paid confirmation, and operator-configured per-business lifetime/concurrency/script-length allowances. The allowance/usage endpoint is not exposed in the UI and is not a monetary budget.
- HeyGen webhook deliveries are persisted and signature-checked, then processed through an in-process FastAPI background task. Reconciliation can recover persisted work, but there is no always-on queue/worker or scheduled sweep; unrevisited jobs may require an explicit client/operator recovery call.
- OpenAI content/chat/image/revision provider attribution hooks are no-ops; no server-enforced OpenAI allowance or durable usage ledger is present. The quick-create and chat actions can start provider work without a usage/cost notice. A generated post uses two model calls (Sofía strategy and Leo output); chat and image actions can incur additional calls.
- Analytics currently exposes Facebook reactions, comments, shares, and a lifetime unique-media-viewer value where Facebook supplies it. The page requests each published draft separately and aggregates available values in the browser. There is no historical trend store, cross-platform report, conversion attribution, or operational Mía analyst.
- Local migration files include the additive language-preference migration and have exactly one Alembic head. No migration was run as part of this audit.

### Architecture evaluation

**Keep:** React + TypeScript + Vite, Supabase authentication, PostgreSQL, SQLAlchemy/Alembic, the closed route → application service → repository → database boundary, provider adapters, feature-oriented backend modules, and the existing per-feature frontend hooks. These choices fit the product and do not justify a rewrite or microservices.

**Improve incrementally:** `App.tsx` remains a large workflow coordinator; navigation is not URL-backed; `apiClient.ts` is used by campaigns while several other services duplicate session lookup, fetch, and error parsing; capabilities and preferences are available in backend contracts but are not consumed by the app. Consolidate only as feature work reaches those boundaries. A new global state framework is not justified.

## B. Existing workflow and data-flow map

```text
Supabase login/recovery
  -> user-keyed React workspace
  -> GET /businesses -> selected authorized business

Dashboard "Crear contenido"
  -> POST /businesses/{business_id}/generate-content
  -> fresh tenant/role checks + business profile/recent drafts
  -> Sofía strategy -> Leo structured output
  -> pending Draft (no campaign) -> Aprobaciones

Equipo IA / Sofía
  -> business-scoped conversation and shared message history
  -> Sofía reply saved as messages
  -> "Crear borrador con Leo"
  -> last ten user messages become generation instructions
  -> same Sofía -> Leo pipeline -> pending Draft -> Aprobaciones

Contenido (library)                    Campañas
  -> list/filter/preview/FB metrics      -> independent CRUD
  -> no create/edit composer             -> optionally associate existing draft

Pending Draft -> edit title/caption, media, approve/reject
  -> approved content is not editable through pending-only APIs
  -> explicit Facebook confirmation -> publish/verify/recover
  -> TikTok current UI: download completed video + copy caption for manual posting
  -> Instagram: connection state only

Confirmed Facebook publication
  -> per-draft metrics requests -> browser totals/details
  -> no durable historical series or campaign ROI
```

Conversation history and drafts are business-shared according to the existing authorization model; the UI should say so rather than imply a private personal chat.

## C. Problems, opportunities, and risk

| Priority | Verified issue | Customer impact / recommendation |
|---|---|---|
| Critical before public admission | `ALLOWED_USER_ID` still intentionally limits access. Registration is not public; the API flag is false and the UI has no signup. | Do not describe the current app as open self-service. Design and separately approve identity verification, admission, deduplication, abuse controls, and onboarding before any allowlist change. |
| Critical before public admission | OpenAI work has no server-side usage limit/ledger; quick create/chat do not show a cost/usage notice and extension hooks are no-ops. HeyGen has attempt allowances, but they are lifetime counts, not price tracking. | Add enforceable per-business limits/reservations for paid OpenAI work and show usage state before expanding admission. Never infer provider cost from text length. |
| Important for first customer | The dashboard’s “Create Content” is automatic generation, not quick manual creation. Sofía is a separate tab and its resulting draft goes to Aprobaciones, not a shared composer. | Provide one composer with manual/AI entry points; use Sofía for guidance and pass a confirmed brief into the same generation/draft contract. |
| Important for first customer | Backend capability/language APIs are not used in React. The UI shows approval and integration actions without role-aware presentation. | Load account/business capabilities, hide or explain unavailable actions, and retain server-side authorization as the actual security boundary. |
| Important for first customer | `App` displays Mía as “Disponible” when Facebook is connected, while `/account` says `mia_analysis: false` and Sofía's prompt says analysis is not available. | Remove the operational analyst claim. Label Results as Facebook data; add Mía only with a real, evidence-linked analysis workflow. |
| Important for first customer | UI is Spanish-only, while new language preferences default to English and are not configurable in UI. | Implement English-first chrome, pre-auth explicit locale selection, and independent interface/chat/content settings; make defaults visible and do not translate history. |
| Important for first customer | Content, approval, and media are spread across Dashboard, Contenido, Equipo IA, and Aprobaciones. The approval screen is also the primary editor/media workspace. | Make Draft the shared work item and composer/review/publish states distinct; avoid duplicating editor controls across pages. |
| Important for first customer | Members see some approval/connection controls they cannot use; the frontend does not consume `/account` capabilities. | Make navigation/actions capability-aware to reduce failed actions and role confusion. This is a UX gap, not evidence that backend authorization is bypassed. |
| Important for first customer | Campaigns are optional in the data model, but the dashboard presents “Planifica → Campañas” as step one and promotes campaign creation in the empty state. | Make “Create a post” primary and campaign assignment explicitly optional. Explain that progress means published posts, not campaign success. |
| Scale/reliability | Analytics makes one request per published draft using unbounded `Promise.allSettled`; no aggregate/cache endpoint exists. | Add bounded aggregation and coverage/refresh metadata before histories become large; never turn missing data into zero. |
| Scale/reliability | Multiple frontend services independently implement token retrieval, fetch and error parsing; section changes are not URL state. | Standardize request/error behavior as files are touched; add route/deep-link behavior if user testing confirms it improves navigation. |
| Validation gap | Responsive rules and accessibility affordances exist in CSS/components, but this audit did not render the app at target sizes or use assistive technology. | Treat responsive claims as unverified. Run browser-based keyboard, screen-reader, zoom, touch, and viewport acceptance before release. |

### Security and reliability assessment

**Positive controls observed:** strict allowlist and JWT validation; active application-user and tenant authorization; role policy enforced in services; tenant-scoped repository operations; reauthorization around long-running provider work; OAuth state and webhook protections; publishing claims/idempotency/recovery; media ownership and signed-URL path checks; private provider credentials; explicit human approval and publish confirmation; HeyGen generation recovery that avoids starting a second paid job.

**Release gates, not findings of a current cross-tenant exploit:** keep the allowlist until admission is intentionally approved; define verified-email admission before public signup; require UI capability wiring without trusting it for authorization; implement paid OpenAI limits before widening user access; audit provider-error logging and request logs for redaction. Source review found no basis to claim a tenant bypass, but this was not adversarial testing. In particular, membership revocation must continue to be checked by the service at persistence boundaries.

**Lower-risk hygiene:** `businessesApi.ts` logs the JWT header algorithm (not the token) to the browser console; `FacebookConnection.tsx` logs only whether a handoff hash is present. Remove unnecessary diagnostics during the API-client cleanup. Keep any provider error logging structured and redacted.

## D. Recommended product and technical architecture

### Product structure

Organize around the customer's job, not the agent roster:

1. **Home:** next action, drafts to finish, reviews awaiting the current user's role, confirmed recent publications, and connection/setup gaps.
2. **Content:** searchable work queue/library; one composer for manual and AI-assisted creation.
3. **Review:** pending items with preview, destination, media readiness, and role-appropriate approve/request-change actions.
4. **Results:** only sourced metrics, with platform, date/coverage, refresh time, and explicit unavailable states.
5. **Campaigns:** optional planning/grouping workspace, not a prerequisite for one post.
6. **Settings/Help:** separate personal preferences from business profile, integrations, team, and usage; show only capabilities actually implemented.

Keep stable route identifiers separate from localized labels. Use the existing account capability response as the UI contract, not hard-coded role or provider assumptions. Treat the server as authoritative for every operation.

### Draft-centered workflow

Keep one business-owned `Draft` as the shared work item: brief/request → text and media → optional campaign → pending review → approved immutable version → publication states/results. A manual draft and a generated draft should arrive at the same editor, review and publishing surfaces. Sofía should help define intent; Leo remains the existing generation capability, not a separate fake chat product. Campaigns attach to drafts but do not own them or gate creation.

For the first release, keep approved drafts immutable. Provide a copy/revise action that creates a new pending draft for customers who want to revise approved/rejected content. This preserves current server invariants without adding an unnecessary revision-history schema. If later product design requires formal change requests, versioned approvals, or audit history, define that lifecycle first and add an additive migration.

Language precedence should remain explicit: interface language is a user preference (or explicit pre-auth choice, then English); conversation language is a user default with a conversation/request override and a persisted conversation snapshot; marketing-content language is a business default with a request/draft override and a persisted draft snapshot. Changing a preference must affect new work only.

### Backend shape

Retain the modular monolith and closed layers. Reuse:

- `/account` for identity, feature flags, role/capability bootstrap; `/account/preferences` and `/businesses/{id}/preferences` for existing language persistence.
- `/businesses/{id}/memberships` for existing list/change operations; add invitations separately if team onboarding is in launch scope.
- `POST /drafts` for manual drafts, `POST /businesses/{id}/generate-content` for AI drafts, and existing Sofía conversation endpoints. Extend request schemas only for an agreed structured brief; do not make a client-supplied role, resource ID, campaign ownership, approval state, or destination authoritative.
- Existing campaign association, media attempts, storage ownership, publishing recovery, and analytics services.

Add a database migration only where durable state is actually required. Candidate changes are a provider-usage reservation/ledger and, if team invitations are included, an expiring single-use invitation table. Any such change must be additive, have one Alembic head, be tested from the deployed revision against disposable PostgreSQL with representative existing rows, and prove row preservation. No migration to Render is authorized by this plan.

## E. Improved customer journey

1. **Arrival:** Provide a public product landing page or a deliberate sign-in entry, with English as the first-render default. Provide an explicit English/Español choice before signup; do not infer a permanent choice from browser language.
2. **Account:** login, verified signup, email confirmation, and recovery have distinct success, retry, and access-denied states. Signup remains disabled until its admission policy and backend gate are approved.
3. **Business setup:** ask for business name, offer, audience, and goal first. Save a resumable short flow. Make detailed profile, brand voice, website, location, and frequency optional and editable later.
4. **Language:** independently choose interface, Sofía conversation, and marketing output languages. Explain that these can differ. Show the effective output language on the composer and saved draft.
5. **First post:** offer “Write it myself” and “Help me shape the idea.” Campaign defaults to none. Ask for the post goal/topic and intended creative platform; preview a concise brief before paid generation.
6. **Creation:** Sofía asks only for missing information, summarizes the brief, and offers an explicit create action. Leo generates through the existing pipeline. Manual and AI work land in the same composer with saved/unsaved feedback.
7. **Media:** optional image, uploaded video, or HeyGen. Show whether an action uses provider credits, current allowance, and recovery state before it starts. Show “Generating,” “Saving,” “Ready,” or “Needs attention,” not invented percentages.
8. **Review:** preview exact text/media/destination. Members can prepare/submit; Owners/Admins approve. A draft can be approved for manual use without connecting a social account. Approved content is immutable; a revision produces a new pending draft.
9. **Publish/export:** state the business, destination account, action, and outcome. Facebook is direct publishing with explicit confirmation and reconciliation. TikTok remains clearly marked manual export in the current UI; a download/copy is not a publication. Instagram is connection-only.
10. **Results:** show confirmed Facebook metrics with source, coverage, last refresh, and missing-data reasons. Offer a new campaign only when the customer wants to coordinate multiple posts.
11. **Return/team:** Home resumes incomplete work. Business switching preserves only valid business-scoped state. Settings show role-aware business controls and personal language separately. Tutorial is skippable, replayable, and has no provider/publishing side effects.

Every step needs loading, empty, retry, permission-denied, stale-session, and partial-provider-data feedback. Avoid raw provider errors and unsupported “ready” placeholders.

## F. Create Content versus Sofía, Leo, and Mía

### Recommendation

Adopt the proposed distinction, with one important adjustment: **Create Content is not yet a fast known-intent composer in source; it is a one-click automatic generator.** Do not merely rename the current button and assume the proposed behavior exists.

- **Create Content:** the fast path for a customer who knows the topic, audience/offer, desired outcome, creative platform, and output language. Let them type/paste a short brief or choose a manual draft. No campaign required.
- **Sofía:** the guided path for customers who want help deciding what to say or why. Keep the business-shared chat, but identify it as shared. Ask for missing information, summarize the proposed brief, and let the customer edit/accept it before creation.
- **Leo:** retain the current shared content-generation capability. Both entry paths must call the same application generation service and save the same pending `Draft` contract.
- **Unified Composer:** display editable text, media, language, platform/actual publishing destination, optional campaign, save state, and preview. Use one editor and one path into review.
- **Mía:** do not present as operational. Results are currently Facebook data, not an AI analyst. Reintroduce Mía only when a real service can cite the exact metrics/time period used, explain gaps, and avoid unsupported causal claims.

Sofía already passes context to Leo: the guided draft endpoint uses the last ten user messages as instructions, then invokes the same Sofía strategy and Leo structured-output sequence. The business profile/recent posts are reused and both entry paths create the same kind of pending draft. What is missing is a typed, customer-confirmed brief and one shared editing journey; the current handoff is a string assembled from user messages, not a versioned brief, and no campaign record is created from chat.

## G. Campaign recommendation

Keep campaigns optional and focused on coordinating multiple related posts around a goal, audience, time window, and supported destinations. They currently provide CRUD, status/dates, draft association, and publication-count progress. They do not schedule posts, create the campaign's drafts, provide cross-platform reporting, or prove business success.

Recommended changes:

- Remove campaign creation from mandatory onboarding and stop presenting it as step one for every customer.
- Rename campaign-oriented Sofía chat labels to “Planning chat” unless the user explicitly creates a campaign record.
- Let a composer draft save first; associate it to a campaign as an optional step. If association fails, preserve the draft and make retry easy.
- Label progress as “posts published,” not “campaign success” or ROI. Explain that a post published to multiple platforms counts once in campaign progress.
- Keep date fields informational until scheduling, timezone, approval-at-schedule, disconnect, and recovery policies are designed.
- Add campaign-level metrics only after historical source data and attribution semantics exist. Do not turn publishing counts into performance claims.

## H. Frontend and backend change inventory

| Work | Existing surfaces to reuse | Required work |
|---|---|---|
| Shell, language, capabilities | `App.tsx`, `AppShell.tsx`, `Sidebar.tsx`, `/account`, language preference APIs | English-first message catalogs; explicit locale selector; independent preference controls; load capability/role response; role-aware navigation; stable URL identifiers. |
| Onboarding/account | `AuthPage.tsx`, `BusinessForm.tsx`, `useBusinessSelection.ts`, `/account/register`, `/businesses` | Signup and verification UI only after admission approval; access-denied/resume states; shorter resumable business setup; business-profile edit endpoint/UI. Existing registration endpoint is allowlist-gated and is not public signup. |
| Team collaboration | `memberships/routes.py`, service, permissions, `/account` | Role-aware team screen using existing list/change APIs. If invitations are in scope, add invite/accept/revoke endpoints, token-safe single-use expiry rules, and an additive migration. |
| Composer/AI | `useDraftActions.ts`, `SofiaChat.tsx`, `services/sofiaApi.ts`, `draftsApi.ts`, content routes/services | Add manual draft client/form; add a typed brief to the generation request after contract review; unify editor, media, campaign selection, language, and preview. Retain the single generation application service. |
| Review/publishing | Approval page/actions, draft service, Facebook/TikTok routes | Consume capability flags; clarify manual-use approval vs direct publication; preserve immutable approved content, confirmation, claims, verification, and no automatic retry. Keep TikTok direct posting feature-gated. |
| Media/usage | Media feature/hooks, `usage_service.py`, HeyGen usage endpoint, execution hooks | Show HeyGen allowance/active jobs; add server-side OpenAI limits/attribution and user-facing usage state before multi-user admission. Add persistence only for durable reservations/ledger. |
| Campaigns/results | Campaign API/page, analytics page/service/repository | Make campaign entry optional; relabel publication ratio; add bounded/batched metrics contract and source/coverage/refresh labels before scale. No Mía narrative until implemented. |
| Accessibility/reliability | Shared UI, feature hooks, current component tests | Browser E2E for real backend routes with provider fakes; responsive/keyboard/screen-reader/zoom/mobile checks; stale-result and business-switch tests; consistent API errors. |

### Migration decision

No schema change is needed merely to wire the already-existing language tables/columns, account capability response, membership read/change APIs, or campaign/draft relationship into React. A durable OpenAI usage/reservation ledger and invitation records would require additive Alembic migrations. A formal draft revision/change-request model would also require a migration if adopted; it is intentionally deferred in favor of immutable approved drafts and a new pending draft. All new migrations must be tested from `91f6a20d3b8e` (or the then-current approved source head) on disposable PostgreSQL with existing business, membership, draft, campaign, social, conversation, and media records, and must verify exact preservation. Never apply them to Render without separate explicit approval.

## I. Prioritized roadmap and recommendation tradeoffs

Complexity is relative engineering effort, not a schedule estimate.

| Priority / recommendation | Customer problem → solution and expected benefit | Complexity | Main risk / mitigation |
|---|---|---:|---|
| Critical: public admission and capability policy | A login does not currently make this a public SaaS. Keep allowlist; define verified admission and use `/account` capabilities so users see what they can do. Benefit: safe, understandable onboarding. | High | Accidentally granting access or initial ownership. Keep allowlist and initial-owner provisioning separate until tested and approved. |
| Critical: paid-operation controls | OpenAI work has no durable tenant limits. Add atomic server-side reservations/limits and show usage before enabling more users. Benefit: predictable exposure and safer retries. | High | Usage/cost may be unknown or provider-reported late. Track attempts/reservations separately from money; fail closed and reconcile unknown jobs. |
| Critical: English-first independent language UX | Spanish-only UI and English-default AI are inconsistent. Add separate UI/chat/content choices backed by existing preference APIs. Benefit: clear, predictable results for bilingual owners. | Medium | Translating content/history or coupling UI and output languages. Persist effective language per new operation; never rewrite history. |
| Important: one composer and explicit brief | The current quick action generates without a user brief, while chat lives elsewhere. Create manual/AI entry paths into one draft/editor. Benefit: fewer repeated steps and more controllable output. | Medium | Overbuilding a generalized studio. Start with one caption/title/media preview and preserve the existing generation pipeline. |
| Important: role-aware review and truthful capabilities | Members see controls the server rejects; Mía appears available without an analysis service. Consume capability flags and label actual network actions. Benefit: trust and fewer dead ends. | Low–Medium | Frontend accidentally becomes the security boundary. Keep all service authorization and test forbidden requests independently. |
| Important: campaigns as optional organization | A one-post customer is nudged toward a campaign and progress can be mistaken for success. Default no campaign, allow later association, label publication counts literally. Benefit: quicker first value and clearer reports. | Low | Breaking existing associations. Preserve current nullable association and test deletion/reattachment behavior. |
| Important: accessible navigation and feedback | Seven equal sections, Spanish identifiers, generic errors, and no URL state increase cognitive load. Use task-based navigation, stable routes, actionable feedback, and browser validation. Benefit: less training and better mobile use. | Medium | Broad visual rewrite. Change one journey at a time and retain tested feature hooks. |
| Post-launch: evidence-backed Mía and advanced analytics | Owners want to know what worked, but current data cannot prove sales impact. First add sourced historical data/coverage; only then add explanations tied to those facts. Benefit: actionable learning without fabricated metrics. | High | Overclaiming causality or collecting unsupported data. Show provenance, time windows, uncertainty, and missing coverage. |

### Critical before any public launch

1. Keep `ALLOWED_USER_ID` enforced until separately approved admission is implemented and isolation-tested.
2. Define verified registration and first-business ownership; prevent client-selected user/tenant/role grants.
3. Add server-side OpenAI usage/abuse limits before widening paid endpoints; connect HeyGen's existing usage endpoint to customer-visible state.
4. Deliver English-first interface plus separate UI/conversation/content preferences.
5. Use role/capability responses in the UI, while retaining server authorization.
6. Remove false operational claims (especially Mía) and clearly label Facebook direct, TikTok manual export, and Instagram connection-only.
7. Pass isolated PostgreSQL authorization/concurrency/migration tests and browser journeys before any public rollout.

### Important for a useful first customer release

- Shared manual/AI composer; optional campaign association; clear media and approval states.
- Business profile editing and short onboarding.
- Team invitations if collaborative use is part of the launch promise; otherwise do not market team access yet.
- Accessible responsive UI, robust empty/retry states, first-post guidance, and no paid action as a tutorial side effect.
- Aggregated, bounded Facebook analytics with provenance and missing-data explanation.

### Post-launch or separately gated

- Mía's AI analysis, until sourced metric workflows exist.
- Scheduling, Instagram publishing, public TikTok Direct Post, billing automation, cross-network attribution, advanced campaign ROI, and additional agent personas.
- These features require independent provider/product readiness; do not expose them as working merely because a provider endpoint or data model exists.

## J. Revised Slice 8 implementation plan

Each phase is independently testable. The Phase 2 frontend foundation is complete; subsequent workflow and server-side entitlement work remains gated by its dependencies below.

| Phase | Scope and dependencies | Acceptance criteria |
|---|---|---|
| **8.0 — product/API decisions** | Confirm launch audience (private pilot vs public SaaS), admission policy, supported platform capabilities, role UX, language fallback, brief fields, approved-draft immutability, usage units, and whether invitations are launch-critical. No implementation. | Approved screen/state/API contracts; no claim that public signup, Mía, scheduling, TikTok direct publishing, or Instagram publishing is available unless its gate is met. |
| **8.1 — English-first SaaS foundation (Phase 2, complete)** | Add the responsive application shell, explicit pre-auth English/Spanish selection, persistent interface and AI conversation preferences, business-scoped marketing-content language, `/account` capability-aware navigation, business switching, and reusable status/usage UI. Reuse existing APIs; do not activate signup, trials, or billing. Implemented locally in `ef4bddf9ed6e3d5205e3cc6f2cc2938ff03d13e9`; no backend or migration changes. | All 208 frontend tests pass; TypeScript production build and ESLint pass. English is the default, Spanish is explicit, language scopes are independent, tenant state is cleared/scoped on business changes, and server authorization remains authoritative. Stable URL identifiers, resumable onboarding, and a unified composer remain later work. |
| **8.2 — onboarding and business profile** | Short, resumable setup; expose accurate access-denied/invited/no-business states; business profile edit service/route/UI. Keep `/account/register` allowlist-gated until separately authorized public admission. | Refresh/interruption resumes safely; duplicate registration cannot duplicate identity or create ownership; existing businesses remain unchanged; a new business is owned only by its authenticated creator; public feature flag remains false unless explicitly approved. |
| **8.3 — collaboration and invitations** | Frontend for existing membership list/change contracts. If invitations are approved, add single-use expiring tenant-bound invite service, routes, email-delivery boundary, additive migration, and revoke/accept lifecycle. | Owner/Admin/Member matrix matches server; no Admin privilege escalation; invite replay/expiry/foreign-business tests pass; last active Owner cannot be removed; disposable PostgreSQL concurrency tests pass; migration preserves existing records. |
| **8.4 — unified creation and composer** | Add manual draft UI/client; fast brief form; Sofía guided brief/summary/confirmation; Leo generation via the existing service; shared editor/preview/language/platform and optional campaign. | Manual and both AI paths create compatible tenant-owned pending drafts; no campaign is required; brief and output language are explicit; Sofía context is not silently discarded or repeated; provider failures preserve retryable UI state without duplicate unintended generation. |
| **8.5 — review, approval, and destination UX** | Separate composing from review and publication; use capability flags; clearly distinguish approval for manual use from direct publishing; preserve approved immutability and recovery. No new revision schema unless the product chooses formal change requests. | Member cannot approve/publish; Owners/Admins can; approval never publishes; edits after approval are blocked or create a new pending draft; Facebook confirmation/recovery remains idempotent; TikTok export is never marked published; Instagram remains connection-only. |
| **8.6 — media usage and recovery UX** | Surface HeyGen configured allowance, attempts, active jobs, and recovery. Add atomic server-side limits/attribution for OpenAI content/chat/images/revisions. Add an additive usage migration only if required for durable reservations/events. | Cancel means no paid call; concurrent requests cannot exceed limits; ambiguous jobs are reconciled without a new paid request; absent/invalid allowance fails closed; no fabricated prices; membership revocation blocks persistence; PostgreSQL race tests pass. |
| **8.7 — campaigns and results** | Reposition optional campaign grouping; clarify progress semantics; add bounded aggregate analytics and source/coverage/refresh metadata. Defer Mía. | Create one post without a campaign; association failure does not lose the draft; campaign progress matches confirmed publication IDs; missing metric is not zero; API work is bounded and partial failures are visible. |
| **8.8 — release acceptance** | Browser E2E with isolated DB and fake auth/providers; responsive, keyboard, screen-reader, zoom, and mobile checks; API/migration/security review. No production migration/deploy in this phase without separate approval. | Critical journeys pass for Owner/Admin/Member and multiple tenants in English/Spanish; no cross-tenant leakage, unapproved publish, duplicate paid generation, false capability, or data loss; full backend/frontend checks pass; release risks documented. |

### Trial and subscription dependencies (not activated in Phase 2)

The approved direction is a 14-day trial with no card required, limited AI usage, a subscription requirement after expiration, preservation of existing customer content, and protected operator access. Phase 2 adds only reusable presentation patterns; there is no trial clock, entitlement decision, billing integration, or subscription enforcement.

Before any trial or paid subscription is activated:

- Define the trial subject (account versus business), eligibility and one-time-use rules, authoritative start/expiry timestamps, timezone behavior, and server-side state transitions.
- Define entitlement and usage contracts with server-enforced AI limits, atomic reservations/concurrency behavior, retry and ambiguous-outcome recovery, and a clear no-allowance policy. Frontend indicators must display only server-provided values.
- Specify post-expiration read/export/recovery behavior so existing drafts, media, and business records remain available and no existing content is deleted or silently rewritten.
- Define subscription/payment provider, price and tax terms, cancellation/refund behavior, webhook authentication/idempotency, billing-state reconciliation, and failure handling before promising paid access.
- Define operator access separately from customer entitlements and audit its authorization; do not let an operator bypass tenant checks.
- Add disposable-PostgreSQL tests for eligibility races, expiry boundaries, concurrent quota reservations, revocation, provider retries, and data preservation; require security review and a separate activation approval.
- Keep `ALLOWED_USER_ID` enforced and public registration disabled until admission and abuse controls are independently implemented, tested, and approved.

## Product questions answered

1. **Does it solve a clear problem?** Yes in principle: help an owner produce and distribute consistent social content. Current implementation only partially packages that value into a simple customer journey.
2. **Does the end-to-end flow make sense?** The backend path does; the navigation and UI split the work across unrelated sections and do not guide a first-time owner through one post.
3. **Are features connected?** Partially. AI creates the same pending draft shape used by review/media; campaign association and analytics are adjacent but not integrated into a guided creation workflow.
4. **Do Create Content, Sofía, Leo, and campaigns work together?** Sofía-to-Leo is technically connected and uses business context; the direct Create action shares the generation service. Campaigns remain separate, and neither path provides a shared composer/confirmed brief.
5. **What is redundant?** Approval shortcuts on Home and the full approval queue overlap; the agent status board duplicates little operational value and overstates Mía. The library and approval queue show different tasks but need a common draft detail/editor.
6. **What should be simplified?** Make first post creation primary; reduce onboarding questions; move advanced business configuration to settings; group navigation by customer tasks; remove fake agent availability and unsupported provider actions.
7. **What should be combined?** Manual drafting, direct AI generation, Sofía-guided creation, editing, and preview should converge on one Draft composer and review path. Do not combine platform capability states or language preferences.
8. **What should be redesigned?** Auth/onboarding, Create Content, AI Team presentation, review/editor boundaries, role-aware settings, campaign empty states, language controls, and result coverage.
9. **What is missing for a viable first launch?** Product admission decision, English/Spanish experience, visible server capabilities and roles, user-safe paid limits, reliable first-post onboarding, business profile editing, and browser-validated core flows.
10. **What should wait?** Mía, advanced AI recommendations, post scheduling, cross-platform analytics/ROI, Instagram publishing, public TikTok Direct Post, billing automation, and more agents.
11. **Highest customer value?** A fast first successful post that uses the actual business profile, can be edited in the customer's chosen language, is human-approved, reaches a clearly supported destination, and returns truthful results.
12. **What differentiates it from disconnected AI tools?** A trustworthy closed loop: reusable business context → one controlled brief → platform-aware draft/media → role-appropriate approval → verified publication/export → sourced performance feedback. The product should optimize that loop, not increase agent or feature count.

The pricing and payment model is not established by this source audit. Full billing automation is not required for a controlled private pilot, but pricing, provider-cost responsibility, and any paid-plan/usage promises must be decided before a commercial paid launch.

## Validation and approval boundary

The audit itself was source-based and did not connect to a database or call external providers. Phase 2 validation after the audit ran the complete frontend suite (208 tests), TypeScript production build, ESLint, and formatting checks for the new app foundation files; the full-repository Prettier check still reports formatting drift in existing source files. No backend tests were needed because Phase 2 made no backend changes. No database queries, migrations, live provider calls, or paid calls were made during Phase 2.

The approved plan does not authorize public registration, removal of `ALLOWED_USER_ID`, activating trials or billing, paid provider usage, Render/database changes, live publishing, deployment, merge, or push. Phase 3 and trial/subscription activation require their own approval.

## Phase 3 implementation checkpoint

Phase 3 local implementation is complete and validated; it is not approved for customer access. The additive Alembic head `b8c2f7419d60` introduces durable customer-organization ownership, one entitlement per organization, idempotent usage reservations, and resumable onboarding/tutorial state. Legacy businesses remain unassigned to customer organizations. Downgrading this migration drops those new records and the new business-to-organization link; take a verified backup and confirm recovery requirements before any downgrade. No Render or production database was accessed.

Registration remains closed: `ALLOWED_USER_ID` is still required and enforced, `PUBLIC_REGISTRATION_ENABLED` does not bypass that allowlist, and `TRIALS_ENABLED` defaults off. The email/password form delegates credential handling to Supabase and is only shown when the server's public configuration endpoint advertises registration. This is a staged implementation, not a public-admission approval. A durable organization is keyed by the application user, not by email or browser state; this prevents repeated trials for that provisioned identity but cannot guarantee prevention of duplicate customer accounts.

The trial lifecycle is server-owned: a 14-day UTC entitlement starts in the first-workspace transaction, is unique to the customer's organization, and limits customer workspaces, campaigns, Sofía/Leo requests, and HeyGen attempts. Limits are operator-configurable. The current fail-closed defaults allow 20 Leo generations, two campaigns, no Sofía requests until a positive allowance is configured, and no HeyGen generations. Subscription checkout is unavailable and no payment or paid-provider request is part of onboarding. Expired customer entitlements preserve reads and business-profile edits; AI generation, new publishing, campaign mutations, and paid video generation are blocked, while existing publication recovery remains available.

OpenAI usage reservations are tenant-scoped, serialized per customer organization, and require idempotency keys. Successful results can be replayed; failed provider attempts with uncertain outcomes remain counted rather than risking duplicate paid work. HeyGen uses its existing durable attempt records plus a separate trial cap. These controls are operational safeguards, not perfect duplicate-account prevention or provider cost guarantees; limits and per-request spend policies still require operator review before any trial activation.

Mía is restored as **Planned — Marketing Insights**, not as a chatbot or working analyst. No performance metrics are fabricated. Future work should follow this evidence-backed feedback loop: **Sofía → Leo → customer approval → publishing → Mía → improved brief → Sofía/Leo**. Mía must cite tenant-scoped source metrics and time windows, disclose missing or insufficient data, distinguish correlation from causation, and only pass structured recommendations into a future brief; she must not edit or publish content or bypass usage limits.

Validation completed: the backend suite passed with 625 tests, including the isolated PostgreSQL tests; the frontend suite passed with 218 tests; the TypeScript production build, ESLint, and targeted formatting checks passed. The build reports the existing large-chunk warning, ESLint reports four existing Fast Refresh warnings, and the App test emits an existing Radix ref warning. A full-repository formatting check still reports drift outside the targeted modified frontend files.

Public registration, trial activation, and billing remain launch blockers requiring independent security, eligibility, concurrency, migration-preservation, authorization, and cost-control validation plus separate approval. The existing operator allowlist must not be removed as part of this phase. The unified composer, functional Mía analytics, payment-provider integration, and public admission are deferred.
