# Local agent architecture

JARVIS now uses a bounded observe/plan/execute/verify/recover loop. Simple, unambiguous app or website requests retain a fast path. Contextual and multi-step requests use the local model with fresh screenshots, accessibility control IDs and recent observed actions. Specialized tool families load on demand to limit model context. A task has at most 24 steps and two recovery rounds; repeated identical actions are bounded. Malformed arguments return structured failures to the planner instead of raw validation errors in chat.

## Screen context and Gaming Mode

Settings supports Off, Manual, While awake and Continuous vision. Continuous context samples the foreground window and screen, compares image hashes/differences, and analyzes significant changes at adaptive intervals. It pauses expensive analysis during active tasks and while JARVIS itself is foreground. Requested screen observations remain immediate. The Vision panel displays the active application, summary and recent events.

Screenshots, accessibility control IDs and recent screen events stay in memory. They are separate from saved notes. Audit logs can include technical failure details, but do not persist screen frames or typed text. Screen previews remain local to the HUD.

Gaming Mode can be automatic, on or off. Detection uses visible window/process names and installed Steam manifests, without reading game memory or packets. Background capture resolution and analysis frequency decrease, with a further reduction under GPU load. Commentary can be off, important only or normal. Proactive assistance defaults to low frequency. Gameplay input such as aiming, shooting and combat is blocked; help covers visible information, navigation menus and public research.

## Execution and safety

Tools report success, verification, observed results, retryability and a natural message. Browser navigation checks actual browser address controls after launch and offers one alternate address-field method. App launches check real processes/windows. File operations check filesystem results. Clicks bind a located target and current window to a single-use proof, recheck before input and compare the screen afterward. A changed screen is evidence of input response, not proof that a semantic task such as signing in finished.

Ordinary app launches, website navigation, scrolling and verified basic navigation remain automatic. Other clicks conservatively require confirmation unless an actual accessibility control certifies ordinary navigation. Deletion, sends/forms, installers, administrative commands and other consequential actions keep server-side approval requirements. The model cannot lower tool risk or bypass UAC. No blind retry follows a consequential action.

Public research searches real web results and extracts readable page text with source URLs. It does not submit forms, sign in, execute page scripts or access private network URLs. Sites requiring login or JavaScript-only content may need visible browser interaction. Web content and screen text are untrusted data, never authorization.

## Speech and cancellation

Microphones are enumerated before capture. Disconnected selections fall back to the system default, with reconnection on device changes. Application names and current window titles provide transcription hints; fuzzy application matching requires a conservative confidence margin. Ambiguous names are clarified instead of globally replacing words.

Speech interrupts voice playback immediately. A new utterance does not silently cancel a running PC task or pending approval. Say “stop” or “cancel” to stop the task while leaving live listening available. The Stop button and emergency hotkey still stop all actions.

## Local setup and manual check

The existing Ollama Qwen3.5 9B chat/vision model, CUDA faster-whisper small.en and Kokoro British voice remain configured. Cheerio is the only added package, for readable web extraction. Windows accessibility, screenshot, input and audio dependencies remain local. Launch using `Launch-JARVIS.cmd`.

Manually check microphone reconnection and barge-in first. Then check a simple website request, a multi-step browser request, an account/profile chooser in Steam, a visible-screen question, a public research question and Gaming Mode. Check that consequential actions require approval and that cancellation stops input. Try another monitor if you use one. Only lightweight static/build and isolated logic checks were performed; actual microphone and UI workflows require your manual testing.
