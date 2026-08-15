# Tests

Contains Node tests for framework behavior and Sites packaging.

- `app-host.test.mjs`: operation/event contracts, agent authorization, auditing,
  app removal, and state isolation.
- `chat-history.test.mjs`: provider-neutral chat session state, bounded context,
  app-scoped persistence, validated skill/generated-image references, and safe
  model/reasoning/token-usage metadata.
- `sites-worker.test.mjs`: static asset fallback and required build outputs.

Run `npm test` for framework tests. Run `npm run build` before `npm run test:sites`
because the Sites test checks generated package files.
