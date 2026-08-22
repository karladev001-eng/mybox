# Image App

`image-studio` is MyBox's local-first image generation App. It owns prompt
templates, generation history, reference resources, and generated images.

Read `domain.js` for prompt/template rules, `app.js` for public Operations,
Workflow Actions, and Connectors, `client.js` for the host/native boundary, and `ImageStudioView.jsx`
plus `image-studio.css` for the Surface. Other Apps may interact only through
the declared Connectors, Operations, Events, and Host resource broker.
The no-input `画像を生成` Workflow Action returns the same
`mybox.generated-image.v1` item that the completion Event publishes, after both
the resource and generation history are durable.

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
`21:9` cinematic panorama target in addition to the original ratios. Ratio
selection adds only the aspect ratio to the compiled Prompt; it never requests
a pixel size. Once generation finishes, the preview uses the image's actual
dimensions and preserves the returned image without cropping or stretching it
to the requested ratio. Selecting that preview opens a keyboard-contained,
full-window viewer; Escape, the close control, and backdrop input return focus to
the preview. The additional-input field grows with its text up to a readable
desktop height, then uses the same themed scrollbar as the App's other vertical
and horizontal overflow regions. A compact Prompt rebuild control sits directly
beside the primary generation action.

The large final Prompt panel is an editable draft. A User may keep the compiler
output, replace it manually, import UTF-8 Markdown or plain text, or import the
current Markdown body of a Note Page. The Note Page source is offered only while
the Note App manifest is registered; Image reads it through
`knowledge.page.markdown.read` and never reads Note storage. Rebuild restores the
current subject, templates, ratio, references, and additional input.
The picker combines Page and Tag summaries from Note's public Operations. Its
single search field matches normalized title and Tag text, and result rows show
their Tags without opening each Page.
