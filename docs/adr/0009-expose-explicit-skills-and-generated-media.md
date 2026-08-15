# ADR 0009: Expose explicit skills and generated media

- Status: Accepted
- Date: 2026-08-15

## Context

MyBox chat can produce text and search the Web, but it cannot yet invoke reusable
agent skills or retain an image produced by the selected provider. Treating image
requests as ordinary text causes the model to return a prompt instead of the
requested artifact. Allowing every provider tool would weaken the constrained
provider boundary established by ADR 0005 and ADR 0008.

## Decision

Skills and image generation are separate, provider-declared capabilities. The
chat composer exposes a compact tool picker with explicit selected state. A skill
selection and the image-generation mode apply to one submitted turn and are
recorded with that user message.

The ChatGPT subscription adapter discovers enabled user and system skills through
the official Codex App Server `skills/list` method. MyBox returns opaque
scope/name identifiers to the WebView, resolves every selection again inside the
native host, and supplies the resolved `skill` input alongside the `$skill-name`
marker. It never accepts a skill path supplied by the WebView. Skills are scanned
from an isolated temporary working directory, so a chat turn does not receive the
selected MyBox workspace path.

Skill selection does not expand host authority. Commands, file changes, MCP,
dynamic tools, and image viewing remain blocked. A tool-dependent skill may run
only the capabilities independently enabled for that turn. Other provider
adapters declare skills unavailable until they implement an equivalent verified
contract.

Image generation is an explicit external effect and cannot be combined with Web
search or structured output in the initial implementation. The subscription
adapter checks `modelProvider/capabilities/read`, admits only the App Server
`imageGeneration` item, validates the returned PNG, JPEG, or WebP bytes, and caps
the artifact at 25 MB. All other provider tools remain blocked.

Generated images are copied before the isolated provider process ends into the
`ai-chat` app's private workspace namespace. Chat history stores only an opaque
resource ID, media type, and optional revised prompt. The WebView can read that
resource only through the fixed `read_chat_image` host command; it never receives
an unrestricted filesystem path. OpenAI API and local-model image generation are
future adapters behind the same capability and resource contract.

## Consequences

- Installed Codex skills can be selected and understood in the same chat UI as
  other provider capabilities.
- ChatGPT/Codex image generation creates a durable artifact that remains visible
  when the local conversation is reopened.
- A skill cannot silently turn on commands, workspace access, MCP, Web search, or
  image generation.
- Generated-image deletion and orphan cleanup are deferred; deleting a session
  currently leaves its private image resource in the `ai-chat` namespace.
- Image generation uses the selected ChatGPT/Codex entitlement and may consume
  included usage or credits according to the user's plan.

## Implementation notes

- `mybox-app/src-tauri/src/codex.rs` owns capability discovery, skill resolution,
  image-tool admission, media validation, and private resource persistence.
- `mybox-app/src/desktop/agent-providers.js` exposes provider capabilities without
  leaking skill paths or image file paths.
- `mybox-app/src/core/chat-history.js` persists turn-level skill metadata and
  opaque image references.
- `mybox-app/src/ChatView.jsx` provides the accessible tool picker and lazy image
  rendering.
