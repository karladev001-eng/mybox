# Sync Server Tests

- `auth.test.mjs`, `router.test.mjs`: unit tests. They pass a fake `env` instead
  of booting a Workers runtime, matching `mybox-app/tests`, so `npm test` needs
  no local server.
- `integration.mjs`: drives a running server over HTTP and WebSocket. Excluded
  from `npm test` by its filename; run it with `npm run test:live` after
  `npm run dev`.

Add a unit test for anything expressible without the runtime. Reserve the
integration script for behavior only a real Durable Object shows: the WebSocket
relay, hibernation, and persistence across a reconnect.
