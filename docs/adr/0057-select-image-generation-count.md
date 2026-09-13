# 0057 — Select Image generation count

Status: Accepted

Image offers 1–4 images per explicit generation action, defaulting to one. The
Surface snapshots the final Prompt and reference inputs at start and invokes
the existing authorized single-image Operation sequentially for each image.
Each attempt keeps its own durable Generation Page and original File. This
does not change the provider contract, existing Operation outputs or schema.

Progress identifies the current image and total. A failure stops the remaining
requests while retaining completed results. The User may stop the remaining
images; the in-flight attempt finishes and is preserved. Leaving Image or
changing profile also prevents subsequent requests. Nothing resumes or retries
automatically after restart. Busy and cancellation state prevent double starts;
changing the draft during a run affects only a future explicit action.

The count picker uses the existing themed selection control beside generation
actions. Its value is local UI state, not part of the image Prompt. Single-image
regeneration/retry remains an explicit action using the selected count.

The shared picker uses the existing themed tooltip instead of the browser's
native title popup, keeping the count control consistent with the dark surface.

Validation: 228 core tests and 4 package checks pass. The package build and an
isolated native Windows QA build succeed. A synthetic provider verifies individual
history writes, frozen input, sequential execution, cancellation, uncertain
failures, and leaving/reopening Image without further requests. Native dark/light
picker states, keyboard End/Enter/Escape, generated history and cancellation were
checked. Browser widths 1600/1280/1066/800/720 retain aligned control rows and
in-viewport popups without horizontal overflow. Actual OS DPI changes and live
provider multi-image generation were not exercised; the provider protocol remains
one image per call. Existing large-chunk warnings remain.
