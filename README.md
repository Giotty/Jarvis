# JARVIS

Version 0.2.1 adds verified Windows master volume control and generic label-based navigation across applications. Named buttons, tabs and menu items use accessibility first, with native activation patterns and guarded mouse/vision fallback. Tool schemas retain their full instructions, parameter descriptions, bounds and defaults. This reduces unnecessary screenshots and model rounds without adding phrase-specific command handlers. Full-drive file access is available through `fileAccess: computer` and remains subject to Windows account permissions; risky actions still require approval.

JARVIS now uses one general model-driven agent for voice and typed requests. OpenAI, Claude and Ollama share a provider interface; tools come from enabled built-in plugins and optional MCP servers. The model discovers capabilities, combines them, observes results and recovers within configured limits. The desktop does not match each user phrase to a bespoke action handler. Existing legacy routing modules remain for regression coverage but are not the desktop agent entry point.

Start with `Launch-JARVIS.cmd`. Open **Settings → AI Providers**, choose a primary and fallback provider, enter a model name or discover available names. Cloud inference is off by default. For OpenAI/Claude, save your key with **SAVE KEY SECURELY**, enable cloud AI, and save configuration. API keys are encrypted using Windows DPAPI through Electron safeStorage in the local profile, separate from ordinary configuration; keys are never returned through IPC. Cloud API access may incur provider charges. No cloud account/key was created or charged during development. See [the implementation report](docs/GENERAL_AGENT_REPORT.md) for setup, verification and limitations.

The **Plugins** page shows enablement, declared permissions, connection status, schemas and risk levels. Built-ins cover Windows, screen/input, browser, files, research, Steam, Roblox, system and explicit memory. Configure installed stdio MCP servers or HTTPS/loopback HTTP servers there. New external servers start disabled; review and enable them, optionally save an encrypted token, then connect. External calls require approval regardless of server safety annotations. Installing new server software and automatic OAuth/account onboarding are separate from this connector framework.

Local setup on the owner's PC uses Ollama at `http://127.0.0.1:11434`, `qwen3.5:9b` for chat, tools and vision, Whisper `small.en` for English recognition, and Kokoro's British male `bm_george` voice. Double-click `Launch-JARVIS.cmd`. Recognition automatically uses CPU when free GPU memory is low and recovers from failed CUDA workers. Speech models warm at startup. Short requests incur one transcription. Model text streams to the HUD; natural speech uses the completed, checked response. Interrupted replies discard playback without unloading the voice. Settings are saved atomically with a validated backup, preserving the selected voice across restarts. No specific response time is guaranteed. Recent context stays in memory until exit; weights and machine-specific configuration are excluded from Git.

Computer access is enabled on this PC. JARVIS discovers installed Start menu/Store applications instead of limiting launches to seven names, opens Windows Settings pages, lists directories and local drives, reads text files, opens documents, and saves/moves/recycles files with confirmation. Absolute local drive paths are supported; relative paths start in your user folder. PowerShell can perform requested settings, registry and app operations after showing the exact script for approval. Windows account permissions still apply; protected operations need Windows UAC. Network shares are outside this mode, binary file analysis uses its application and screen tools, and access does not guarantee every app exposes automatable controls.

Hands-free conversation is enabled on this PC. Speak normally, pause briefly to send your request, and speak again to interrupt a reply. Say “cancel” to stop an action task; merely interrupting speech preserves running actions and approval dialogs. The microphone stays open while JARVIS transcribes, thinks, speaks, or sits in the tray. Use PAUSE LISTENING to mute; RESUME CONVERSATION to reconnect. STOP / Ctrl+Shift+Backspace also mutes the microphone. Audio is processed in memory and never saved. A new spoken turn discards stale pending transcriptions. Actions wait for the complete utterance to avoid speculative launches. Short requests wait for a 600 ms pause and are decoded once. Use headphones if the microphone hears JARVIS's own voice; echo cancellation depends on the audio hardware. Optional NVIDIA packages are listed in `voice/requirements-gpu.txt`; no paid service or GPU compiler is used.

