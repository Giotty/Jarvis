# JARVIS — MAATOUK INDUSTRIES

**0.6.0** adds free NVIDIA hosted routing with observed per-model capabilities, local semantic memory/document extraction, and real Blender creation, editing, exports and an interactive 3D workspace. The MAATOUK HUD, British male voice, local screen context, Gemini budget and host safety checks are retained.

## Launch

Double-click **Launch-JARVIS.cmd**. It starts installed Ollama and `release-final\win-unpacked\JARVIS.exe`. The installer is `release-final\JARVIS Setup 0.6.0.exe`.

The existing profile retains **Ollama/qwen3.5:9b**, **Whisper small.en** and **Kokoro bm_daniel** British male speech. Piper/Windows voices remain supported. Windows currently exposes **no recording endpoint**: connect/enable a microphone and choose it in radial VOICE settings.

## Interface

Original triangular SVG core, mechanical rings/ticks/scanners, actual telemetry left, AI/context/plugins right, compact command strip below. No top navigation or viewport scrolling. History/memory/tasks/process/logs use paged drawers. Unavailable sensors stay unavailable.

Bottom-right settings retract the HUD and open **AI/VOICE/VISION/PLUGINS/PRIVACY/SAFETY/SYSTEM/APPEARANCE/3D** around the core. Low/normal/high intensity, reduced/off motion and fullscreen are supported. **Escape exits fullscreen**. Layouts were checked at 1366×768, 1920×1080 and 2560×1440.

## Providers

Radial AI settings configure primary/fallback/dedicated-vision providers and model IDs.

| Provider | Integration                                                                                                      | Verification                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| NVIDIA   | Free serverless OpenAI-compatible chat, native tool continuation, streaming, JSON and requested images           | Actual authenticated free requests; capability profiles |
| NIM      | Optional loopback OpenAI-compatible endpoints; disabled until a compatible local deployment exists               | Interface tests; no local NIM installed                 |
| OpenAI   | Responses: conversation, images, tools, streaming, JSON Schema, usage                                            | Mocks; no account inference                             |
| Claude   | Messages: conversation, images, tools, streaming, structured responses, usage                                    | Mocks; no account inference                             |
| Gemini   | Google v1beta: generation/streaming, functions, exact thought-signature replay, images, structured output, usage | Mocks; no account inference                             |
| Ollama   | Local text/streaming and model-supported tools/vision                                                            | Actual installed model and tasks                        |

Capabilities: TEXT/VISION/TOOLS/STRUCTURED_OUTPUT/STREAMING/REASONING. NVIDIA advanced flags require actual probes, not model-name guesses. AI settings expose VERIFY FREE MODELS, cancellation, observed latency, availability, rate limits and cached proof. A structured TaskProfile selects fast/general/deep/vision roles; failures escalate through compatible free models, then Gemini and Ollama. A vision-only route can caption for a tool-capable planner. Private mode and sharing restrictions override model preferences.

Enter one NVIDIA key in AI settings and **Encrypt & Save**. Keys/tokens use Electron safeStorage/Windows DPAPI; IPC returns presence only. No credential is included in the repository or installer. FREE ONLY pins NVIDIA's development endpoint, allows only the verified free catalog, and blocks paid OpenAI/Claude routes and paid Gemini grounding. Those adapters remain available for explicitly configured use outside free mode. Provider pricing/availability can change; free failure never enables billing.

The configured owner uses NVIDIA AUTO routing with Ollama fallback. Gemini remains in the priority list but is skipped until a fresh secure Gemini key is saved; its older chat-exposed credential was removed under the compromised-key rule. Kimi handles general conversation and requested vision; Lightning handles fast actions and native tools; Ultra handles deep reasoning; Muse is a compatible tool fallback. DeepSeek did not produce a usable response in this account's checks; GLM is disabled because free access was not established. Exact observations and limitations: [NVIDIA and 3D](docs/NVIDIA-3D.md).

NVIDIA and Gemini have independent configurable daily request budgets: defaults 100 each, 80% warning, cap fallback, local-midnight reset. These count JARVIS API attempts, including probes/classification/retries; they do not report Google's or NVIDIA's actual remaining quota. The owner's NVIDIA cap was set to 300 during setup/testing; Gemini remains 100. If local Ollama is stopped, JARVIS starts it on a refused connection. Local chat unloads after two idle minutes instead of retaining GPU memory for half an hour.

## Agent, plugins and safety

Enabled manifests dynamically supply Windows/apps, screen/accessibility, input, browser, files/drives, system/media/clipboard, Steam, Roblox, research and explicit-memory tools. Shared discovery/launch and accessibility-first activation serve arbitrary apps/controls with guarded visual fallback. Dispatch alone does not prove success. The loop has bounded steps/deadlines/retries, dependency checks, repeated-action prevention and cancellation. Historical phrase routers are only in `tests/legacy`, excluded from packaging.

