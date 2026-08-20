# ADR 0027: Provide discoverable Host keyboard shortcuts

- Status: Accepted
- Date: 2026-08-20

## Context

MyBox exposes its main destinations, contextual assistant, quick AI input, and
App installation through pointer controls, but only quick AI input had a global
keyboard path. That shortcut was not documented in the interface and displayed
a macOS Command key even though the current desktop direction is Windows.

Individual Apps could add their own key listeners, but navigation and the
assistant panel belong to the Host. Duplicating those shortcuts inside Apps
would create conflicts and make the same action behave differently by Surface.
Apps still need keyboard access to actions that only make sense inside their
own Surface, such as finding a Page in Note.

## Decision

The Host owns one data-driven set of in-window keyboard shortcuts. `Ctrl+J`
toggles the contextual assistant, `Ctrl+K` opens the command palette,
`Ctrl+Shift+N` starts a chat, `Ctrl+1` through `Ctrl+5` open the main
destinations, `Ctrl+Shift+A` opens App installation, and `Ctrl+/` is an
alternate command palette binding.

Each visible control that has a shortcut declares `aria-keyshortcuts`. The
command palette is searchable, uses semantic buttons, moves focus into its
search field, traps Tab,
closes with Escape, and restores prior focus. Host navigation and creation
shortcuts remain available while an editable control is focused. Ordinary
editing combinations that are not assigned to the Host, including copy, paste,
select all, and undo, keep their native behavior. These bindings are scoped to
the focused MyBox window and do not register operating-system-wide hotkeys.

The command palette also acts as an App launcher. It derives an `Open <name>
App` command from every installed App and exposes a dedicated command that
returns to the MyBox home screen. These palette-only commands do not reserve
additional global key combinations. If the bundled Registry contains a newer
version of an installed App, invoking its Open command records that App update
through the normal installation store before opening it; an installed-ahead App
is not silently downgraded.

Each App launcher is grouped under `<name> App` rather than a separate generic
App group. While that App is active, its Surface-scoped commands appear in the
same group, so `Open Note App` and `Pageを検索` are managed and discovered as one
Note command set.

On Windows the Host disables WebView2's browser-specific accelerator keys before
the first interactive page. Otherwise WebView2 consumes combinations such as
`Ctrl+J` and opens browser UI before the React Host receives a `keydown` event.
Text editing keys such as copy, paste, select all, and undo remain enabled by
WebView2 and keep their normal behavior.

An App may declare Surface-scoped shortcut descriptors in its Registry entry.
The Host resolves these only while that App is selected, dispatches a stable
command ID to the Surface, and includes the commands in the same palette. Host
bindings are reserved and win conflicts. An App descriptor therefore adds no
window-global or operating-system authority and does not install its own global
listener. Note declares `Ctrl+P` for Page search through this contract.

## Consequences

The principal Host and active-App actions are reachable without a pointer and
discoverable without memorization. Apps retain their own editing key space,
while the Host has one place to arbitrate, document, and test commands. A future
shortcut customization feature can replace bindings behind the same command IDs
without changing the actions or menu structure.

## Implementation notes

As of 2026-08-20, `src/core/keyboard-shortcuts.js` is the shared shortcut
catalog and resolver. `App.jsx` maps stable command IDs to Host state changes
and renders the command palette; the pure command builder covers installed App
launch, active-App commands, and MyBox home commands. Registry validation freezes
App shortcut descriptors, and the Host dispatches them as `shortcutCommand`
props to the selected Surface. The resolver has Node coverage for modifier,
physical-key, and focused-input matching. On Windows, `src-tauri/src/lib.rs`
sets WebView2 `AreBrowserAcceleratorKeysEnabled` to false during Tauri setup,
before the first interactive page. Tauri, `webview2-com`, and `windows` are pinned
to the compatible versions recorded by the desktop lockfile because the
platform-webview handle is explicitly version-sensitive.
