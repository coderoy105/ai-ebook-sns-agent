---
name: codex-login
description: Implement a secure “Connect with ChatGPT for Codex” feature in a web app by wiring a browser device-code UX to an authenticated server bridge and a persistent Codex runtime worker. Use when a user asks to add the same Codex/ChatGPT account connection flow used by AI Book Studio, including connection status, disconnect, model availability, and using the connected Codex account for app features. Do not use this as a replacement for the web app’s own user authentication.
metadata:
  short-description: Add reusable Codex ChatGPT account connection to a web app
---

# Codex Login

Implement the reusable Codex account-connection pattern used by AI Book Studio.

This skill is for **connecting an already authenticated web-app user to a Codex runtime through their ChatGPT account**. It is not a generic “Sign in with ChatGPT” identity-provider integration and it must not replace the site’s own session/authentication system.

OpenAI currently documents that Codex clients can be used by signing in with a ChatGPT account. Treat the login flow as a Codex client/runtime authorization flow. Never claim that an arbitrary web app can directly receive or reuse a user’s ChatGPT OAuth tokens in the browser.

## When to activate

Use this skill when the user asks for any of the following:

- “Codex 로그인 기능 붙여줘”
- “ChatGPT 계정으로 Codex 연결하게 해줘”
- “AI Book Studio에 있는 Codex 로그인 기능을 다른 프로젝트에도 구현해줘”
- “Codex 로그인 후 그 계정 사용량으로 AI 기능을 쓰게 해줘”
- “device code 방식으로 Codex 연결 상태/로그아웃까지 만들어줘”
- “$codex-login”

Do not activate merely because the app has an ordinary email/password login page.

## Core rule

A correct implementation has three security boundaries:

1. **Browser UI** — shows device authorization state and user code, but never receives OAuth access/refresh tokens.
2. **Web application server** — authenticates the app’s own user, maps that user to a Codex connection, and calls the runtime through a server-only authenticated channel.
3. **Persistent Codex runtime** — owns `CODEX_HOME`, runs the Codex client/app-server, persists the ChatGPT/Codex credential lifecycle, and executes Codex work for that user.

Do not collapse all three into a browser-only implementation. Do not persist Codex auth files in a stateless serverless filesystem.

## First inspection

Before editing a repository, inspect:

- framework and routing (`Next.js App Router`, Pages Router, React + API server, etc.);
- existing user authentication and how a stable user ID is obtained server-side;
- deployment target for the web app;
- whether a persistent container/VM service already exists;
- database availability for **non-secret connection metadata only**;
- whether the project already contains Codex runtime code that should be reused rather than duplicated;
- whether the requested feature is only “connect/status/disconnect” or also needs actual Codex generation.

If a persistent runtime is missing, explain that serverless-only storage is insufficient for durable Codex client credentials and add/provision a persistent worker as part of the plan. Do not pretend an ephemeral function can safely provide durable per-user Codex sessions.

## Reference implementation

The canonical working implementation for this skill is the current `coderoy105/ai-ebook-sns-agent` codebase. Read `references/source-map.md` before porting. The important pieces are:

- browser client: `lib/ai/codex-browser.ts`
- device-code UI: `components/chatgpt-device-code-panel.tsx`
- authenticated connection handlers: `lib/api/ai-connection-handlers.ts`
- runtime bridge: `lib/ai/codex-runtime-client.ts`
- persistent runtime: `services/codex-worker/`

Port the **architecture and security properties**, not project-specific naming such as book generation, Luna-only assumptions, or AI Book Studio copy.

## Implementation workflow

### 1. Define the product contract

Implement these operations first:

- `connect()`
- `getConnectionStatus()`
- `disconnect()`
- `listAvailableModels()` when the app needs model selection
- `runCodexTask()` only when the user requested actual Codex-powered features

Return a normalized status object such as:

```ts
export type CodexConnectionStatus = {
  connected: boolean;
  authMode?: string | null;
  email?: string | null;
  planType?: string | null;
  models?: string[];
  selectedModel?: string | null;
  modelAvailable?: boolean | null;
  rateLimits?: unknown;
};
```

