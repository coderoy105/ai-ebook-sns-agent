# Codex Login Reference Source Map

Use the current AI Book Studio implementation as the working reference when porting the feature to another repository.

## Browser client

`lib/ai/codex-browser.ts`

Responsibilities:

- starts Codex connection from the browser;
- consumes `connected` or `device_code` responses;
- validates OpenAI/ChatGPT verification URLs;
- copies user code best-effort;
- polls connection state when needed;
- supports disconnect;
- exposes a browser event when connection completes.

Port the state machine and security checks. Rename routes and product strings to match the target app.

## Device authorization UI

`components/chatgpt-device-code-panel.tsx`

Responsibilities:

- displays the one-time device code;
- lets the user copy it;
- opens the trusted verification URL only from an explicit user action;
- shows waiting and connected states;
- avoids requesting passwords/tokens from the user.

## Authenticated application-server handlers

`lib/api/ai-connection-handlers.ts`

Responsibilities:

- requires the app's own signed-in user;
- derives user ID server-side;
- starts/statuses/logs out Codex through the runtime bridge;
- stores only safe profile metadata;
- reuses cached verified status during active long-running jobs to avoid runtime contention;
- maps runtime failures to recoverable HTTP errors.

The AI Book Studio route name is legacy/shared with OpenRouter. New projects should prefer a Codex-specific endpoint.

## Web app → runtime bridge

`lib/ai/codex-runtime-client.ts`

Responsibilities:

- makes server-only requests to the runtime;
- uses platform workload identity (`@vercel/oidc`) for internal authorization in the reference app;
- applies abort/timeouts;
- never passes browser-controlled identity as authority;
- normalizes runtime errors;
- invokes status/start/logout/generate operations.

If the target host does not support Vercel OIDC, replace this with another server-to-server authentication layer such as HMAC request signing over HTTPS.

## Persistent Codex runtime

`services/codex-worker/`

Important files:

- `services/codex-worker/server.mjs`
- `services/codex-worker/README.md`
- Docker/runtime package files in the same directory

Responsibilities:

- one isolated `CODEX_HOME` per app user;
- long-lived Codex app-server/client process;
- device-code login start;
- account/status/model/rate-limit reads;
- logout and credential directory cleanup;
- Codex task execution;
- persistent volume ownership;
- internal request verification.

## Reference runtime API

The current worker exposes an internal contract equivalent to:

```text
POST /auth/start
GET  /auth/status?userId=...
POST /auth/logout
GET  /models?userId=...
GET  /usage?userId=...
POST /generate
GET  /health
```

Do not expose these endpoints as an unauthenticated public API.

## Database metadata

AI Book Studio keeps non-secret Codex connection/profile metadata separately from the real Codex credentials. Follow the same principle in other apps.

Safe examples:

- app user ID;
- email/plan label reported by the runtime;
- selected model;
- whether the requested model was observed;
- non-secret rate-limit snapshot;
- last verification timestamp.

Do **not** store raw Codex credential files, access tokens, refresh tokens, ChatGPT cookies, or the contents of `CODEX_HOME` in the database.

## Project-specific pieces not to blindly copy

Do not automatically copy these AI Book Studio assumptions:

- `gpt-5.6-luna` as a hardcoded model;
- book-generation prompts/schema;
- OpenRouter route naming;
- Supabase table names;
- Vercel-only deployment code;
- AI Book Studio UI copy.

The reusable skill should discover the target project's stack and the runtime's actual available models, then adapt the architecture.
