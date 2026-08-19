# Desktop Capabilities

Contains Tauri permission declarations for application windows. The default
window currently receives core permissions, the native directory picker, and the
URL-only opener used by validated AI answer sources and Knowledge's `url-embed`
Blocks.

The opener needs two permissions, not one. `opener:allow-open-url` only exposes
the command; it carries no URL scope, so on its own every call is refused with
"Not allowed to open url". `opener:allow-default-urls` supplies the scope that
permits `http:`, `https:`, `mailto:`, and `tel:`. Path opening and
`reveal-item-in-dir` stay ungranted.

Add permissions narrowly and record the security decision in an ADR.
