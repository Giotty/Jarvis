# NVIDIA routing, local specialists and Blender — 0.6.0

## Observed hosted capabilities

Authenticated, small free development requests were made to `https://integrate.api.nvidia.com/v1`. Names/catalog entries are not capability proof. One encrypted owner key serves all hosted NVIDIA models. Probes and latency/compatibility settings persist in the private app profile, expire after seven days and can be refreshed/cancelled in Settings → AI. No secret is returned through renderer IPC or committed.

| Model                                 | Assigned role                                        | Actually observed in this account                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| moonshotai/kimi-k3                    | General and available requested vision fallback      | Text, streaming, structured JSON, image interpretation, reasoning. Streaming with maximum reasoning was needed for usable replies. Native tool calls did not pass. |
| nvidia/nemotron-3.5-lightning-30b-a3b | Fast classification, native tools and CAD correction | Text, streaming, tools including actual result continuation, structured JSON, reasoning. No vision proof.                                                          |
| nvidia/nemotron-3-ultra-550b-a55b     | Difficult reasoning/escalation                       | Text, streaming, tools, structured JSON, reasoning. No vision proof.                                                                                               |
| deepseek-ai/deepseek-v4.1-flash       | Configured vision specialist                         | Catalog available, but empty/timed-out responses prevented usable capability proof. Not selected as a working vision route.                                        |
| meta/muse-glimmer-30b                 | Compatible fallback                                  | Text, streaming, tools. Vision/structured output unproven.                                                                                                         |
| z-ai/glm-5.3-flash                    | Disabled candidate                                   | Free development access not established; no request was made.                                                                                                      |

