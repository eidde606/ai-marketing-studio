# Slice 8 — product audit and proposed implementation plan

Status: the baseline audit and roadmap remain proposed; Slice 8 Phase 1 implementation is in progress. Phase 2 has not started.

## Scope and evidence

The findings below describe the pre-Phase-1 baseline from React screens, hooks, services and CSS; backend routes, schemas, application services, authorization, provider workflows and tests on `feature/multi-tenant-foundation`. Current code takes precedence over older phase documentation. This is a source-based product/UX audit with automated regression/build validation, not an authenticated browser usability study or a live provider certification. Responsive findings below distinguish implementation risks from visually reproduced defects. Render was not queried or modified.

## Product recommendation

Make **Create a post → Review → Approve → Publish → See results** the primary journey. Campaigns are optional groups of related posts. Preserve Sofía and Leo as helpful collaborators within that journey. Present measured Facebook results honestly; do not present Mía as an operational AI analyst until an analysis workflow exists.

The application has substantial working content, media and tenant-authorization foundations. It is not yet a self-service SaaS: the single-user allowlist remains enforced, registration cannot provision application access, team administration has no HTTP interface, language settings are not wired through providers, and there are no enforced spending budgets. Those gaps cannot be completed solely in React.

## Audit findings

| Area | What works in code/tests | Confusion or missing capability | Recommended change |
| --- | --- | --- | --- |
| Campaigns | CRUD, dates/status, tenant-scoped association, nullable campaign on drafts, publication-based progress, preservation of content on deletion | Conversations use “New campaign” terminology even when no campaign record exists. Campaign completion is a publication ratio, not business success. | Keep campaigns optional; default to “No campaign.” Rename conversations “Planning chats.” Label progress “Posts published.” Explain archiving versus deletion. |
| Sofía and Leo | Business-scoped conversation history; Sofía strategy passed to Leo; generated drafts remain pending; authorization before provider work and before persistence | Users see agent activity inferred from draft existence, not actual workflow events. Conversation generation passes recent user instructions, not a persisted, explicitly accepted brief. Prompts force Spanish and contain restaurant-specific examples. | One planning panel with an editable brief and explicit “Create draft.” Show real request stages; persist a brief/version if presenting it as approved. Generalize industry examples. |
| Mía | Facebook post metrics can be fetched and summarized by the UI | `App.tsx` marks Mía available based on Facebook connection. No Mía analysis service exists; Sofía's prompt correctly says analysis is future work. | Remove the operational agent claim. Keep Results as measured data. Introduce Mía later with cited metrics, time coverage and uncertainty. |
| Creation/editing | Manual draft API; AI quick generation; title/caption editing; image generation/revisions; video upload and HeyGen scripts | Creation/editing is spread across dashboard, AI Team and Approvals. Content is largely a history browser. General draft PATCH edits only title/caption. Approved/rejected content cannot simply be revised through the pending-only edit path. | A single composer with manual and AI entry points, media, preview and optional campaign. Clearly separate script editing for a generation request from saving a draft script. Add revision/resubmission contracts before showing those actions. |
| Destinations | Backend explicitly checks selected connected destinations; publishing checks authorized business/resource access | AI schema returns `Facebook`/`TikTok`/`Instagram`, but automatic destination mapping recognizes lowercase and otherwise defaults to Facebook; conversation drafts also inherit Facebook default. Instagram creative targeting does not mean Instagram publishing exists. | Normalize supported destinations on the server; distinguish creative platform from publishing destination; never silently select Facebook for TikTok/Instagram content. Ask the user to choose a supported destination at review. |
| Approval/publishing | Separate approval and publication; Facebook confirmation/recovery; durable provider IDs and uncertain states; generated media does not approve or publish | Review queue doubles as editor and media studio. Current frontend saves connected destinations before approval, blocking the natural “approve now, connect later” journey. Rejection is terminal in existing edit APIs. | Separate composer, review queue and publication dialog. Explicitly design draft/review/revision transitions. Approval is for an immutable content/media/destination revision; edits invalidate approval. Never auto-publish. |
| HeyGen | Explicit paid confirmation; tenant asset access; bounded scripts; persisted attempts, fingerprints, leases, idempotency, reconciliation and storage readiness | Generic cost warning is not a budget. No per-business allowance, rate/concurrency policy, durable usage ledger or spend history. Provider completion and stored playable video are distinct states. | Add server-enforced allowances and reservations before widening access; show estimated/unknown cost honestly. Show “Generating,” “Saving video,” “Ready,” and “Check status.” Never create a fresh paid job to resolve an uncertain job. |
| Social integrations | Facebook, TikTok and Instagram OAuth/status paths; Facebook publishing; TikTok publishing/creator-info APIs | Current rendered TikTok workflow is download/copy for manual posting. Instagram has connection endpoints, not publishing/analytics endpoints. Connected does not mean publishing-ready. | Capability labels: Facebook direct publishing; TikTok manual export until the approved Direct Post experience is ready; Instagram connection only. Show account/page identity, reconnect requirements and per-action readiness. |
| Analytics | Real Facebook reactions/comments/shares; explicit missing-data handling; only confirmed publication IDs counted | No cross-network analytics, historical trend series, attribution to sales or AI recommendations. UI fans out one metrics request per published draft; deleted published content coverage differs from campaign totals. | Label source, coverage and refresh time; show unknown as unknown. Define whether archived/deleted publication history is included consistently. Bound requests and add caching/aggregate endpoints before scale. |
| Signup/onboarding | Login, password recovery, display-name update; business creation atomically adds the authenticated creator as Owner | No signup flow, app-user registration, invitations, resumable onboarding or tutorial. One long form asks for many profile fields. New Supabase users still fail the allowlist/app-user checks. | Add a separately gated registration path and short onboarding; do not reuse initial-owner bootstrap. Start with business name, offer, audience and goal; make detailed brand setup optional. |
| Business/account management | Membership-filtered business list, account-specific remembered selection, business visit guards, last-owner protection in membership service | Business response has no role/capabilities. No membership routes, business profile PATCH, ownership UI, account deletion/export or usage/billing interface. Many controls cannot reflect role accurately. | Add verified account/capability contracts and role-aware navigation. Separate personal preferences from business settings. Hide unimplemented account/team actions until supported. |
| Language | Backend has separate language preference placeholders in immutable context | UI, navigation identifiers, date formatting and prompts are Spanish; context preferences are not supplied to providers | English first render; explicit Spanish selector before authentication; independent UI, AI conversation and marketing output settings, persisted at appropriate scopes. |
| Responsive/accessibility | Mobile drawer, breakpoint rules, wrapping, focus states and reduced-motion rules; keyboard navigation tests | Large repeated CSS cascade; 16rem desktop sidebar begins at 768px, leaving narrow tablet workspace. Topbar wrapping is limited to 768–960px. Mobile login shows a large marketing block before the form. Drawer test emits a ref warning. Nested chat scrolling and long localized labels need real-device QA. | Consolidate shell styles; responsive compact navigation; compact mobile auth; flexible controls; keyboard-safe composer/dialogs; fix ref forwarding. Treat these as source-observed risks until browser reproduction. |
| Small-business usability | Familiar business profile, AI draft creation and human approval concepts | Seven peer navigation destinations expose implementation structure; generic technical errors and provider status names burden users; limited guidance from empty states | Use task-based navigation, one primary next action, contextual examples and short recovery instructions. Keep advanced controls in progressive disclosure. |