Try “Open YouTube and search MrBeast”, then “click on the first video on the page” with the YouTube browser window in front. The video action selects actual visible video links from Windows accessibility, excluding channel/Shorts links; playback is not claimed as verified. Failed automation restores the HUD without stealing keyboard focus. Searches and verified ordinary navigation run automatically. General typing focuses a real accessible edit field and verifies its value. Destructive actions and sending messages retain confirmation. To reproduce the voice setup, install `voice/requirements.txt`, run `scripts/install-voice-models.py` with that Python, then run `node scripts/install-models.cjs` and `node scripts/configure-local.cjs`.

A local-first Windows desktop assistant with an original cyan HUD, animated neural core, system telemetry, voice input, local model integration, screen analysis, structured tools, an action planner and an approval interlock. No paid APIs are required. This is an initial functional release; see the limitations below before enabling live control.

## Desktop interface

The command center combines rotating SVG rings, CPU/RAM/GPU graphs, a live clock, environment diagnostics, audio input visualization, an action pipeline and a command console. Modules provide vision, system processes, task history, editable memory, automation permissions, filesystem requests, plugins, settings and audit logs. GPU, temperature and battery sensors are displayed as unavailable when Windows does not expose them. The design uses no Marvel artwork or assets.

## Architecture

- `frontend/`: React + strict TypeScript + Vite; CSS animations and SVG HUD graphics.
- `desktop/`: Electron main process and isolated, sandboxed preload bridge. Tray, startup, screen capture and Windows integration.
- `core/agent/`: model-driven loop, selected conversation/task context and checked response generation.
- `core/providers/`: shared provider interface, OpenAI Responses, Claude Messages, Ollama, local encrypted secrets and fallback/privacy routing.
- `core/plugins/`: manifests, dynamic schemas, host permissions, built-ins and MCP connections with isolated timeouts.
- `core/`: SQLite via sql.js, telemetry, validated automation tools, host safety and frame-difference vision.
- `voice/`: warm local Whisper and Kokoro/Piper workers, PyAutoGUI, and Windows UI Automation for accessible controls and verified typing. Windows voices remain an alternative.
- `tests/`: safety, parameter validation, planner, persistence, privacy, vision and telemetry tests.

Electron was selected because Node is available on the target machine, Rust is not, and Electron supports tray, capture and desktop packaging without introducing a Rust toolchain. No TCP control server is exposed. Renderer access is through a finite set of validated IPC handlers.

## Development installation

Install Node.js 22 or newer, pnpm 11, and Python 3.11+ if voice/PC input is wanted. Run from this new project directory:

```powershell
pnpm install
pnpm test
pnpm dev
```

