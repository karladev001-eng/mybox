# MyBox Sync Server

The server a group runs for itself so their shared Projects can merge. MyBox
operates none, holds nobody's content, and pays for no hosting
([ADR 0023](../docs/adr/0023-user-operated-sync-servers-with-yjs.md)).

One Durable Object per Project gives that Project a single ordering point for
updates, presence, and persistence. Content is merged with Yjs, so two people
typing in one paragraph converge rather than collide.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/karladev001-eng/mybox/tree/main/sync-server)

The button copies this directory into your own GitHub account and deploys it to
your own Cloudflare account. Then set the secret that proves you are the
operator, without which the server refuses every Project route:

```sh
npx wrangler secret put SERVER_SECRET
```

Paste the Worker URL and that secret into MyBox to claim a Project. Everyone
else joins with an invite you issue from MyBox and never needs the secret.

## Free plan limits

Durable Objects run on the Workers free plan, and this server is written to stay
inside it: WebSocket hibernation stops an idle Project billing duration, and the
merged document is written on a timer rather than per keystroke, because typing
would otherwise exhaust the 100,000 daily row writes. Exceeding a daily limit
fails writes until 00:00 UTC rather than charging you.

The free plan offers only the SQLite storage backend for Durable Objects, which
is why `wrangler.json`'s migration declares `new_sqlite_classes` rather than the
default key-value backend.

## Files

- `src/router.js`: validates the path and hands the request to the Project's
  Durable Object. Carries no `cloudflare:` import so it runs under plain Node.
- `src/routes.js`: the one route table the router and the object share.
- `src/project-room.js`: the Durable Object. Membership, invites, the Yjs
  document, and the WebSocket relay.
- `src/auth.js`: roles, identifier validation, token generation and hashing.
- `src/protocol.js`: the client message envelope and its validation.
- `src/index.js`: the Workers entry point.

## Tests

```sh
npm test
```

Unit tests run without a Workers runtime by passing a fake `env`, matching
`mybox-app/tests`.

```sh
npm run dev
npm run test:live -- http://127.0.0.1:8787
```

`test:live` drives a running server through membership, live relay, a Viewer's
refused write, and persistence across a reconnect.

## Boundaries

Roles are enforced here, not only in the client. Once a peer can connect, a
client-side check only advises a cooperating client, so this server rejects a
write from a Viewer and from a removed member.

Tokens are stored as digests, so a copy of the database reveals none that still
open a Project. Invites are spent on first use. Removing a member deletes their
tokens and closes their open sockets rather than waiting for the next request.