Key evidence: `frontend/src/App.tsx`, `components/AuthPage.tsx`, `components/BusinessForm.tsx`, `components/SofiaChat.tsx`, `components/AnalyticsPage.tsx`, `features/approvals/components/ApprovalPage.tsx`, `features/media/hooks/useHeyGenGeneration.ts`, `app/useBusinessSelection.ts`, `styles.css`; `backend/app/auth.py`, `features/access/permissions.py`, `features/businesses/routes.py`, `features/content/{service,context,execution,openai_provider,sofia_provider}.py`, `features/drafts/{schemas,service}.py`, `features/media/generation_service.py`, and the platform route modules.

## Proposed customer journey

1. **Arrival:** English login/signup page with a visible “English / Español” selector. A Spanish browser does not silently change the initial UI. Remember an explicit selection. Keep the form prominent on mobile.
2. **Account:** Sign up, verify email, then establish application access using verified issuer/subject. Resume safely after refresh or duplicate callback. Until registration is enabled, show the actual private-access state instead of a functional-looking signup button.
3. **Business setup:** “What is your business?”, “What do you offer?”, “Who do you want to reach?”, “What would you like this post to achieve?” Save short steps. Advanced voice, location, website and preferences remain optional. Existing invited users enter the invited business rather than creating another.
4. **Language setup:** Explicit independent selectors for “App language,” “AI conversation language” and “Marketing content language.” Default new choices to English. Explain that a Spanish interface can produce English posts, and vice versa. Do not rewrite historical content when preferences change.
5. **Welcome/tutorial:** Offer “Show me around” and “Skip.” A brief interactive walkthrough highlights business switching, Create, editing a draft, Review, and Publish. Advance through safe UI interactions with a local example; never spend credits, connect accounts or publish as a tutorial side effect. Replay from Help; keep completion/version per user, and reset example state on account/business change.
6. **First post:** “Write it myself” or “Help me create it.” Ask for goal/topic, creative platform and output language; campaign defaults to none. Sofía clarifies a brief; Leo drafts. Show an editable preview and a clear saved/unsaved indicator.
7. **Media:** Optional image, uploaded video or HeyGen. Review script, authorized avatar/voice, language and spend allowance before generating. Wait for stored playable media before review eligibility. Provide recovery without duplicate spending.
8. **Review:** Members prepare/submit; Owners/Admins approve or request changes. A solo Owner can review their own post. Approval and publishing are distinct actions. Any content/media/destination revision requires renewed approval.
9. **Publish:** Display business, exact social account, platform preview and approved revision. Explicit “Publish now” confirmation. Show processing and uncertain outcomes truthfully; offer status checks before retry. TikTok manual export stays marked unverified, never “published.”
10. **Return:** Home shows drafts to finish, reviews awaiting action and confirmed publications. Results shows actual Facebook metrics. Offer an optional campaign when the user wants to organize several posts, not during mandatory onboarding.

