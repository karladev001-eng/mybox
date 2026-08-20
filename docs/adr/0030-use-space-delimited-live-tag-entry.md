# ADR 0030: Use Space-delimited live Tag entry

- Status: Accepted
- Date: 2026-08-20

## Context

Adding several Tags required a separate confirmation action for each value, and
the candidate popup continued to show historical Tags that no Page used. A plain
Space handler also risks intercepting the Space key Japanese input methods use
during conversion.

## Decision

In the Note Tag field, Space, full-width Space, Enter, and comma commit the
current non-empty Tag. Space, full-width Space, and comma keep focus in the Tag
field so another Tag can be entered immediately; Enter commits and then moves
focus out of the field. The event's
physical `Space` code is accepted because WebView keyboard layouts do not
always report a literal space in `key`. Space does not commit while an IME
composition is active; a full-width Space emitted as the finalized composition
value is committed from `compositionend`. A draft or paste containing several delimiters is split
into several Tags; duplicate or blank Tags are ignored.

The candidate popup includes only Tags currently applied to at least one Page in
the Project, excluding Tags already selected on the current Page. An unused Tag
may remain in the Project's stored Tag catalog for history compatibility, but it
is not suggested.

## Consequences

Users can enter a sequence such as `設計 アイデア 要確認 ` without leaving the
keyboard. Japanese conversion remains intact, while stale candidates no longer
crowd the picker. The field exposes a visible delimiter hint and preserves
semantic combobox, option, remove-button, and focus behavior.

## Implementation notes

`knowledge/tag-behavior.js` owns delimiter, multi-value splitting, and candidate
filtering rules so they can be tested without React. The Tag editor is keyed by
Page identity rather than Page revision so a successful save does not remount
the focused input. The built-in Note App catalog version is `1.9.1`.
