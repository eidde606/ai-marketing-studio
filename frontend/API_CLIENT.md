# Shared API client: Phase 1

Only `src/services/campaignsApi.ts` uses the new client in this phase. Other API
services, React components, Supabase setup and backend code are unchanged.

## Follow a campaign request

1. `CampaignsPage` calls a function such as `createCampaign(businessId, input)`.
2. `campaignsApi.ts` chooses the existing URL and HTTP method, serializes the
   input with `JSON.stringify`, and sets `Content-Type: application/json`.
3. `lib/apiClient.ts` calls the existing `supabase.auth.getSession()`, adds the
   current bearer token, and sends one `fetch` request to FastAPI.
4. FastAPI handles authentication and the campaign operation as before.
5. The client reads the JSON response. The campaign function returns it to the
   component, which updates its state. A rejected promise reaches the component's
   existing error handling instead.

The component decides what the user sees. The campaign service describes campaign
operations. The shared client handles the repeated HTTP and authentication work.
No classes, new dependencies, token cache or automatic retries are introduced.

## Request bodies

The client accepts ordinary `RequestInit` options. It does not guess how to encode
a body. JSON callers supply both a serialized body and its header:

```ts
apiRequest<Campaign>(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
}, "No se pudo completar la operación de campaña.");
```

A future upload caller can pass `FormData` directly and omit `Content-Type`.
The browser then generates the multipart boundary. The client neither converts
FormData to JSON nor forces a JSON header. Existing uploads are not migrated.

## Compatibility rules

- The base URL still uses trimmed `VITE_API_BASE_URL`, falling back to
  `http://127.0.0.1:8000`. No environment variable is added or changed.
- Campaign URLs, encoded IDs, methods, payloads, null values and returned JSON
  remain unchanged.
- Authentication failure still throws `Debes iniciar sesión.` before fetching.
- A string FastAPI `detail` remains the HTTP error message, including an empty
  string. Non-string detail or an invalid error body uses the campaign fallback.
- Network failures propagate unchanged. `deleteCampaign` retains its existing
  special Spanish message for `TypeError` failures.
- Successful responses are still parsed as JSON. An empty/204 or malformed JSON
  success response still rejects; this client is not for binary downloads.
- The generic return type helps TypeScript callers; it does not validate response
  fields at runtime.
- No request is automatically retried, and no new refresh-token flow is added.

## Tests and checks

`services/campaignsApi.test.ts` has 27 contract tests. They passed against the
original campaign service before extraction and against the migrated service.
They verify all campaign operation URLs, methods and bodies, authentication,
HTTP errors, malformed responses, and deletion-specific network errors.

`lib/apiClient.test.ts` has 16 cases covering current tokens, headers, fresh session
lookup, base-URL fallback, JSON and FormData bodies, abort-signal forwarding, and
error propagation without retries. Supabase and fetch are mocked; these tests do
not contact a live backend or external provider. The five Phase 0 campaign UI
tests remain in the full frontend suite.

Run from `frontend`:

```sh
npm test -- --no-file-parallelism
./node_modules/.bin/tsc --noEmit --incremental false
npm run lint -- --format json
npm run build
```

Full-project lint has pre-existing findings outside this phase: an unused
`TikTokConnection` import in `App.tsx`, and Fast Refresh warnings in `badge.tsx`
and `button.tsx`. These are deliberately left for separate work. The Phase 1
TypeScript files have no lint findings.

Tests establish request compatibility with mocks, not live authentication,
browser CORS, or end-to-end backend compatibility. Other services may have
different error contracts; characterize those before migrating them later.