## Screen and navigation structure

| Screen / proposed route | Main content and behavior |
| --- | --- |
| `/login`, `/signup`, `/verify-email`, `/password-recovery` | Public locale selector, accessible forms, clear verification/recovery states. Signup remains gated until its backend contract exists. |
| `/onboarding` | Resumable short setup, independent language choices, optional social connection and tutorial. Handle no-access and invited-business branches. |
| `/b/:businessId/home` | One “Create a post” CTA, actionable review/draft counts, setup checklist, genuine recent activity. |
| `/b/:businessId/content` | Search/filter by status/platform/campaign; Drafts, In review, Approved, Published, Archived views only when supported by real states. |
| `/b/:businessId/content/new` and `/content/:draftId` | One composer: text, media, preview, language and campaign selector. Desktop split editor/preview; mobile stacked or tabs with persistent save action. |
| `/b/:businessId/review` | Review queue with preview, change request, approval and permission explanations. Member view shows own/shared submissions without approval controls. |
| `/b/:businessId/campaigns` and `/campaigns/:campaignId` | Optional goal/date grouping, associated content, actual publication progress. Dates do not promise scheduling. |
| `/b/:businessId/assistant` | Business-shared Sofía planning chats and explicit handoff to draft creation. Clearly identify shared history. Leo is part of creation, not a pretend separate chat service. |
| `/b/:businessId/results` | Facebook results, coverage, unavailable data and refresh timestamp. No invented trends or Mía narrative. |
| `/b/:businessId/settings` | Business profile, connections, team and usage tabs gated by actual capabilities and supported endpoints. |
| `/account`, `/help` | Personal display name, language, password/account functions actually supported; tutorial replay and concise contextual help. |

Primary navigation: Home, Content, Review, Results. Campaigns and AI Assistant remain accessible as secondary workspaces. Settings/Help live in the utility area. The business switcher is always visible; display the current role. Desktop uses a sidebar; tablet uses a compact shell; mobile uses a short header and accessible drawer. Routes use stable untranslated identifiers; labels are localized.

Every screen needs loading, empty, partial-data, permission-denied, stale-session and retry states. No generic “this section is ready” placeholder. Unsupported actions are omitted or clearly labeled unavailable with a factual explanation.

## Language design

