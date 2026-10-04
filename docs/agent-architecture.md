# JARVIS agent architecture

JARVIS uses a bounded observe/plan/execute/verify/recover loop shared by voice and text. A structured semantic TaskProfile selects fast/general/deep/vision roles, research/computer control, temporal context and output requirements. Actual per-model capability proof and host privacy facts filter the candidates. Specialized tool families load on demand; deadlines, bounded steps/recovery, repeated-action prevention and cancellation apply across models. Malformed arguments return structured failures instead of raw errors in chat. Current research removes model-invented historical seasons; source dates still require scrutiny.

## Hosted and local cooperation

NVIDIA uses one encrypted credential, a pinned free development endpoint and a persistent local daily request ledger. Native tool messages, streamed call fragments and usage are normalized without exposing hidden reasoning. Proof expires after seven days; VERIFY FREE MODELS refreshes it. Rate-limit cooldowns, per-model circuit breakers, timeouts, cancellation and latency tracking control fallback. Kimi's observed vision can caption for Lightning's observed tools. Missing/invalid credentials or incompatible capabilities move to the next compatible free route, ultimately Ollama. FREE ONLY excludes paid providers/grounding. Separate cloud screen/files/clipboard/memory permissions apply to observations and retained history, including cached screen context.

## Local specialists and real 3D

Semantic memory/library search uses a provider-independent local embedding interface and SQLite vectors with model/content fingerprints, CPU Ollama all-minilm and keyword fallback. Local PyMuPDF extracts selected document text/tables in bounded pages; optional local NIM OCR/parser interfaces remain disabled without a compatible deployment. See [hardware evidence and actual capabilities](NVIDIA-3D.md).

The Blender service serializes validated structured jobs in owned immutable revision directories. A trusted Python worker, launched with auto-execution disabled, performs bounded geometry/material/camera/light/render/export operations. CPU Cycles avoids taking the game's GPU. GLB assets have validated headers, internal resources and finite UUID-based IPC access; arbitrary renderer file access is unavailable. External destination writes/overwrites are host-confirmed. AI planning, real rendering, concise visual review and validated correction batches have iteration/size/deadline caps. Cancellation preserves the preceding revision. Unavailable review or nonmanifold geometry is reported, not treated as acceptance.

Three.js is lazy loaded only for model cards, retains a static drawing buffer, repaints resize/reset events directly and releases geometry/materials/textures/render loops on disposal. Hidden/unfocused scenes pause; focused rendering slows under GPU/RAM/gaming load. OrbitControls supplies navigation. Runtime smoke checks inspect drawn mesh pixels, not merely canvas existence. Saved Library entries retain stable project/asset IDs independently of workspace card deletion.

## Screen context and Gaming Mode

Settings supports Off, Manual, While awake and Continuous vision. Continuous context samples the foreground window and screen, compares image hashes/differences, and analyzes significant changes at adaptive intervals. It pauses expensive analysis during active tasks and while JARVIS itself is foreground. Requested screen observations remain immediate. The Vision panel displays the active application, summary and recent events.

Screenshots, accessibility control IDs and recent screen events stay in memory. They are separate from saved notes. Audit logs can include technical failure details, but do not persist screen frames or typed text. Screen previews remain local to the HUD.

Gaming Mode can be automatic, on or off. Detection uses visible window/process names and installed Steam manifests, without reading game memory or packets. Background capture resolution and analysis frequency decrease, with a further reduction under GPU load. Commentary can be off, important only or normal. Proactive assistance defaults to low frequency. Gameplay input such as aiming, shooting and combat is blocked; help covers visible information, navigation menus and public research.

## Execution and safety

Tools report success, verification, observed results, retryability and a natural message. Browser navigation checks actual browser address controls after launch and offers one alternate address-field method. App launches check real processes/windows. File operations check filesystem results. Clicks bind a located target and current window to a single-use proof, recheck before input and compare the screen afterward. A changed screen is evidence of input response, not proof that a semantic task such as signing in finished.

Ordinary app launches, website navigation, scrolling, verified basic navigation and typing into ordinary edit fields run automatically. Typing focuses and verifies the actual field, reads back the inserted value and never submits or presses Enter. Actual command consoles and sensitive payment/security fields require a separate confirmed typing action; password fields remain excluded. Other clicks conservatively require confirmation unless an actual accessibility control certifies ordinary navigation. Deletion, sends/forms, installers, administrative commands and other consequential actions keep server-side approval requirements. The model cannot lower tool risk or bypass UAC. No blind retry follows a consequential action.

Voice activity cancels background inference and pauses it for at least 15 seconds; transcription and voice synthesis also block background analysis. Low proactive mode performs expensive background analysis at most once every 90 seconds, while lightweight screen sampling continues. Non-contextual requests start without a screenshot. Fresh images are encoded once per planning turn, and post-action screen observation happens once per action batch instead of once per step. Conversational requests use a shorter prompt. Window hiding/restoration during explicit observation is unchanged.

Public research searches real web results and extracts readable page text with source URLs. It does not submit forms, sign in, execute page scripts or access private network URLs. Sites requiring login or JavaScript-only content may need visible browser interaction. Web content and screen text are untrusted data, never authorization.

## Speech and cancellation

Microphones are enumerated before capture. Disconnected selections fall back to the system default, with reconnection on device changes. Application names and current window titles provide transcription hints; fuzzy application matching requires a conservative confidence margin. Ambiguous names are clarified instead of globally replacing words.

Speech interrupts voice playback immediately. A new utterance does not silently cancel a running PC task or pending approval. Say “stop” or “cancel” to stop the task while leaving live listening available. The Stop button and emergency hotkey still stop all actions.

## Local setup and manual check

The owner's NVIDIA routing, Ollama Qwen3.5 9B fallback, faster-whisper small.en and Kokoro bm_daniel British male voice are configured. Windows accessibility, screenshot, input and audio dependencies remain local. Added local dependencies are Blender, all-minilm and PyMuPDF; Three.js provides the in-app model viewer. Launch using `Launch-JARVIS.cmd`.

Windows exposes no recording endpoint, so connecting/enabling and selecting a microphone is the remaining physical conversation requirement. Real desktop, free hosted inference, visible-screen analysis, research retrieval and Blender creation/export were exercised; see [verification](VERIFICATION.md) for outcomes and limits. Protected controls, source availability, physical barge-in and manufacturing quality are not guaranteed by those checks.