`pnpm-workspace.yaml` permits build scripts for Electron, esbuild and electron-winstaller only. Dependency versions are resolved in the lockfile. `pnpm build` checks TypeScript and produces the frontend. `pnpm start` launches that built desktop application. The app writes user data to `%APPDATA%/JARVIS` (Electron's configured user-data path), outside the repository. No startup entry is enabled by default.

## Local AI setup

Install Ollama from [ollama.com](https://ollama.com/download/windows), start it, then install a model appropriate for your computer. The app never installs Ollama or downloads models on your behalf. For example:

```powershell
ollama pull qwen3.5:9b
```

In Settings → AI Providers, use Ollama's SAVE & DISCOVER MODELS button and choose or enter model names. Tool-calling support is needed for automation. Choose a vision-capable model separately for screen analysis. Model names are configurable and not hardcoded by the application. The default server is `http://127.0.0.1:11434`; only loopback HTTP URLs are accepted. The local server must not be configured to forward prompts to paid cloud models if fully local operation is desired. API reference: [Ollama chat](https://docs.ollama.com/api/chat).

## Voice and Windows input

Create an optional project-local environment:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r voice\requirements.txt
```

Set the Python executable's absolute path in Settings → Voice. Enable microphone access and Hands-free live conversation for continuous listening and interruption. Pause/resume with the microphone button or Ctrl+Shift+Space. With conversation mode and wake phrase off, the button starts a single recording that ends after a pause or a second button press. Recordings are capped at 25 seconds per utterance. Wake phrase mode gates locally recognized requests on the configured phrase and arms the next 20 seconds when only the phrase is spoken. Whisper retains its model in a private Python process; no silent chunks are transcribed. Choose Kokoro British voices, Piper, or Windows voices in Settings. The configured models are already downloaded and recognition expects English. Complete utterances are required before starting actions; partial recognition never launches an application. This does not replace the local model with a cloud real-time service.

## Vision and browser workflow

Vision → Analyze Screen captures the selected monitor and sends a bounded-size JPEG to your configured vision provider, subject to cloud image privacy settings. Background analysis stays local. Modes: off, manual, awake, continuous. Continuous inference has a configurable minimum interval and skips unchanged frames using image hashing and downsampled differences. Frames are never saved permanently. Locate Element returns advisory physical desktop coordinates and confidence; verify them against the captured image.

Browser tools operate through your normal browser and physical mouse/keyboard. You can ask to open Gmail, analyze the visible screen, draft text and request a click. Browser searches, verified search fields and ordinary navigation run automatically. Ambiguous clicks, sensitive typing, Enter hotkeys and consequential clipboard use require approval. Ordinary edit-field focus and typing run automatically. Sending mail or submitting forms therefore always requires approval. JARVIS hides before input so the previous application can receive it. The planner returns tool outputs to the model and can iteratively observe, locate elements, propose actions and re-observe, up to a hard limit of 24 tools. Reliability depends on the selected model and screen layout.

## Safety and memory

Mock mode is enabled by default for new installations. This owner's configuration has live mode and computer-wide local file access enabled. A selected-folder scope remains available. Deletions use the Recycle Bin and require critical approval; permanent deletion is blocked. All PowerShell scripts and direct executable paths require critical approval. Windows UAC must authorize elevation. See [docs/SAFETY.md](docs/SAFETY.md).

Memory is stored through the Memory page or intentional memory tools. The model can search notes; writes, updates and deletions require confirmation. It never automatically saves conversation or observations. Notes are untrusted data. Task history stores tool names and status separately; prompts, arguments and results are excluded. Audit logs rotate at 1 MB and omit content and credentials.

## Windows build

```powershell
pnpm portable   # release-final/win-unpacked/JARVIS.exe
pnpm dist       # release-final/JARVIS Setup 0.2.1.exe
```

The installer creates a normal Start menu entry and optional desktop shortcut. The app has a generated original icon, a system tray menu, minimize-to-tray, and opt-in Windows startup. This release is unsigned; Windows may show a publisher warning. Python/STT/automation dependencies and Ollama models are not bundled in the installer. The HUD, system monitoring, SQLite memory and Windows TTS do not need Python.

## Verification and known limitations

`pnpm test` covers configuration privacy defaults, fixed risk levels, mock execution, approvals, filesystem traversal, SQLite persistence, planner pause/resume, denial, invalid tools, unchanged vision frames, metadata-only logs and real telemetry. `pnpm build` verifies strict TypeScript and frontend bundling.

Not included: dedicated OCR, dedicated wake-word engine, guaranteed browser task completion, precise Windows master-volume API, automatic conversation summaries, network-share access or permanent deletion. Binary formats are opened in their registered applications; direct text reading handles UTF-8. Software/settings operations can use approved PowerShell scripts, subject to Windows permissions and UAC. Physical microphone capture still depends on a connected Windows input device. GPU/VRAM readings depend on driver support. Model suggestions can be wrong; review consequential actions and approval dialogs. See `docs/VERIFICATION.md` for recorded checks and their limits.

## Repository protection

This project was created in a separate new directory and targets only the newly created `Giotty/Jarvis` repository, whose capitalization was explicitly accepted by its owner. Before any push, run `git remote -v` and verify the URL. Do not reuse another repository.
