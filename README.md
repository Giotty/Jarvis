# JARVIS — MAATOUK INDUSTRIES

**0.4.0** adds a spatial research workspace to JARVIS's general AI desktop agent and original reactor HUD. Narration focuses, advances and docks movable research modules automatically. Briefings can be compared, saved and reopened locally. Voice/text retain shared reasoning, dynamic tools, observation, verification and recovery.

## Launch

Double-click **Launch-JARVIS.cmd**. It starts installed Ollama and `release-final\win-unpacked\JARVIS.exe`. The installer is `release-final\JARVIS Setup 0.4.0.exe`.

The existing profile retains **Ollama/qwen3.5:9b**, **Whisper small.en** and **Kokoro bm_george** British male speech. Piper/Windows voices remain supported. Windows currently exposes **no recording endpoint**: connect/enable a microphone and choose it in radial VOICE settings.

## Interface

Original triangular SVG core, mechanical rings/ticks/scanners, actual telemetry left, AI/context/plugins right, compact command strip below. No top navigation or viewport scrolling. History/memory/tasks/process/logs use paged drawers. Unavailable sensors stay unavailable.

Bottom-right settings retract the HUD and open **AI/VOICE/VISION/PLUGINS/PRIVACY/SAFETY/SYSTEM/APPEARANCE** around the core. Low/normal/high intensity, reduced/off motion and fullscreen are supported. **Escape exits fullscreen**. Layouts were checked at 1366×768, 1920×1080 and 2560×1440.

## Providers

Radial AI settings configure primary/fallback/dedicated-vision providers and model IDs.

| Provider | Integration                                                                                                      | Verification                     |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| OpenAI   | Responses: conversation, images, tools, streaming, JSON Schema, usage                                            | Mocks; no account inference      |
| Claude   | Messages: conversation, images, tools, streaming, structured responses, usage                                    | Mocks; no account inference      |
| Gemini   | Google v1beta: generation/streaming, functions, exact thought-signature replay, images, structured output, usage | Mocks; no account inference      |
| Ollama   | Local text/streaming and model-supported tools/vision                                                            | Actual installed model and tasks |

Capabilities: TEXT/VISION/TOOLS/STRUCTURED_OUTPUT/STREAMING/REASONING. Ollama supplies local flags. Unknown cloud models start conservatively; set their profile from model documentation. A vision-only route can caption for the tool-capable primary. Fallback obeys cloud OFF, local-only tasks, sharing permissions and cancellation.

For cloud use, configure a model, **SAVE KEY SECURELY**, enable cloud AI in PRIVACY and save. Keys/tokens use safeStorage/Windows DPAPI; IPC returns presence only. No account/key is supplied. Provider quotas/charges are not guaranteed free. The owner profile remains local/cloud OFF.

## Agent, plugins and safety

Enabled manifests dynamically supply Windows/apps, screen/accessibility, input, browser, files/drives, system/media/clipboard, Steam, Roblox, research and explicit-memory tools. Shared discovery/launch and accessibility-first activation serve arbitrary apps/controls with guarded visual fallback. Dispatch alone does not prove success. The loop has bounded steps/deadlines/retries, dependency checks, repeated-action prevention and cancellation. Historical phrase routers are only in `tests/legacy`, excluded from packaging.

PLUGINS shows connections, enablement, permissions, schemas, risk and counts. MCP supports configured installed stdio servers/permitted HTTP endpoints with encrypted tokens and bounded calls. New external servers start disabled; calls require confirmation. Server installation and account/OAuth onboarding remain separate setup.

Host permissions stay outside the model. Ordinary permitted launches/navigation/volume run automatically. Sending/posting/submitting, risky files, downloads/execution, PowerShell/admin/security changes and shutdown/restart retain confirmation. Approval covers one immutable action for 60 seconds; the amber dialog shows complete paged arguments. STOP/Ctrl+Shift+Backspace cancels task/playback and mutes listening. Simulation is visibly marked. Windows permissions/UAC still apply.

Computer file scope searches accessible local drives/deep/hidden folders in bounded pages reporting partial status/cursors. It does not grant administrator/network-share access. Images/clipboard/files stay local unless separately enabled for cloud sharing. Memory persists only intentional notes, separately from transient context. Data lives in `%APPDATA%\jarvis`, outside Git.

## Research, screen and voice

Background public search/pages, weather, YouTube metadata/feeds and page-associated images feed a source registry without opening Google. Explicit open/watch/interact requests can still use browser tools.

The model presents verified sections progressively as spatial modules: text, metrics, comparisons, timelines, charts, radial percentages and sources/images. Move, resize, expand, pin, dock or compare modules; summaries/items have page controls. SAVE BRIEFING preserves content, layout and image references in the app data Research folder. The compact RESEARCH LIBRARY control reopens, renames or deletes sessions with confirmation. Code/HTML is rejected; chart numbers must occur in cited evidence. Images use registered IDs, validated public addresses/redirects, DNS-pinned fetching, lazy bounded caching, pseudo-3D planes and unavailable placeholders. Image bytes remain in memory. Video/map panels are previews/text, not embedded playback/maps.

Narration automatically highlights content, advances sections and retains completed modules in the dock after actual audio playback. PAUSE/RESUME/PREVIOUS/NEXT/REPEAT/STOP remain optional. Interruptions invalidate callbacks. A shared sanitizer removes spoken URLs, formatting, emojis and source IDs while keeping visual citations. Spoken stop/cancel/wait/never-mind cancels tasks; ordinary speech interruption stops playback while approvals remain explicit.

Screen OFF/MANUAL/WHILE AWAKE/CONTINUOUS modes retain adaptive capture, hashes/differences, foreground context and throttled local vision. Gaming uses visible pixels only, without game-memory inspection/injection/combat automation. Proactive help defaults LOW.

Whisper handles complete utterances through the same agent. Hands-free interruption, CPU fallback and warm Kokoro/Piper workers remain. Partial transcripts never start speculative actions; audio stays in memory. Hardware, echo cancellation and model latency remain constraints.

## Development/build

Use Node.js 22+, pnpm and Python 3.11+:

```powershell
pnpm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r voice\requirements.txt
pnpm dev
pnpm lint
pnpm test
.venv\Scripts\python.exe -m unittest discover -s tests -p '*_test.py'
pnpm build
pnpm start
pnpm dist
```

Set absolute Python/model paths in settings. Existing installation scripts reproduce local setup. Python dependencies/Ollama/weights are not bundled; they already exist on this PC. Rust is unnecessary. `pnpm portable` builds the unpacked executable. Packaging checks frozen bytes/syntax/metadata and removes Electron's demo fallback. The build is unsigned; startup is opt-in. Normal use exposes no TCP control endpoint.

Architecture: frontend React/TypeScript/SVG; desktop sandboxed Electron/finite validated IPC; core/agent general loop; core/providers routing; core/plugins MCP/manifests; core/briefing.cjs scenes; core/research-agent.cjs public retrieval; voice workers; tests regression/mocks.

See [spatial research](docs/SPATIAL-RESEARCH.md), [rebuild report](docs/REBUILD_REPORT.md), [verification/limits](docs/VERIFICATION.md) and [safety](docs/SAFETY.md). UI checks do not guarantee fast inference. The new presentation infrastructure passed isolated integration checks; live Ollama research timed out during this update. Every model decision/website/app control cannot be guaranteed.
