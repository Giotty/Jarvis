# JARVIS

A local-first Windows desktop assistant with an original cyan HUD, animated neural core, system telemetry, voice input, local model integration, screen analysis, structured tools, an action planner and an approval interlock. No paid APIs are required. This is an initial functional release; see the limitations below before enabling live control.

## Desktop interface

The command center combines rotating SVG rings, CPU/RAM/GPU graphs, a live clock, environment diagnostics, audio input visualization, an action pipeline and a command console. Nine modules provide vision, system processes, task history, editable memory, automation permissions, filesystem requests, settings and audit logs. GPU, temperature and battery sensors are displayed as unavailable when Windows does not expose them. The design uses no Marvel artwork or assets.

## Architecture

- `frontend/`: React + strict TypeScript + Vite; CSS animations and SVG HUD graphics.
- `desktop/`: Electron main process and isolated, sandboxed preload bridge. Tray, startup, screen capture and Windows integration.
- `core/`: local Ollama API, SQLite via sql.js, telemetry, validated tools, safety, planner and frame-difference vision.
- `voice/`: optional Python CPU/int8 faster-whisper and PyAutoGUI workers. Text-to-speech uses installed local Windows voices.
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
ollama pull qwen3:8b
```

In Settings → AI, refresh installed models and choose a conversation model. Tool-calling support is needed for automation. Choose a vision-capable model separately for screen analysis. Model names are configurable and not hardcoded by the application. The default server is `http://127.0.0.1:11434`; only loopback HTTP URLs are accepted. The local server must not be configured to forward prompts to paid cloud models if fully local operation is desired. API reference: [Ollama chat](https://docs.ollama.com/api/chat).

## Voice and Windows input

Create an optional project-local environment:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r voice\requirements.txt
```

Set the Python executable's absolute path in Settings → Voice. Enable microphone access, then use Push to Talk (click to start, click again to stop; 20-second maximum) or Ctrl+Shift+Space. Whisper model files download on first transcription and can be reused offline thereafter. Use `tiny` or `base` on slower machines. Wake phrase detection is opt-in and transcribes 5-second chunks, so it is less responsive than a dedicated wake-word engine. Saying only the wake phrase arms the next 20 seconds for a follow-up command. STT retains a warm model in a private Python process after the first transcription to reduce repeated loading. Responses use a local Windows voice, selectable at the bottom of Settings.

## Vision and browser workflow

Vision → Analyze Screen captures the selected monitor and sends a bounded-size JPEG to your local vision model. Modes: off, manual, awake, continuous. Continuous inference has a configurable minimum interval and skips unchanged frames using image hashing and downsampled differences. Frames are never saved permanently. Locate Element returns advisory physical desktop coordinates and confidence; verify them against the captured image.

Browser tools operate through your normal browser and physical mouse/keyboard. You can ask to open Gmail, analyze the visible screen, draft text and request a click. Each click, keystroke, clipboard operation and typed message requires exact-action approval. Sending mail or submitting forms therefore always requires approval. JARVIS hides before input so the previous application can receive it. The planner returns tool outputs to the model and can iteratively observe, locate elements, propose actions and re-observe, up to a hard limit of 12 tools. Reliability depends on the selected model and screen layout.

## Safety and memory

Mock mode is enabled by default. Enable relevant permissions in Settings → Automation before testing a plan. Switch mock mode off only when ready for physical PC control. Filesystem operations require a selected root. Deletions use the Recycle Bin and always require critical approval; permanent deletion is blocked. Arbitrary shells and admin actions are not supported. See [docs/SAFETY.md](docs/SAFETY.md).

Memory is stored only when explicitly added through the Memory page. It can be viewed, edited, deleted or cleared. Saved memories are provided as untrusted context to the model when memory is enabled. “Remember” requests can also use the guarded remember_memory tool. Task history stores tool names and status separately; prompts, arguments and results are excluded. Audit logs rotate at 1 MB and omit content and credentials.

## Windows build

```powershell
pnpm portable   # release-final/win-unpacked/JARVIS.exe
pnpm dist       # release-final/JARVIS Setup 0.1.0.exe
```

The installer creates a normal Start menu entry and optional desktop shortcut. The app has a generated original icon, a system tray menu, minimize-to-tray, and opt-in Windows startup. This release is unsigned; Windows may show a publisher warning. Python/STT/automation dependencies and Ollama models are not bundled in the installer. The HUD, system monitoring, SQLite memory and Windows TTS do not need Python.

## Verification and known limitations

`pnpm test` covers configuration privacy defaults, fixed risk levels, mock execution, approvals, filesystem traversal, SQLite persistence, planner pause/resume, denial, invalid tools, unchanged vision frames, metadata-only logs and real telemetry. `pnpm build` verifies strict TypeScript and frontend bundling.

Not included: OCR, foreground-window identity enforcement before actions, dedicated low-latency wake-word engine, Piper neural voices, streaming LLM output, guaranteed browser task completion, arbitrary application discovery, precise Windows master-volume API, automatic conversation summaries, software installation, elevated/admin commands or permanent deletion. Optional devices, Whisper, actual Ollama models and physical automation require local setup and must be tested on the user's hardware. GPU/VRAM readings depend on driver support. Model suggestions can be wrong; review plans and approval dialogs.

## Repository protection

This project was created in a separate new directory and targets only the newly created `Giotty/Jarvis` repository, whose capitalization was explicitly accepted by its owner. Before any push, run `git remote -v` and verify the URL. Do not reuse another repository.
