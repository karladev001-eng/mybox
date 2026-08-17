# MyBox Frontend Design Rules

This is the source of truth for user-visible MyBox interface work. It adapts the
project's Windows desktop guidance to the current React/Tauri implementation.
Read it before changing layout, controls, styling, icons, motion, or interaction.

## Direction

MyBox is a calm, precise desktop toolbox: dark, content-first, icon-led, and
compact without feeling crowded. Keep the existing graphite surfaces and mint
accent. Prefer flat layered surfaces, subtle borders, and restrained elevation;
avoid decorative gradients, oversized cards, glass effects, and bright color
used without meaning.

The governing principle is **native behavior, MyBox appearance**. Semantic HTML
controls, keyboard behavior, focus management, and accessibility are mandatory.
Any OS or browser default surface visible to the user is an unfinished state.

## Tokens

Use the semantic CSS variables in `mybox-app/src/styles.css`. Extend that token
set before repeating a new value across components.

- Surfaces: `--bg`, `--surface`, `--surface-hover`, `--surface-strong`,
  `--surface-elevated`.
- Text: `--text`, `--muted`, `--subtle`.
- Boundaries: `--line`, `--line-strong`, `--focus`.
- Intent: `--accent`, `--danger`.
- Shape: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-popup`.
- Spacing: `--space-1` through `--space-8`, based on a 4 px rhythm.
- Motion: `--motion-fast`, `--motion-normal`, `--ease-standard`.
- Elevation: `--shadow-popup` and `--shadow-floating` only for floating layers.

Do not add a slightly different raw color, radius, shadow, or duration inside a
component when an existing semantic token describes the role.

## Controls and states

Every interactive control must define Normal, Hover, Pressed, Focus-visible, and
Disabled states. Selected or Expanded controls must expose both a visible state
and the corresponding ARIA state. Feedback must not move surrounding layout.

- Buttons use semantic `<button>` elements and a minimum 40 px desktop target.
- Text inputs keep visible labels, themed selection/caret, placeholder, focus,
  disabled, and error treatment.
- Focus uses a visible 2–3 px theme ring with adequate state contrast. Never
  remove the outline without an equivalent replacement.
- Use Phosphor icons. Decorative icons are `aria-hidden`; icon-only controls have
  an accessible name. Do not use text glyphs or emoji as structural icons.
- Hover/pressed transitions normally use color, opacity, or border changes in
  80–180 ms. Respect `prefers-reduced-motion`.
- Place a control's contents with the mechanism its layout actually reads:
  `justify-content` and `align-items` position flex and grid children, while
  `text-align` leaves them where they are.
- A control that sets `color` also sets its own `background` and `border`. The
  shell's light text on an unstyled control keeps the browser's light default
  background, which renders the label unreadable.
- Open an external link through the desktop opener bridge. The WebView ignores
  `target="_blank"`, so a plain anchor is a control that silently does nothing.

## Lists, menus, and popups

Native `<select>` popups and OS-default ListBox, Menu, ContextMenu, scrollbar, or
tooltip rendering must not ship in the desktop UI. Use semantic custom surfaces
when the native popup cannot be themed completely.

- Popup surface: elevated background, subtle border, 10–12 px radius, 6–8 px
  padding, restrained shadow, bounded height, and a themed scrollbar.
- List item: at least 36 px high, 10–14 px horizontal padding, 6–8 px radius,
  and designed hover, pressed, selected, focused, and disabled states.
- Selection is never color-only; use an icon or text state as well.
- A custom select trigger uses `aria-haspopup="listbox"`, `aria-expanded`, and an
  accessible name. Its popup uses `role="listbox"` and stable `role="option"`
  items with `aria-selected`.
- Keyboard behavior: Enter/Space opens, arrows move, Home/End jump, Enter applies,
  Escape closes without applying, Tab closes and continues normal focus order.
  Closing returns focus to the trigger when appropriate.
- Popups close on outside pointer input and must not obscure the focused control.
- A dialog body carries its own padding. Content flush to the edge is clipped by
  the surface's own radius and `overflow: hidden`.

## Layout and app collections

Use a 4/8 px spacing rhythm and responsive grids with shrinkable text columns.
Avoid unexplained fixed widths and heights. At 125–200% Windows scaling, text may
wrap or truncate with a tooltip, but controls must remain operable.

Before arranging multiple items, choose and document their alignment on both
axes: top, bottom, left, right, or center. Repeated rows must reuse the same grid
tracks so icons, primary text, status, and trailing actions form uninterrupted
vertical columns. Within a track, use one deliberate alignment (`start`, `end`,
`center`, or `stretch`) instead of relying on content width or inherited browser
defaults. Prefer CSS Grid for repeated rows with three or more visual columns.

Every row's trailing control ends on the same track edge, whatever that control
is. When a row omits one trailing element, let the remaining control span that
track; holding the track open with an empty spacer leaves the shorter control
visibly inset from the rest of the column.

App collections are launchers, not poster galleries. Prefer compact horizontal
items that show icon, name, purpose, and explicit actions. Keep one primary open
surface and a separate overflow menu. Items may use the app color as a small
accent, never as a large low-contrast background.

## Typography and color

Use Noto Sans JP with the system sans-serif fallback already bundled by MyBox.
Body and controls are normally 13–16 px; supporting labels are never below 11 px.
Primary text must meet 4.5:1 contrast on its actual surface. Functional state is
communicated by icon or text in addition to color. Numeric usage values use
tabular figures.

Noto Sans JP reserves more line box above its glyphs than below, so a Japanese
label centred by line box sits about 1 px low inside a fixed-height control.
Correct it with asymmetric vertical padding, which keeps the control's height.

## Review workflow

Before handoff, verify all affected states in the actual dark desktop surface:

- no white, square, blue, or 3D OS-default popup/control is exposed;
- popups, context menus, scrollbars, and long lists are opened and inspected;
- pointer, Tab, arrows, Enter/Space, and Escape all work;
- hover, pressed, selected, focus-visible, disabled, loading, and empty states
  remain distinguishable;
- shared column edges and centred labels are confirmed by measuring the rendered
  geometry, since eyeballing a few pixels mistakes one axis for the other;
- 100%, 125%, 150%, and 200% scaling or equivalent responsive viewport checks do
  not clip important content;
- narrow and wide windows do not introduce horizontal scrolling;
- reduced-motion mode is usable;
- all colors, radii, spacing, motion, and elevation come from semantic tokens.

A UI change is complete only when it is functional, visually part of MyBox,
state-complete, keyboard accessible, responsive, and free of default-rendering
leakage.