PLUGINS shows connections, enablement, permissions, schemas, risk and counts. MCP supports configured installed stdio servers/permitted HTTP endpoints with encrypted tokens and bounded calls. New external servers start disabled; calls require confirmation. Server installation and account/OAuth onboarding remain separate setup.

Host permissions stay outside the model. Ordinary permitted launches/navigation/volume run automatically. Sending/posting/submitting, risky files, downloads/execution, PowerShell/admin/security changes and shutdown/restart retain confirmation. Approval covers one immutable action for 60 seconds; the amber dialog shows complete paged arguments. STOP/Ctrl+Shift+Backspace cancels task/playback and mutes listening. Simulation is visibly marked. Windows permissions/UAC still apply.

Computer file scope searches accessible local drives/deep/hidden folders in bounded pages reporting partial status/cursors. It does not grant administrator/network-share access. Images/clipboard/files stay local unless separately enabled for cloud sharing. Memory persists only intentional notes, separately from transient context. Data lives in `%APPDATA%\jarvis`, outside Git.

## Research, screen and voice

Background public search/pages, weather, YouTube metadata/feeds and page-associated images feed a source registry without opening Google. Explicit open/watch/interact requests can still use browser tools.

The model presents verified sections progressively as spatial modules: text, metrics, comparisons, timelines, charts, radial percentages and sources/images. Move, resize, expand, pin, dock or compare modules; summaries/items have page controls. Per-file SAVE, group SAVE and SAVE ALL preserve content, layout, sources and image references in the local Research library. Create virtual folders, move saved entries between folders and reopen a folder as floating files. Trashing a workspace file preserves its saved copy; deleting saved entries retains confirmation. Code/HTML is rejected; chart numbers must occur in cited evidence. Images use registered IDs, validated public addresses/redirects, DNS-pinned fetching, lazy bounded caching, pseudo-3D planes and unavailable placeholders. Image bytes remain in memory. Video/map panels are previews/text, not embedded playback/maps.

Narration completion advances the focused file and keeps older files visible in context or stacks. Pointer hold/drag/resize locks the selected file without pausing speech; incoming visuals stage until release and reconcile only the latest layout. Pins and manual placement prevent automatic rearrangement. PAUSE/RESUME/PREVIOUS/NEXT/REPEAT/STOP remain optional. Interruptions invalidate callbacks. A shared sanitizer removes spoken URLs, formatting, emojis and source IDs while keeping visual citations. Spoken stop/cancel/wait/never-mind cancels tasks; ordinary speech interruption stops playback while approvals remain explicit.

Screen OFF/MANUAL/WHILE AWAKE/CONTINUOUS modes retain adaptive capture, hashes/differences, foreground context and throttled local vision. Gaming uses visible pixels only, without game-memory inspection/injection/combat automation. Proactive help defaults LOW.

Whisper handles complete utterances through the same agent. Hands-free interruption, CPU fallback and warm Kokoro/Piper workers remain. Partial transcripts never start speculative actions; audio stays in memory. Hardware, echo cancellation and model latency remain constraints.

## Local memory, documents and 3D

Local semantic retrieval uses SQLite vectors and Ollama `all-minilm:l6-v2` (384 dimensions, CPU), with keyword fallback and immediate invalidation on edits/deletion. Saved research content is indexed along with deliberate memory. PDF/XPS/EPUB text/tables use local PyMuPDF. OCR is on demand through optional local NIM or existing accessibility/vision fallbacks; no huge NIM containers were installed on this 8 GB RTX 4060.

Official Blender 4.5.14 LTS is installed in `.tools/blender-4.5.14-windows-x64`; the owner profile already has its path. Validated operations build actual geometry/materials/lights/cameras, render through bounded CPU Cycles jobs and export BLEND/GLB/GLTF/OBJ/STL/FBX. No generated Python is executed. Projects have immutable revisions under `%APPDATA%\jarvis\3D`. Saving to the Library preserves 3D references; external exports and overwrites retain confirmation.

Try “Create a simple futuristic hockey puck in 3D,” then “Make this 9.5 centimeters wide.” AI render review and correction have a configurable iteration cap. An unavailable visual review is reported honestly and the last real revision remains available. GLB cards support orbit/zoom/pan/reset/focus/save/reopen and render less under load or while hidden. STL export alone does not establish print readiness: inspect manifold warnings and geometry first. Portable Blender, Python dependencies and model weights are installed locally, not bundled in the small installer.

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

See [NVIDIA/3D architecture and limits](docs/NVIDIA-3D.md), [verification](docs/VERIFICATION.md), [spatial research](docs/SPATIAL-RESEARCH.md) and [safety](docs/SAFETY.md). Real research creates sourced cards/images without browser navigation, but incomplete analysis and blocked/historical sources still occur. Current research has temporal safeguards; exact current team lines need dated reliable evidence. Every model decision, website or application control cannot be guaranteed.