| Preference | Scope and precedence | Must affect |
| --- | --- | --- |
| Interface | Explicit authenticated user preference; otherwise explicit pre-auth device selection; otherwise `en`. Authenticated preference is applied only for that account and cleared from active state at logout. | Navigation, dialogs, tooltips, accessibility labels, validation, errors, dates/numbers, status labels, tutorial and document language. |
| AI conversation | Explicit conversation override; otherwise user preference; otherwise `en`. Snapshot on the conversation/request. | Sofía replies and user-visible planning explanations. A business-shared conversation displays its language and changing it does not translate history. |
| Marketing content | Explicit draft/request override; otherwise business default; otherwise `en`. Persist the effective language on the draft. | Title, caption, hashtags, CTA, video script and relevant media-generation instructions. Voice compatibility is validated separately. |

Use typed `en`/`es` message catalogs with English fallback, pluralization and `Intl` formatting. Stable status/error codes are translated in React; do not expose raw provider exceptions. Brand names and user-authored text are not translated automatically. UI language never silently controls generated content. Preserve existing business content-language intent through explicit confirmation of legacy preferences; the English UI default does not rewrite Spanish drafts.

Wire effective conversation/output languages through request schemas, immutable operation context and provider adapters. Existing `LanguagePreferences` is only an extension point. Add explicit prompt rules and tests for all eight UI/conversation/content combinations. Persist the requested language and render it near the generated result; language detection may warn but must not silently regenerate paid content.

## Architecture and API fit

Retain React/TypeScript/Vite, Supabase authentication, existing feature folders, feature hooks, shared UI primitives and the modular-monolith backend. This is an incremental product redesign, not a framework replacement.

Frontend flow: route/page → feature workflow hook → typed API service → shared authenticated client. Backend flow: route → application service → authorization and scoped repository/provider → transaction boundary. No direct browser database writes for tenant resources; no provider secrets in React. Providers receive immutable business inputs rather than ORM entities.

Keep user-keyed workspace lifetime and business-visit guards. Separate account preferences from tenant state. Cache keys include user, business, resource and relevant locale; clear cached media and data on logout/revocation. Cancel obsolete reads and ignore late results, including A → B → A and media callbacks. Durable jobs remain server-owned across navigation. Do not abort a server mutation and assume it was undone. Keep mutation retries explicit; consolidate duplicated HTTP clients without introducing automatic paid-operation retries.

Add route-based navigation/deep links and lazy-loaded feature pages. Preserve browser Back and unsaved-change handling. Centralize design tokens, responsive shell, forms, status components, toasts and accessible confirmation dialogs. Avoid migrating all state into a new global store; shared workflow locks and server attempt records already have defined owners.

| Capability | Existing API reuse | Required addition or decision |
| --- | --- | --- |
| Business selection/creation | `GET/POST /businesses` | Verified `/me` or equivalent account bootstrap response with membership role/capabilities; business profile read/edit and preference persistence. |
| Registration | Supabase signup/verification primitives; existing JWT verification | New explicit verified-identity registration service, deduplication and rollback; controlled removal of single-user allowlist only after isolation acceptance. Initial-owner provisioning must remain offline. |
| Team/account | Existing membership policy and last-owner service | Tenant-scoped list/change/invite/accept routes, expiring single-use invitations, account lifecycle policy and audit events. Account disabling must preserve an active Owner in every business. |
| Drafts | `POST/GET /drafts`, draft PATCH, approve/reject/destinations, soft delete | Structured create brief/language, persisted script edits where offered, review submission/change-request/revision semantics and revision-aware approval. Do not invent states in React. |
| AI planning | Business generate-content and Sofía conversation/chat/draft endpoints | Independent language inputs; explicit reusable brief if exposed; platform normalization; generalized prompts and bounded usage. |
| Campaigns | Existing business-scoped CRUD and draft association routes | Reuse without mandatory assignment. Creating a draft and associating it are currently separate operations: preserve the draft and offer association retry if step two fails. |
| Media | Draft image/revision/upload/preview endpoints; business-scoped HeyGen generation/status/reconcile; asset catalog/assignment | Usage/budget API and policy, reservations, provider attribution and spend visibility. No browser-only limit. |
| Publishing | Facebook publish/verify/recovery; TikTok creator-info/publish/verify | Revision checks; TikTok required UX and operational readiness before exposing direct posting. Instagram publication and scheduling are separate future capabilities. |
| Results | Per-draft Facebook analytics/reach routes | Cache/aggregate/paginated contract for scale; historical snapshots needed before trends; Mía requires a real analysis workflow. |