Official catalog evidence: [Kimi](https://build.nvidia.com/moonshotai/kimi-k3), [Lightning](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b), [Ultra](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b), [DeepSeek](https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash), [Muse](https://build.nvidia.com/meta/muse-glimmer-30b). Availability and provider free quotas can change.

## Router and budgets

A validated TaskProfile represents modality, complexity, latency, temporal scope, vision/tools/research/computer control/structured output/OCR/documents/spatial reasoning, privacy and confidence. Host facts override inferred privacy. Failures and observed capabilities decide compatible fallback, rather than matching command phrases. Auto normally tries Kimi for general/complex requests, Lightning for fast requests, Ultra for escalation and DeepSeek/Kimi for requested images. Kimi is skipped when native tools are necessary; its vision findings can feed a tool-capable planner. Configurable modes also allow speed, quality, forced model, local-only, privacy and free cloud/local.

The owner's configured order is NVIDIA → Gemini → Ollama, with Ollama offline fallback. The older chat-exposed Gemini credential was removed under the compromised-key rule, so Gemini is currently skipped; optionally saving a fresh key enables that preserved adapter again. Missing/invalid credentials, unavailable capabilities, timeouts, cooldowns, circuit breakers and own request caps prevent unsuitable calls. NVIDIA is pinned to the development URL and verified free catalog; OpenAI/Claude and Google paid grounding are blocked in free mode. Research keeps using free background web tools.

Gemini's own budget defaults to **100/day**, is configurable, warns at 80%, stops Gemini calls at 100% and resets at local midnight. NVIDIA has a separate budget with the same default/behavior; the owner was configured to **300/day during setup and acceptance checks**. These are JARVIS safety budgets, not vendor remaining quota. Attempts include classification, probes, retries and model cooperation, so one user command can use several requests. Concurrent NVIDIA reservations use a file lock and fail closed on corrupt/unwritable storage. Previously loaded diagnostic instances predated this locking fix; their historical count is not an audited vendor ledger.

Default cloud screen access is off. The owner had explicitly enabled requested cloud vision; files/clipboard/private memory remain disabled for cloud. Continuous screen sampling/context remains local. No continuous screenshot upload, paid endpoint, paid resource or account/billing signup was performed.

## Local compatibility

Detected: RTX 4060 **8,188 MiB VRAM**, approximately **15.85 GiB RAM**, NVIDIA driver **596.36**, about **302 GB C:** and **27 GB D:** free at setup. Docker was unavailable. Heavy local NIM installations were not attempted.

| Requested local NIM   | Result on this PC                                                                           | Working alternative                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| cosmos3-nano-reasoner | No validated compatible local deployment; official Nano 16B matrix targets much larger GPUs | Observed hosted Kimi vision, requested visible information only                                     |
| nemotron-3-embed-1b   | No validated local NIM deployment/Docker                                                    | Ollama all-minilm:l6-v2, 384-dimensional CPU embeddings and SQLite                                  |
| nemotron-ocr-v2       | NIM hardware/container prerequisites not met                                                | Accessibility text and requested vision; optional loopback OCR interface                            |
| nemotron-parse-v2.0   | Exact local 2.0 deployment requirements/contract not established; not installed             | Local PyMuPDF text/tables and bounded pagination; optional configured local vision-parser interface |

Evidence: [Cosmos matrix](https://docs.nvidia.com/cosmos/latest/cosmos3/model_matrix.html), [OCR support](https://docs.nvidia.com/nim/ingestion/image-ocr/latest/support-matrix.html), [embedding support](https://docs.nvidia.com/nim/nemo-retriever/embedding/latest/support-matrix.html), [LLM NIM matrix](https://docs.nvidia.com/nim/large-language-models/2.0.13/reference/support-matrix.html). No claim is made that a smaller unofficial quantization cannot run; these requested NIMs were not validated for this machine. Local endpoints stay disabled until the user has a compatible deployment.

Installed [all-minilm:l6-v2](https://ollama.com/library/all-minilm:l6-v2), approximately 46 MB, uses the [Ollama embedding API](https://docs.ollama.com/api/embed). Saved research text and explicit memory have local vectors/content fingerprints; deletion/edit invalidates cached vectors. Text is bounded, not a comprehensive full-drive semantic index. [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/recipes-text.html) 1.26.7 extracts selected PDF/XPS/EPUB text/tables locally. Scanned documents report their OCR requirement rather than invented text.

## Blender and preview

Official **Blender 4.5.14 LTS** portable Windows distribution was downloaded from Blender's official release server, SHA-256 verified and installed under `.tools/blender-4.5.14-windows-x64`. The owner configuration contains its executable path; detection also searches ordinary installed paths. This portable tool is deliberately not bundled in the Electron installer.

The host accepts strictly bounded primitives, custom meshes, transforms, modifiers/bevel, booleans, extrusion, converted text, materials, lights, cameras, rendering and exports. It runs only the trusted worker with Blender auto-execution disabled, never arbitrary model-generated Python. Small CPU Cycles jobs use two threads/16 samples, bounded geometry and deadlines. Projects/revisions live under `%APPDATA%\jarvis\3D`; cancellation does not replace the last completed revision. Exporting outside that owned store or overwriting existing work requires confirmation.

Actual BLEND/PNG/GLB/GLTF/OBJ/STL/FBX output was generated. GLTF is a separate-resource export; GLB is the portable in-app format. Finite asset-ID IPC validates GLB size/header/internal references before Three.js loads it. Orbit/zoom/pan/reset/focus, save/reopen and hidden/unfocused/high-load throttling are implemented. The optional generative 3D provider interface stays disabled and is not required for Blender.

Actual AI planning created a puck, and a follow-up widened/engraved the same project through successive revisions. A render-review response identified problems; a corrective pass could not always complete because hosted vision/structured output was unavailable. The last real revision is kept with explicit quality findings. The engraved example has nonmanifold geometry and imperfect appearance: it is **not validated for printing**. Units/dimensions and manifold observations are available to review, but exporting STL does not repair arbitrary AI geometry automatically.

## Practical limitations

Free hosted latency/rate limits, incomplete accessibility, blocked/JavaScript/login web pages and semantic model mistakes remain. Real Canadiens research retrieved sources/images and created a workspace, but historical sources and incomplete analysis occurred; temporal guards reduce drift without proving today's line combination. No physical microphone was available in Windows. Local voice generation was checked; physical hands-free/barge-in still requires a connected/enabled microphone. The installer is unsigned and depends on the configured local Python/models/Blender on this PC.