Do not expose raw credentials, refresh tokens, access tokens, auth files, cookie jars, or `CODEX_HOME` paths in this object.

### 2. Browser/device-code client

Create a small client module modeled after `lib/ai/codex-browser.ts`.

The browser flow should:

1. POST to the app’s Codex connection endpoint.
2. Receive either `already_connected` / `connected`, or a device authorization payload containing `loginId`, `verificationUrl`, and `userCode`.
3. Validate that the verification URL is HTTPS and belongs to a trusted OpenAI/ChatGPT host before rendering it.
4. Display the user code clearly and make copy-to-clipboard best effort only.
5. Require the user to intentionally open the verification page; do not silently open popup windows.
6. Poll status or consume an NDJSON stream until connected.
7. Time out cleanly and leave the UI recoverable.
8. Provide an explicit disconnect action.

A connection button should reflect these states: idle → preparing code → waiting for user authorization → connected → error.

### 3. Device-code UX

Create a dedicated component rather than embedding raw authorization details in miscellaneous UI.

It should show:

- “ChatGPT로 Codex 연결” or equivalent product copy;
- the one-time user code in large selectable text;
- a copy button;
- a user-initiated “OpenAI 인증 페이지 열기” button;
- waiting/connected/error state;
- clear text that the code is entered on OpenAI/ChatGPT, not into the web app itself.

Never ask the user to paste passwords, session cookies, access tokens, refresh tokens, or browser storage into the product.

### 4. Authenticated web-app server boundary

The web app’s connection endpoint must require the app’s own authenticated user.

Typical REST contract:

```text
GET    /api/codex/connection   -> status
POST   /api/codex/connection   -> start/continue device auth
DELETE /api/codex/connection   -> logout
```

A legacy route such as `/api/auth/openrouter/connection?provider=codex` may be retained when porting an existing codebase, but new projects should prefer a Codex-specific route name.

On every request:

- derive `userId` from the server-side authenticated session;
- never accept a caller-supplied arbitrary `userId` as authority;
- call the persistent runtime using server-only authentication;
- store only non-secret profile/status metadata in the database if useful;
- return normalized safe fields to the browser.

### 5. Persistent Codex runtime

For production, run Codex in a long-lived container or VM with persistent storage.

Each app user must get an isolated `CODEX_HOME` directory. Derive the filesystem directory from a one-way hash of the app user ID rather than using raw identifiers in paths. Make each directory private to the worker process (for example `0700` on Linux).

The runtime service should expose only a narrow internal API, for example:

```text
POST /auth/start
GET  /auth/status?userId=...
POST /auth/logout
GET  /models?userId=...
GET  /usage?userId=...
POST /generate
GET  /health
```

Internally, start the Codex app-server/client for that user’s `CODEX_HOME`. The proven AI Book Studio pattern starts device authorization through the Codex account login RPC and then reads account/model/rate-limit state from the same runtime.

Do not invent token exchange endpoints or scrape ChatGPT cookies.

### 6. Runtime-to-web security

The runtime must not be an unauthenticated public AI proxy.

Use one of these server-to-server protections:

- platform-issued workload identity/OIDC, preferably when available; or
- HMAC request signing with timestamp + nonce + replay protection over HTTPS.

Requirements:

- HTTPS only in production;
- reject stale/replayed signed requests;
- validate action and schema;
- validate user IDs;
- never log authorization headers or credential file contents;
- never return raw OAuth/Codex credentials;
- keep the worker shared secret server-only;
- add reasonable request timeouts and concurrency limits.

If the web platform supports workload identity (for example Vercel OIDC), prefer it for the web-app → internal runtime hop and keep any worker-specific secret isolated behind that bridge.

### 7. Credential persistence

`CODEX_HOME` is sensitive credential state.

Production requirements:

- persistent volume mounted only into the runtime worker;
- never commit credential files;
- never place them in build artifacts;
- never synchronize them to client storage;
- never store raw auth files in Supabase/Postgres;
- delete the user’s runtime credential directory on explicit disconnect when that is the product contract.

