# ADR 0036: Browse Image templates as visual products

- Status: Accepted
- Date: 2026-08-22

## Context

Image initially exposed each Prompt axis through a compact listbox. The control
was space-efficient, but a User had to understand template names before choosing
one and could not compare the Prompt fragment or likely visual result. This made
creative selection feel like configuration instead of browsing.

Every axis also needs an explicit way to leave that dimension to the generator.
World already had `指定なし`, while style, composition, mood, and aspect ratio
did not.

## Decision

Image presents world, style, composition, mood, and aspect ratio as a visual
catalog. Each template is a semantic button card containing its name, Prompt
fragment, source when external, and a representative generated thumbnail. The
shelf heading supplies the category once instead of repeating it on every card.
Cards expose their selected state with an accent-tinted background and check
mark, not a persistent outline. A wrapping category navigation bar jumps between
catalog sections without hiding any options behind an OS-native popup.

The bundled thumbnail atlas uses one constant subject so differences between
templates communicate the selected dimension rather than a different subject.
Local and Note templates use the neutral sample for their category while showing
their actual Prompt fragment and source.

Bundled templates are composable production directions, not short style labels.
World controls setting and narrative scale; style controls marks, materials, and
selective detail; composition controls hierarchy, negative space, and depth; mood
controls light, color, and atmosphere. Detailed constraints stay in the axis that
owns them so combining templates does not repeat one monolithic Prompt. The
bundled wording favors deliberate silhouettes, focal-only detail, atmospheric
perspective, natural light, restrained decoration, and readable dark values.

All five dimensions provide `指定なし`. For Prompt axes, the selected template
has an empty fragment and the compiler omits that line. Aspect ratio uses `auto`;
the compiler omits ratio and target-dimension guidance while retaining a square
preview placeholder until a result supplies its actual dimensions.

The catalog stays in the existing condition panel. Each category is one
horizontal product shelf with a themed scrollbar, previous/next controls, and
keyboard-reachable cards. This keeps templates in the same category side by
side without widening the App surface. At narrower desktop widths history
becomes a Drawer; at compact widths the condition panel moves below the preview.

Image also shows a live, read-only full Prompt panel to the left of the image
preview. It uses the same compiler as the generation Operation and shows the
selected template names alongside the combined subject, template fragments,
ratio, reference instruction, and additional input. Before a subject is
entered, an explicit placeholder keeps the selected template combination
inspectable. A persistent top-bar button toggles the panel and exposes both
`aria-expanded` and pressed state; hiding it returns the width to the image.
On compact layouts the panel moves before the image instead of forcing page-wide
horizontal scrolling.

The Image surface follows a quiet, icon-led control policy. Secondary actions
such as Prompt visibility, history, repeat, export, Trash, template management,
and shelf paging use compact Phosphor icon buttons with accessible names and
themed hover/focus tooltips. Visible labels remain for inputs, categories, and
the primary generation action. Explanatory copy and decorative borders are
omitted when placement, imagery, or the action icon already communicates the
purpose; hover, focus, selected fill, and check marks carry interaction state.

## Consequences

Template selection requires more vertical space, but Users can compare options
without repeatedly opening and closing a popup. The generated sample atlas is a
first-party App asset and must remain optimized and stable so it does not cause
layout shifts or depend on a network connection.

## Implementation notes

Image `0.2.0` added the catalog cards, a WebP sample atlas, and `auto` aspect
ratio. Image `0.2.1` arranges each category as a horizontal shelf and adds the
live combined-Prompt preview. Image `0.2.2` moves that full Prompt into a large,
collapsible panel beside the image. Image `0.2.3` reduces explanatory copy,
converts secondary actions to tooltip-backed icons, and removes decorative
outlines. Image `0.3.0` expands every bundled template into a production-quality
Prompt fragment, adds a `21:9` panorama target, and makes reference generation
preserve the main image's composition and spatial relationships by default while
explicitly rejecting collages. The App Registry version follows the App version
so installed devices can surface each update.
