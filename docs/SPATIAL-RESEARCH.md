> Historical 0.4.0 implementation notes. The current 0.5.0 wall replaces the two-pane/dock layout and drag-pauses-narration behavior; see [MEMORY-WALL.md](MEMORY-WALL.md).

# Spatial research — JARVIS 0.4.0

## Reference and HUD

The supplied image informed the downward triangular reactor, additional mechanical segments and ring labels, cyan/white lighting, fine data connections, and distributed information planes. The core stays visible between research panes. Original SVG geometry and **MAATOUK INDUSTRIES** branding are retained; no Marvel artwork or branding was copied. The radial settings retain their orbit and gain selection depth and smoother transitions.

## Research and narration

Research now creates a spatial workspace instead of a large rectangular slideshow. A section is a module with display panels, narration segments and typed focus targets. A segment can select a panel, item, chart datum or registered image. The general agent can present an initial verified section using `present_briefing` with `mode: replace`, continue background research while speech plays, and add modules using `mode: append`.

The actual audio completion callback advances the segment. At the end of a section, it is retained in the dock and the next ready section starts automatically. No NEXT click or estimated speech timer is required. New sections arriving during playback do not restart current speech. If sources are still being gathered, the workspace waits and resumes on the next append. Failure ends the waiting state without destroying already gathered content.

Pause/resume, previous/next, repeat and stop are available in the transport. Their short voice forms run immediately; broader instructions such as moving, comparing, reopening or saving use the existing general agent and its workspace tools. Interrupting speech invalidates old completion tokens, so stopped audio cannot advance another section. A voice failure pauses progression instead of silently moving on. Narration requires voice output to be enabled.

## Modules and dock

Drag a module header or use its arrow-key controls. Drag the lower-right handle, double-click the header to expand, or use pin/expand/minimize/close. Positions and sizes are bounded in normalized workspace coordinates and adjusted for the available viewport. Comparison places two modules beside the visible core. At most two modules render as active panes; other sections remain in the paged dock. Closed modules retain content and can be reopened. Compact panes separate summaries from visual content and page text/items instead of scrolling.

## Local library

SAVE BRIEFING writes a versioned JSON session under `%APPDATA%\jarvis\Research`, using UUID filenames and readable topic metadata. The HUD's small RESEARCH LIBRARY control lists topics, dates and module counts. Open restores sources, image references and layouts with narration paused. Rename edits the saved topic. Delete requires an immutable, single-use, expiring confirmation; stop invalidates pending deletion approval.

The library limits session size, module count and entry count, validates saved data and references, rejects traversal/symlinks and skips corrupt files. It stores no executable module code. Saved research is treated as local file context under the existing cloud-sharing policy. Saving is explicit; unsaved research remains in memory until app exit. Saved image references can be fetched again after restarting, provided the public source is still available.

## Artwork, sources and voice

Registered public-source artwork is displayed as the real texture on CSS perspective planes, with depth frames, subtle tilt, glow and scan entry. This works for logos, products, objects and diagrams without generating a replacement logo. Inline images remain attributed. This is pseudo-3D rather than a reconstructed 3D model. No Three.js/WebGL runtime or true-model downloader was added.

Image registration rejects duplicates and known tiny/watermark/tracking candidates. Selection instructions favor official/relevant sources. Public fetches are time- and size-bounded, reject private network destinations, and use a bounded cache. Slow retrieval shows a placeholder; broken images leave the rest of the module usable. Source quality still depends on the available public pages and model selection; arbitrary watermark/relevance detection is not guaranteed. Video panels offer an explicit OPEN VIDEO action with no automatic playback.

Display content remains separate from narration. The shared speech sanitizer runs in renderer playback and again before host neural synthesis; Windows speech uses the same cleanup. It removes Markdown, raw URLs, emojis, citation/source identifiers, HTML, fenced code, JSON objects/documents, control bytes and repeated punctuation. Streamed formatting is buffered until it can be cleaned safely; ordinary sentences can still begin early. Source domains and titles remain clickable on-screen rather than being passed directly to TTS. Narration planning asks for natural source references when useful.

## Performance and verification

Two active modules, bounded dock/library pages, lazy images and a small number of SVG/CSS layers limit rendering work. Workspace/image components are memoized; drag previews update at most once per animation frame, with one host layout commit per gesture. Observers, frames, subscriptions and stale audio callbacks are cleaned up. Docking unmounts rich content. GPU load above 80% pauses secondary rotors and holographic/data-stream decoration; hidden-window and reduced/off animation modes reduce work. No expensive continuous WebGL scenes run.

Validation and exact limitations are recorded in [VERIFICATION.md](VERIFICATION.md). Visual requests now reach a presentation checkpoint after two successful research reads: the agent presents existing evidence before fetching more. If the model ignores that checkpoint or repeatedly produces invalid presentation arguments, JARVIS displays a validated, attributed source preview and reports incomplete analysis. It does not invent a finished analysis. Background research reserves a final answer after eight successful reads instead of spending every step on new searches. The existing step/time limits, cancellation, plugin permissions and consequential-action approvals remain enabled. Synthetic integration fixtures are explicitly labeled and isolated from the owner's research library. No paid inference was used. Physical microphone/conversation testing remains unavailable until Windows exposes a microphone device.
