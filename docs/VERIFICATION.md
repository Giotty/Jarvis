# Verification

## Real application launches — 0.2.2

- Simulation is off in the saved profile and the packaged app's live IPC snapshot. Default configuration now uses real control; simulation remains an explicit optional setting with a prominent warning and an enable-real-control button. Capability permissions and consequential-action approval remain enabled.
- Windows Start menu discovery returned 147 installed applications. The common discovery/launch route is retained for arbitrary installed names, with registered desktop paths and Store app identities supported.
- The packaged app received `Open Steam` and `Open Calculator` through its production command IPC. Both tasks completed, reported their applications open, and recorded real `running` tool executions rather than mock executions. Runtime voice settings remained Kokoro / `bm_george`.
- 17 focused JavaScript tests passed, including simulated launches, switching the same executor to real control for two arbitrary future application names, permission gates and destructive-action approvals. ESLint, TypeScript and Vite build passed. Packaging verified all 60 application files and produced Windows version 0.2.2.
- This does not guarantee launch success for removed/broken installations or automatable controls in every app. No exhaustive application launch sweep was performed. The temporary local debugging endpoint was removed by restarting JARVIS normally after the checks.

## General desktop controls — 0.2.1

- JavaScript: 115 passed, 0 failed. Python: 21 passed, including endpoint volume, native control activation, stale runtime identities, meaningful schema constraints, duplicate targets, preparation deadlines, parent-context failures and bounded recovery.
- ESLint, strict TypeScript and Vite production build passed.
- Actual Windows test window: a Collections tab was selected using SelectionItemPattern; a LIBRARY menu was activated using InvokePattern. Both effects were independently verified. These target operations took about three seconds each, excluding model generation. The disposable window was closed afterward.
- Actual Windows default audio endpoint: a one-point change was read back, and the previous volume/mute state was restored. The real Ollama general agent then selected `set_volume` with the requested explicit amount, verified it and replied naturally in about four seconds; its test change was also restored.
- Full local drive access, filesystem, mouse, keyboard, browser and Windows command permissions were already enabled in the owner's configuration and are retained. Windows account/UAC restrictions and consequential approvals remain.
- Steam was not open during the final physical checks. Those checks used a disposable native Windows window; verify Steam's current Library control manually. Controls not exposed by accessibility continue to use image-based fallback and can remain slower or uncertain.
- Windows installer 0.2.1 built successfully and 60 packaged application files matched the frozen source. The packaged runtime passed IPC, AudioWorklet, encrypted credentials and provider/plugin UI checks (10 plugins / 63 tools). No paid APIs, destructive user-file operations, account changes or security-setting changes were performed.

References used for implementation: [Microsoft control patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview), [pycaw endpoint volume](https://github.com/AndreMiras/pycaw/blob/develop/examples/audio_endpoint_volume_example.py), [Zod 3 JSON Schema conversion](https://github.com/StefanTerdell/zod-to-json-schema).

## General agent/provider update — 0.2.0

- Final JavaScript suite: 106 passed, 0 failed, covering old automation safeguards and the new providers, general agent, private-data routing, dynamic plugins, MCP protocol, retries, immutable approvals, expiry, cancellation and action verification. Cloud providers were exercised with mocks, not paid requests. Local-first preference and escalation after tools or a local outage are covered.
- Python accessibility suite: 10 tests passed.
- ESLint, strict TypeScript and Vite production build passed.
- Actual MCP protocol negotiation, discovery, successful calls, input-schema failures and tool errors passed against an isolated local stdio server. These checks do not validate third-party services or accounts.
- Windows Electron runtime/UI smoke passed with an isolated local profile: IPC bridge, AudioWorklet load, DPAPI credential save/status/remove, cloud OFF, provider settings with two masked key fields, plugin list (10 plugins / 61 tools) and schemas. HUD/provider/plugin screenshots were inspected.
- Three consecutive real Ollama requests completed through the new general agent: greeting, combined actual telemetry/foreground-window reading, and a context follow-up. No restart was needed. The combined task took roughly 28 seconds while this PC was heavily loaded; this is a functional check, not a latency guarantee. No paid key was provided.
- Packaging checked frozen source bytes, JavaScript syntax and application metadata for 58 application files; installer version is 0.2.0. The final packaged executable also passed the isolated runtime/UI check, including DPAPI save/remove and all 10 plugins / 61 schemas.

No real cloud inference, email sends, purchases, deletions of user files, account/security changes, installs/uninstalls or administrator scripts were tested. Test credentials were dummy values in isolated profiles and removed afterward. Existing physical microphone, browser and Steam manual checks remain necessary. Older live automation results below predate the provider refactor and do not establish that every future model decision succeeds.

Windows x64 checks for the October 1 stability update:

- JavaScript regression suite: 66 tests, covering task recovery, approval expiry, conversation order, window targeting, localized browser fields, ordinal account selection, model capabilities, settings backups, voice interruption and consequential-action guards.
- Python accessibility tests: ten checks covering localized editable search fields, read-back verification, foreground changes, sensitive destinations and ambiguity.
- Live JARVIS UI opened YouTube in the existing Chrome window and verified its actual address. Steam account selection was tested on the real saved-account chooser; the requested first account was independently verified in Steam's account header afterward.
- Local Kokoro synthesis and Whisper recognition were exercised through the production IPC bridge with three synthetic spoken phrases. Warm synthesis took roughly 0.7–1 second; CPU recognition roughly 1–3 seconds. These are short synthetic recordings, not a hardware microphone or latency guarantee.
- The selected Kokoro British voice survived development-app restarts. Configuration backup recovery is covered separately.
- Packaging validates application metadata, JavaScript syntax and every packaged source byte against a frozen build snapshot. No Electron demo fallback is left in the distribution.

Live browser editing placed the requested text into the actual YouTube search box, with an unchanged address bar and no implicit submission. A subsequent Search action opened actual results. Typing, searching and a conversational follow-up ran in sequence without restarting; the third reply completed in about two seconds. Unit fixtures do not replace physical desktop checks. Model-driven tasks can still misinterpret ambiguous goals and some applications expose incomplete accessibility trees.

Windows currently exposes no microphone input device on the owner's PC. Hands-free microphone capture, echo cancellation and physical barge-in require connecting/selecting a microphone. Synthetic speech tests verify the local engines, not those hardware features. The UI reports this condition instead of showing a misleading READY status.

No emails/messages, destructive file actions, purchases, form submissions, administrative scripts or software installation actions were performed during functional checks. Those paths remain confirmation-gated.