Database tables may contain safe metadata such as:

- user ID foreign key;
- connected email if the runtime reports it;
- plan label if reported;
- last verified model list;
- selected model;
- last verified timestamp;
- non-secret rate-limit snapshot.

### 8. Model selection

Do not hardcode a model name simply because the reference project did.

For a reusable implementation:

1. query the runtime’s actual model catalog;
2. prefer the user-requested model when present;
3. otherwise choose a documented/configured fallback;
4. surface `modelAvailable: false` instead of silently substituting a different model when strict selection was requested.

Project-specific policies may pin a model, but the skill itself should stay model-agnostic.

### 9. Using the connected Codex account

Only after the connection status is confirmed should Codex-backed actions be enabled.

When implementing task execution:

- send prompts/tasks from the authenticated server, not directly from the browser to the worker;
- attach the server-derived user ID;
- create a separate runtime turn/thread for independent operations unless the product explicitly needs conversation continuity;
- enforce output schema for structured data;
- bound timeouts below the hosting platform’s hard limit;
- disable unnecessary tools/network for generation-only jobs;
- return safe usage metadata, not credentials.

For long-running work, use a background-job system and cache recent connection status rather than probing account/model/rate limits concurrently on every UI render.

### 10. Error model

Normalize important errors so UI can recover correctly:

- `CODEX_CONNECTION_REQUIRED`
- `CODEX_CONNECTION_EXPIRED`
- `CODEX_DEVICE_CODE_START_FAILED`
- `CODEX_LOGIN_DID_NOT_COMPLETE`
- `CODEX_LOGIN_URL_INVALID`
- `CODEX_RUNTIME_UNAVAILABLE`
- `CODEX_WORKER_TIMEOUT`
- `CODEX_MODEL_UNAVAILABLE`

Treat transient runtime/network errors separately from explicit authentication expiry. Do not force a new login merely because one status probe timed out if a recently verified connection can safely be reused for an already running job.

## Verification gate

Do not call the feature complete until all applicable checks pass:

1. unauthenticated app users cannot start/status/logout another user’s Codex connection;
2. device code is shown and verification URL is trusted;
3. successful ChatGPT authorization transitions UI to connected;
4. page refresh preserves connection through the persistent runtime;
5. logout actually disconnects and removes persisted user runtime credentials according to policy;
6. raw credentials never appear in browser responses, logs, DB rows, git changes, or CI artifacts;
7. two test users are isolated from one another;
8. model list comes from the runtime, not a fabricated constant;
9. requested Codex-backed action works after login;
10. build, typecheck, lint, and tests pass;
11. production health endpoint is healthy;
12. inspect recent runtime errors after deployment.

Read `references/implementation-checklist.md` for the concrete porting checklist.

## Deployment guidance

A serverless web app can host the UI and safe bridge routes, but durable Codex auth state belongs in a persistent runtime.

When deployment tools are available, carry the implementation through deployment and health verification. When the persistent worker host is not available, stop at a truthfully testable boundary and state exactly what is not deployed. Never claim Codex login is production-ready if the worker’s persistent storage is missing.

## Security and product boundaries

- This skill connects Codex; it does not authenticate the website user.
- Never request or collect a user’s ChatGPT password.
- Never copy browser cookies/session storage from chatgpt.com.
- Never expose Codex OAuth tokens to frontend JavaScript.
- Never place the Codex runtime credential directory on a public/shared volume.
- Never use a service-role database key in browser code.
- Never bypass workspace/admin restrictions.
- Never claim that a plan/model is available until the runtime confirms it.
- Do not label the feature “OAuth login for my website” unless the project separately uses the official Sign in with ChatGPT identity feature; keep the Codex connection UX conceptually separate.

## Final report

When implementation is complete, report:

- repository and commit;
- connection route(s);
- persistent runtime location/status;
- credential persistence strategy;
- implemented UI states;
- model-selection behavior;
- test/CI result;
- deployment result and health check;
- any remaining infrastructure dependency.
