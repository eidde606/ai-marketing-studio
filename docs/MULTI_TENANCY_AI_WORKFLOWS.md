# Slice 5: AI content and assistant authorization

Base: `f3cf5af65104e82b31499a4b3bca4a6073db4df8`, branch `feature/multi-tenant-foundation`.

## Workflow map

All content routes retain Supabase verification and `ALLOWED_USER_ID`, and resolve
`AuthenticatedPrincipal` through the existing access service. Application services
obtain fresh `TenantAccess`; repositories constrain all business-owned queries.

| Route / workflow | Permission and scoped persistence |
| --- | --- |
| POST business generate-content | USE_SOFIA, USE_LEO, EDIT_CONTENT; profile and ten recent drafts; insert pending draft |
| GET Sofía conversations | READ; scoped pagination and first user message |
| GET conversation / latest | READ; scoped conversation and complete paginated message history |
| POST Sofía chat | USE_SOFIA, EDIT_CONTENT; scoped profile and history; atomic conversation/messages insertion |
| POST conversation generate-draft | USE_SOFIA, USE_LEO, EDIT_CONTENT; scoped user instructions and recent drafts; pending draft |
| DELETE conversation (new, 204) | USE_SOFIA, EDIT_CONTENT; locked scoped conversation and message deletion |

Owner, Admin, and Member can use these workflows. AI output cannot set IDs,
business ownership, campaign association, approval, or publishing fields. Only
known content fields are accepted. Existing Member approval restrictions remain.
Conversations and output remain business-shared. No membership is provisioned.

The only supported AI resource selector is conversation_id. Foreign conversations
and message IDs used as conversation IDs yield the same non-disclosing 404.
Unsupported structured campaign/draft/message/business IDs now return 422, including
on optional generation request bodies. Empty or absent generation bodies still work.
IDs in natural-language text are inert text: providers have no lookup tools or
repository access. Campaign records and arbitrary drafts/messages are not fetched
from those IDs. Existing draft editing and campaign association remain Slice 4
workflows, not new AI capabilities.

## Provider and transaction boundary

Routes → content service → scoped repositories → database. Provider calls use
adapters → existing OpenAI/Sofía SDK adapters, with detached immutable profile and
message snapshots. No tenant state is cached or stored on the reusable SDK client.
No content-feature background tasks exist. Image/video generation and media jobs
remain in their planned integration slice.

Read transactions end before network work. Chat no longer flushes unsaved messages
before calling the provider; successful external behavior and saved history are
preserved. Provider errors log only their exception class, never provider messages,
prompts, tokens, or tracebacks. Models, prompts, SDK calls and platform/destination
behavior remain unchanged.

Before saving output, authorization is resolved again. The shared access service's
optional lock mode takes the business lock first (matching membership mutations),
then freshly reads and locks active user/membership rows. Locks remain through the
short persistence transaction. A revocation/disable committed first blocks the save;
if saving obtains locks first, revocation waits until it commits. This is a defined
transaction ordering, not cancellation of already committed output. Conversation
existence is rechecked under a scoped lock; deletion during generation cannot
resurrect a conversation. Failure rolls back all pending writes and releases locks.
Provider calls cannot be canceled retroactively; discarded results may incur costs.
Concurrent chats may generate against the same earlier history; their message pairs
save atomically, but conversational optimistic versioning is not implemented.

## Extension points and remaining work

`OperationContext` carries trusted business/user/request IDs and operation name.
`before_generation` is a future tenant usage-limit gate; `after_generation` is a
future provider-work attribution sink, including work later discarded. Both are
currently stateless no-ops. `ProviderUsage` defines optional model/token/cost fields;
actual SDK usage is not yet captured and unknown values must not be invented.
Independent interface/conversation/marketing-content language slots default to None;
current Spanish prompts are preserved. No billing, limits, pricing, persistence,
subscription plans, or full internationalization are implemented.

The guarded service-operation inventory falls from 112 to **90** pairs: 23 content
legacy edges are removed, and one reviewed access-service business-lock edge is
added. The membership query has an additional fresh locked call. The inventory
includes legitimate non-tenant identity/bootstrap calls; it is not a vulnerability
count. Old unused content repository compatibility functions are not authorization
entry points; all content service callers now use scoped APIs.

Social connections/OAuth, publishing, analytics, media/storage, HeyGen and background
workflows still require their planned authorization integrations. Do not enable
multi-user admission. `ALLOWED_USER_ID` remains mandatory. No schema, migration,
production data, ownership manifest, frontend, or provider configuration changes.

## Validation

Focused tests cover all roles, inactive/missing memberships, multi-business users,
foreign resource references, pending-only output, provider context/history isolation,
complete message pagination, deletion, sanitized failures, and revocation before
output persistence. Existing real orchestration tests mock only SDK responses and
verify unchanged model/prompts and destinations. Disposable PostgreSQL tests exercise
four provider waits and membership/user changes during authorization lock waits.
Full-suite results and the local commit are recorded in the delivery report.

Validation completed: **536 passed**, including **17 isolated PostgreSQL tests**
(six added in this slice). Focused AI/regression/architecture run: 68 passed;
four additional isolation/architecture tests subsequently passed in the full suite.
Python compilation and `git diff --check` passed. The sole warning is the existing
Starlette/httpx TestClient deprecation. All provider network calls were mocked;
no live provider or production database was accessed.
