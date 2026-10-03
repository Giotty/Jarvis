# Greeting and voice repair — 0.5.1

The three failed greetings in the owner's audit were immediate `fetch failed` errors, not model reasoning timeouts. Ollama was installed but no server process was running. Direct executable launch bypassed the helper launcher that normally starts Ollama.

JARVIS now starts the already installed default loopback Ollama service on a refused connection and retries the request once. Concurrent requests share startup, cancellation remains responsive, and remote/custom endpoints, missing binaries, HTTP errors and model generation timeouts do not launch/restart software. No administrator command or installation is involved.

The owner voice is now Kokoro `bm_daniel`, a free local British male voice. Neural synthesis reports its actual engine/voice; playback verifies these against the selected settings. Settings update the playback reference immediately and cancel old audio on a voice change. Windows speech selects a known local English male voice instead of the first available voice, and reports absence instead of silently choosing a female voice. This is a Jarvis-style voice, not a clone of the film actor.

Verification: 183 regression tests passed; lint, TypeScript and build passed. A deliberate shutdown of the service was recovered automatically without the helper launcher. The real agent completed 'Hey Jarvis' and a follow-up greeting: the cold first request took about 17 seconds, while the warm follow-up took about 0.9 seconds. Actual Kokoro synthesis returned `bm_daniel` audio in about 3.3 seconds including fresh worker initialization. Release smoke checks use an isolated profile to exercise the packaged command IPC and neural synthesis, without changing owner library data. Safety permissions and provider choice remain unchanged.

Launch using `Launch-JARVIS.cmd` or `release-final/win-unpacked/JARVIS.exe`; both now support recovery. Installer: `release-final/JARVIS Setup 0.5.1.exe`. Cold model initialization still takes time; microphone acoustics were not re-tested by these typed greeting checks.