Proposed new endpoint names and schemas must be frozen in Slice 8.0 before implementation; they are not claims about existing APIs. Keep unsupported sections gated during incremental rollout. Public registration, team administration and spend policy are part of the proposed SaaS completion scope and require backend work alongside the frontend.

## Authorization and spending requirements

Preserve current role policy: Members read, create/edit pending content, manage campaigns, use AI/media and submit; Admins additionally approve/publish, manage connections/assets, edit business settings and manage Members; Owners additionally manage Admins/Owners. Do not infer a Viewer role that the backend does not have. Last-owner protection remains enforced in services. Show capability-driven controls while the backend independently authorizes every request, resource and post-provider persistence step.

For HeyGen and other paid generation, add tenant/user attribution, an atomic allowance reservation, per-operation/concurrent-job limits and configurable business limits. Reserve before calling the provider; reconcile actual usage when known. Keep uncertain jobs reserved pending reconciliation. Record provider work even if authorization revocation prevents attaching its output. Use durable operation IDs and current duplicate protections across tabs/reloads. Return a stable limit-exceeded response with an actionable UI message. Price estimates must carry source/time and an uncertainty label; never present a text-length guess as a provider charge. If a reliable monetary upper bound is unavailable, enforce conservative operation/duration allowances and disclose the limitation.

