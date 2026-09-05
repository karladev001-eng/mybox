# 0050 — Switchable workspace themes

Status: Accepted

## Decision

Offer Graphite (existing default), Light, Sepia and Midnight in Settings using
the shared keyboard-operable select. Persist the theme in Host profile preferences;
missing or unknown IDs resolve to Graphite without invalidating other preferences.
Apply a single document theme to Host, Knowledge, Image and portal surfaces.
Theme changes never alter stored records, images or PDF colors.

Replace component-specific dark colors with semantic surface, text and intent
tokens. Each palette supplies readable text, focus and primary-action foregrounds.
Keep compact controls, quiet accents and the existing layout. This supersedes the
dark-only appearance in FRONTEND.md, not the interaction rules of ADR 0011.

## Verification

199 core tests and the package build pass. Preference tests cover legacy/unknown
IDs, restart, concurrent updates and failed writes. Palette tests check normal
text and primary labels at 4.5:1 contrast. Browser checks exercised all four
settings themes, keyboard selection, selected/focused menu states, Light home
and Image surfaces. The light logo and right-aligned popup were corrected during
review. Full native pointer-state, IME, OS DPI and title-bar verification remain
unavailable with the browser-only UI tooling; no native code was changed.

Knowledge is version 1.22.9 and Image is version 0.5.8. Native profile storage
retains themes across restarts; the existing Web preview storage remains in-memory.
