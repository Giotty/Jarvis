# Verification

Verified on Windows x64 using the project-local Node dependencies and Python environment.

- ESLint: passed.
- Strict TypeScript and Vite production build: passed.
- Automated tests: 16 passed, covering privacy defaults, immutable risks, single-use approvals, approval expiration, denial, mock execution, media-key simulation, filesystem traversal, SQLite persistence, task-content exclusion, bounded iterative planning, metadata-only logs, frame deduplication, telemetry and missing-Python failure.
- Electron source smoke test: preload bridge responded, renderer Node access was disabled, live CPU telemetry was returned, and three installed local Windows TTS voices were detected.
- Packaged `JARVIS.exe` smoke test: exited with code 0; preload bridge, CPU telemetry, original HUD and installed local voices worked from the packaged ASAR distribution. Local screenshot: `screenshots/JARVIS-HUD.png` (excluded from Git).
- Windows x64 NSIS installer: built successfully. Packaging uses the installed Electron distribution to avoid a Windows staging-directory rename failure.

Still requires hardware/runtime setup: Ollama installation and selected chat/vision models, the first Whisper model download, real microphone transcription, audible TTS playback, screen inference, and live mouse/keyboard/browser workflows. Automated tests do not move the user's mouse, type in external applications, send messages, delete files or install the generated installer.

The app is an initial release. Model-driven browser navigation is bounded and requires approval for physical input. OCR, dedicated wake-word models, precise master-volume control and administrator operations are not included. See the README and safety document for details.
