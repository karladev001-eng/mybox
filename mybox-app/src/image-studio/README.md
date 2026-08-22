# Image App

`image-studio` is MyBox's local-first image generation App. It owns prompt
templates, generation history, reference resources, and generated images.

Read `domain.js` for prompt/template rules, `app.js` for public Operations and
Connectors, `client.js` for the host/native boundary, and `ImageStudioView.jsx`
plus `image-studio.css` for the Surface. Other Apps may interact only through
the declared Connectors, Operations, Events, and Host resource broker.

`template-samples.webp` is the offline comparison atlas used by the visual
template catalog. It keeps one subject constant across world, style,
composition, and mood examples; cards display the actual Prompt fragment beside
the relevant crop. Every axis includes `指定なし`, represented as `auto` for
aspect ratio. Category cards remain side by side in horizontally scrollable
shelves. `ImageStudioView.jsx` uses the domain `compilePrompt` function to show
the exact current combination in a large collapsible panel to the left of the
image preview, with a visible placeholder until the subject is entered. The
Surface keeps explanatory copy and decorative outlines to a minimum; secondary
actions are compact Phosphor icon buttons whose accessible names are also shown
through themed hover and keyboard-focus tooltips.

Bundled Prompt fragments are detailed, composable production directions rather
than style labels. World owns setting and narrative scale, style owns marks and
selective detail, composition owns hierarchy and depth, and mood owns light,
color, and atmosphere. Their wording favors deliberate silhouettes, focal-only
detail, natural light, and restrained decoration while retaining the distinct
meaning of every option. Reference generation defaults to preserving the main
image's spatial structure instead of making a collage. The catalog includes a
`21:9` cinematic panorama target in addition to the original ratios.
