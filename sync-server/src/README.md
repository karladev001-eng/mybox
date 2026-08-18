# Sync Server Source

See `../README.md` for what each file owns and how to deploy.

Keep `router.js`, `routes.js`, `auth.js`, and `protocol.js` free of
`cloudflare:` imports and Durable Object state so they stay testable under plain
Node. Runtime-bound behavior belongs in `project-room.js`.

Read a request body before returning any response, including a rejection.
Answering a forwarded request while its stream is unread tears down the Durable
Object, which takes every live editing session with it.