API spending is separate from HeyGen web subscription credits; do not suggest a web subscription covers backend generation. See [HeyGen API pricing](https://www.heygen.com/api-pricing). TikTok Direct Post requires platform configuration, user authorization and an audit to lift visibility restrictions; existing routes alone do not establish release readiness. See [TikTok Direct Post documentation](https://developers.tiktok.com/docs/en/content-posting-api-get-started?enter_method=left_navigation). No paid/live validation was performed in this audit.

## Prioritized implementation sequence

| Order | Work package | Dependencies and acceptance gate |
| --- | --- | --- |
| P0 / 8.0 | Freeze screen/state/API contracts and capability matrix. Define registration rollout, review revisions, language scopes and usage policy. Capture browser baseline screenshots and reproduce responsive issues. | Approve this plan. Resolve backend contracts before rendering unsupported controls. |
| P0 / 8.1 | Backend SaaS prerequisites: verified registration, account/capability response, preferences, business editing, language propagation and destination normalization. Add usage enforcement before expanding paid access. | Preserve closed layers, isolation and offline bootstrap boundary. New users cannot acquire existing businesses by client-supplied ownership. |
| P0 / 8.2 | English-first localization, public selector, routing, shared API/error handling, role-aware responsive shell and state lifecycle. Lazy-load pages. | English first paint; Spanish explicit; no stale tenant data, raw technical errors or unsupported “working” features. |
| P1 / 8.3 | Signup/verification, resumable onboarding and interactive skip/replay tutorial; personal/business settings. Add team routes/UI with invitation and last-owner tests. | New user completes a real supported flow; duplicate callbacks are safe; tutorial causes no paid/external action. Keep allowlist cutover separately controlled. |
| P1 / 8.4 | Unified manual/AI composer, optional campaigns, brief-to-draft handoff, script/media controls and revision-aware review workflow. | First post needs no campaign; Member cannot approve; editing approved material requires reapproval; all outputs obey independent language choices. |
| P1 / 8.5 | Media/job recovery, cost/allowance display, explicit publishing confirmation and honest connection capabilities. | Double click/reload/concurrency cannot duplicate jobs or posts. Unknown provider outcomes lead to reconciliation. TikTok manual export remains unverified. |
| P1 / 8.6 | Results coverage/caching, account/team finishing, responsive/accessibility remediation, browser E2E and release acceptance. | Critical journeys pass at mobile/tablet/desktop sizes in both languages; no invented metrics or agent activity. |
| P2 / later | Mía insights with evidence; scheduling with timezone/reapproval rules; Instagram publishing; TikTok public Direct Post rollout; billing/payment integration; richer historical analytics. | Separate backend/provider readiness. Do not expose these as functional in Slice 8 before implementation and validation. |

Registration/capabilities and language contracts are release blockers, not optional polish. If Slice 8 is limited to frontend work, describe the deliverable as a redesigned private workspace and keep signup/team/usage controls unavailable; that narrower scope would not satisfy complete SaaS onboarding.

## Responsive and accessibility acceptance

Validate at 320, 375, 390, 768, 1024 and 1440 CSS pixels, landscape mobile and 200% zoom, using long business names and Spanish labels. No page-level horizontal overflow; media fits its container; dialogs remain usable with the software keyboard; sticky actions never cover fields or content. Use consistent flexible grids and a single coherent breakpoint policy rather than appended selector overrides. The sidebar must collapse based on available workspace width, not merely a desktop label.

Require keyboard-complete navigation, visible focus, focus trapping/restoration, meaningful labels, announced asynchronous status, errors associated with fields, usable contrast, reduced motion and approximately 44px primary touch targets. Validate drawer/dialog ref handling in a real browser. Tutorial highlights must be keyboard operable and must skip inaccessible/role-forbidden targets. Verify editor unsaved content survives language changes and is handled deliberately on business switching.

## End-to-end testing strategy

Use isolated local databases and deterministic fake provider/auth responses for browser tests; seed at least two businesses, two Owners, an Admin, a Member and a revoked identity. Keep test auth mechanisms out of deployable production paths. Run the actual React application against actual backend routes for the core E2E suite, with providers replaced at their boundaries. Existing component tests remain useful but are not browser E2E evidence.

| Journey / risk | Required checks |
| --- | --- |
| First arrival and languages | English without browser-language auto-selection; Spanish selected before signup; selection survives verification/recovery; all eight UI/chat/output combinations; correct locale formatting; no untranslated application chrome; old drafts/history unchanged. |
| Registration/onboarding | Email verification, duplicate callbacks, refresh/resume, interrupted setup, zero-business state, invitation acceptance/expiry/reuse, no ownership inference. |
| Tutorial | First visit, skip, replay, language change, keyboard/mobile operation, role-specific steps; assert zero provider/publish calls. |
| Simple creation | Manual and AI post with no campaign; edit/save/reload; requested platform and output language; optional campaign assignment and partial-failure recovery. |
| Collaboration/review | Sofía context scoped to business; Leo handoff; no fictitious Mía activity; Member submit and denied approval; Owner/Admin approval; edit invalidates approval; rejected content revision; unsupported state transitions rejected server-side. |
| Tenant isolation | Foreign draft/campaign/conversation/asset/account IDs in URL and payload; A → B → A during reads, media, OAuth, generation and publication; logout/login as another user; multiple tabs; revocation mid-request; stale signed media URLs/state cleanup. |
| Cost and generation | Cancel confirmation means zero calls; exhausted limit, concurrent reservations, duplicate click/tab/reload, timeout/unknown submission, reconciliation, storage failure, duplicate/out-of-order webhook, revoked asset access, attribution when output is discarded. |
| Publishing | Explicit approval and publish consent; selected account identity; media not ready; disconnect/expiry; duplicate submission; ambiguous response; recovery; partial per-platform success; download/copy never counts as publication. |
| Account/roles | Role capabilities match backend, stale capabilities cannot bypass it; Admin cannot promote to Owner; concurrent last-owner changes; account disable across multiple businesses; personal versus business preference boundaries. |
| Analytics | Confirmed IDs only, no data versus zero, partial failure, bounded refresh, accurate coverage labels, missing source/trend capability not rendered. |
| Responsive/accessibility | Browser screenshots and interaction tests at target sizes in English/Spanish; long labels; keyboard, zoom, drawer/dialog focus, software keyboard and reduced motion; manual screen-reader review for critical flow. |

Retain full backend regression and architecture tests; run disposable PostgreSQL concurrency tests for ownership, spending, approval and publication invariants. Add API contract tests for every new response/error and preference default. Run frontend component/unit tests, TypeScript/build and lint, plus Chromium/Firefox/WebKit browser journeys. Provider mocks cannot prove real OAuth scopes, public posting eligibility, paid generation or mobile platform behavior: later run explicitly authorized staging smoke checks with dedicated accounts and a strict spend cap.

Release gates: no cross-tenant leakage or role bypass; no unapproved publication; no repeat paid submission on recovery; complete independent-language flows; no functional-looking unavailable features; critical browser journeys and accessibility checks pass. Measure onboarding completion, time to first saved/approved/published post, failed/uncertain operations and spend per successful output without logging tokens or private prompts. Do not promise a quantitative improvement before collecting a baseline.

## Approval boundary

Approve the proposed scope and dependencies before implementation. This document does not authorize a public multi-user cutover, provider purchases, publishing, migration, deployment or merge. No Slice 8 code is included.
