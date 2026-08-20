# ADR 0028: Show the active Agent provider identity without storing credentials

- Status: Accepted
- Date: 2026-08-20

## Context

The Settings Surface shows which Agent provider and subscription plan MyBox is
using, but a User with more than one ChatGPT account cannot tell which account
Codex authenticated. The official Codex App Server `account/read` response
already includes a display email alongside authentication type and plan.

## Decision

The native Codex adapter returns the validated, display-only account email as
part of its in-memory subscription status. The Settings Surface shows that email
in the active ChatGPT row with the plan and `Codex経由` label. A missing or
malformed email produces an explicit `アカウント情報なし` label rather than
guessing an identity.

MyBox reads no password, cookie, access token, refresh token, or Codex credential
file. The email is not persisted to workspace data, chat history, logs, or the
MyBox Linked-account profile. Provider status errors and signed-out states return
no identity.

## Consequences

- Users can verify which ChatGPT subscription account will serve an inference
  request before selecting it.
- An email address enters the WebView as display metadata while the Settings
  Surface is open, so it must not be reused as authorization or a Profile ID.
- Other Agent providers may expose their own display identity later through the
  same privacy boundary, but this decision does not require one shared identity
  shape before a second provider needs it.

## Implementation notes

- `mybox-app/src-tauri/src/codex.rs` validates and returns the `email` field from
  `account/read`; unrelated credential-shaped fields are ignored.
- `mybox-app/src/App.jsx` includes the identity in the ChatGPT Settings detail,
  and `styles.css` lets long addresses wrap instead of clipping them.
