# Codex Login Implementation Checklist

Use this checklist when applying `$codex-login` to a target repository.

## A. Inspect before editing

- [ ] Identify frontend framework/router.
- [ ] Identify existing site authentication and server-side `userId` source.
- [ ] Identify database and whether a connection-profile table already exists.
- [ ] Identify web deployment platform.
- [ ] Identify persistent container/VM host and persistent-volume support.
- [ ] Search for existing Codex/ChatGPT/Codex CLI integration before creating duplicates.
- [ ] Confirm whether the user wants connection only or actual Codex task execution too.

## B. Browser layer

- [ ] Add a typed Codex connection client.
- [ ] Implement `connect`, `status`, `disconnect`.
- [ ] Handle connected vs device-code response.
- [ ] Validate verification URL host/protocol.
- [ ] Add one-time code UI.
- [ ] Add copy button.
- [ ] Make opening the OpenAI/ChatGPT verification page user initiated.
- [ ] Add waiting, connected, error and timeout states.
- [ ] Ensure no raw credential/token is ever present in browser payloads.

## C. App server layer

- [ ] Add authenticated connection API route.
- [ ] Derive user ID from the app session on the server.
- [ ] Never authorize by arbitrary `userId` sent from the browser.
- [ ] Add start/status/logout handlers.
- [ ] Add safe error mapping.
- [ ] Add runtime timeouts.
- [ ] Add optional safe metadata persistence only.

## D. Persistent runtime

- [ ] Deploy a long-lived Codex runtime process.
- [ ] Mount a persistent private volume.
- [ ] Isolate each user in their own hashed `CODEX_HOME` directory.
- [ ] Restrict directory permissions.
- [ ] Implement login start.
- [ ] Implement account/status read.
- [ ] Implement model catalog read.
- [ ] Implement usage/rate-limit read when supported.
- [ ] Implement logout and credential cleanup.
- [ ] Implement task execution only if requested.
- [ ] Add health endpoint.

## E. Internal security

- [ ] HTTPS in production.
- [ ] Use OIDC/workload identity or HMAC-signed internal requests.
- [ ] Validate timestamp and nonce when using HMAC.
- [ ] Reject replayed requests.
- [ ] Validate action name and body schema.
- [ ] Validate server-derived user ID format.
- [ ] Never log auth headers/tokens/Codex credential files.
- [ ] Never return auth files/tokens from worker APIs.
- [ ] Store internal secrets only in server/worker environment variables.

## F. Model behavior

- [ ] Read real available model catalog.
- [ ] Select the user-requested model only if present.
- [ ] Define explicit fallback behavior.
- [ ] Surface strict model unavailability instead of silently substituting.

## G. Long-running task behavior

- [ ] Use server/background jobs for long Codex turns.
- [ ] Bound execution below platform hard timeouts.
- [ ] Avoid repeated status/model probes that contend with active generation.
- [ ] Cache recently verified non-secret status where safe.
- [ ] Separate transient worker errors from auth expiry.

## H. Tests

- [ ] Unauthenticated browser cannot start a Codex connection.
- [ ] User A cannot access User B connection state.
- [ ] Verification URL trust validation test.
- [ ] Device-code response handling test.
- [ ] Connected response handling test.
- [ ] Disconnect test.
- [ ] Persistence across page refresh/restart test.
- [ ] Per-user filesystem isolation test.
- [ ] No-secret-in-response test.
- [ ] No-secret-in-database test.
- [ ] Model availability test.
- [ ] Task execution test when generation is included.
- [ ] Timeout/retry behavior test.
- [ ] Typecheck/lint/unit/build all pass.

## I. Production verification

- [ ] Worker health endpoint is healthy.
- [ ] Web app health endpoint is healthy.
- [ ] Production connection flow reaches device-code UI.
- [ ] Successful authorization becomes connected.
- [ ] Reload still reports connected.
- [ ] Codex-backed action succeeds.
- [ ] Logout clears connection.
- [ ] No fresh runtime errors after test flow.
- [ ] Final report includes commit, deployment, runtime host, persistence, tests and any unresolved infrastructure dependency.
