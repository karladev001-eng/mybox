# ADR 0022: Identify Users through OAuth providers without holding passwords

- Status: Accepted
- Date: 2026-08-17

## Context

Every Project membership already carries a `profileId` and a Project role, and
[ADR 0013](0013-use-projects-as-exclusive-page-sharing-boundaries.md) makes a
Project the sharing boundary. The value is a fixed `local-user` on every device,
so two devices cannot tell each other's Users apart and a Project cannot name a
second member. [The Knowledge App specification](../knowledge-app-spec.md)
requires an ADR choosing user identity before real-time collaboration.

Holding passwords would mean owning hashing, reset mail, rate limiting, and
breach response for a single-maintainer project. Desktop clients also cannot keep
a client secret: the binary ships to users and this repository is public
([ADR 0021](0021-publish-signed-desktop-releases.md)).

## Decision

Identify Users through OAuth providers only. MyBox never receives, stores, or
transmits a password, and never operates a password database.

Authentication uses flows that need no client secret. The first adapter is the
GitHub Device Authorization Grant, which authenticates against a `client_id`
alone and needs no loopback listener or redirect registration. Google's loopback
plus PKCE flow fits the same port and may follow. The `client_id` is not secret
and may be committed.

Provider credentials follow [ADR 0006](0006-store-provider-secrets-in-the-native-host.md):
the access token lives only in native credential storage, and no view returned to
the frontend or written to App-common state carries it. Only non-secret profile
fields — provider, subject, display name, avatar URL — are persisted.

A profile ID is `<provider>:<subject>`, built from the provider's immutable
numeric subject rather than a login name, so renaming a GitHub account preserves
Project membership.

**Signing in stays optional.** A signed-out device keeps the `local-user` profile
and full local function, preserving [ADR 0002](0002-local-first-tauri-workspace.md).
Sign-in is required only to reach a shared Project. Because a signed-out User
already owns local Projects, the first sign-in grants the new account ID the role
`local-user` holds in each local Project; otherwise a User would sign in and lose
access to their own Pages.

Signing in does not by itself share anything. Authorization stays
[ADR 0003](0003-agent-authorization-and-audit.md)'s Project-role check against
the resolved profile ID, and Confirmation levels remain independent
([ADR 0016](0016-separate-profile-confirmation-levels-from-operation-grants.md)).

## Consequences

Collaborators need an account with a supported provider. Adding a provider is a
new adapter behind the same port rather than a change to the authorization model.

Identity alone does not move data between devices. Local storage stays
authoritative, so a second User cannot yet open a shared Project; the
synchronization provider, offline merge, presence, and revocation behavior the
specification also demands remain open for a later ADR.

Revoking the OAuth grant at the provider ends future sign-ins but does not reach
data already on a device, which stays governed by local Project roles.

## Implementation notes

As of 2026-08-17, `mybox-app/src-tauri/src/accounts.rs` runs the device flow and
owns keyring access, `mybox-app/src/core/account-identity.js` resolves the
effective profile ID, `mybox-app/src/desktop/accounts.js` bridges to the host
with a signed-out Web fallback, and `adoptLocalMemberships` in
`mybox-app/src/knowledge/domain.js` performs the first-sign-in grant. The
`client_id` is committed as a default and overridden at build time through
`MYBOX_GITHUB_CLIENT_ID`.
