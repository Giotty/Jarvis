# JARVIS safety model

Browser search URLs, verified search-field filling, narrowly allowed navigation controls, scrolling and named Roblox game launch run automatically. General edits, sending messages, other clicks and destructive actions retain confirmation. UI edit values are read back before reporting successful typing.

The model proposes structured tools. The executor validates all arguments using Zod. Risk levels are defined by code and cannot be overridden by model output. The renderer cannot access Node, Electron internals, a shell, or arbitrary IPC channels.

Other clicks, general typing, hotkeys, clipboard access, window closing and file mutations require single-action approval. This covers email send buttons, Enter-to-submit, shortcuts and ambiguous visual actions. Opening a website or allowlisted app, minimizing/maximizing/switching windows, and the narrowly defined navigation tools run without approval. Global stop: Ctrl+Shift+Escape. Moving the pointer to a corner triggers PyAutoGUI's fail-safe.

Approval is single-use and expires in 60 seconds. Denial cancels the rest of the plan. JARVIS hides its own window before physical input; the previously focused application receives the input. Verify the target before approving. A changed browser layout can invalidate coordinates. This release does not guarantee foreground-window identity. The planner can observe again through a guarded tool loop, but model-driven visual workflows still require user oversight.

Filesystem tools operate only below a user-selected root. Root operations, traversal, symlink escapes and overwriting destinations are rejected. Deletion uses the Windows Recycle Bin. Permanent deletion is unavailable. Filesystem links can still change between validation and operation; do not authorize tasks in directories controlled by untrusted software.

PowerShell is restricted to three read-only commands. Administrator elevation, registry edits, security configuration changes, installers and arbitrary executable launch are unavailable. Opening document files can invoke external applications: approve only trusted files.

Mock mode is enabled by default. Permissions are still enforced in mock mode. Screen reading and system telemetry are real when enabled; mock mode prevents PC input and file mutations, not observation.

Screenshots stay in process memory and are sent only to the configured loopback Ollama service. Local models and local Kokoro/Piper or Windows TTS voices are used. The optional Whisper wake phrase records short chunks while enabled. Audio chunks are deleted after transcription. Turning off microphone privacy stops recording; disabling vision prevents new captures. Previously displayed previews remain until app exit.

Logs contain tool names, fixed risk levels, timestamps and status only. They intentionally omit recognized speech, user commands, model content, arguments, clipboard text and paths. Persisted task history contains tool names and status; user prompts, tool arguments and tool results are excluded. Task history retains the most recent 100 tasks. Explicit memory and history are unencrypted and protected by normal Windows account permissions. Do not put passwords or financial data in commands or memories.
