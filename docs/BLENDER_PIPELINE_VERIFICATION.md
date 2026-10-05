# Blender pipeline verification — October 5, 2026

**Blender is now the primary backend. General automatic visual-quality acceptance has NOT passed.** Working tools and valid exports are separate from good AI geometry. TRELLIS remains disabled and optional; nothing was force-installed to run it.

## Installed implementation

JARVIS 0.7.0 uses a structured design specification, researched image references and their actual visual analysis, then BLOCKOUT → STRUCTURE → DETAIL → MATERIAL → POLISH → three-angle RENDER → scored visual REVIEW → bounded REVISION. ULTRA has two detail passes and up to three review rounds. QUICK, STANDARD, HIGH and ULTRA use distinct reference/sample/resolution/revision budgets. HIGH/ULTRA require multiple useful references, overall/recognizability/intent scores of 8/8.5 respectively, every category at least 7, and no missing defining features.

Recognition features and decomposition come from the user's goal and the model, without production recipes for GPUs, pucks, helmets, lamps, watches, furniture or speakers. Actual scene inventory/bounds, local/world transforms and supporting surfaces guide placement. Corrections receive rendered images directly. Complex spatial plans enable the provider's reasoning mode. Vision planning/review starts with a larger output allowance after actual 4,096-token responses returned only reasoning or incomplete content.

Resuming completed modeling begins with visual review rather than speculative remodeling. Complete historical reviewed checkpoints are ranked by the weakest of overall, recognizability and user intent; the best complete .blend/GLB is restored when another correction fails or scores worse. Revisions and attempted exports remain on disk. Format/service failures cannot turn an unreviewed export into a quality approval. Independently valid partial operations may be retained with warnings; partial replacement plans cannot discard existing geometry.

## Real tools and hardware

Blender 4.5.14 LTS ran on the actual RTX 4060 using OptiX GPU rendering, with CPU fallback when insufficient VRAM was available. Detected GPU memory: **8,188 MiB**; system RAM approximately **15.85 GiB**. No benchmark or performance guarantee is implied.

Real trusted-worker checks generated BLEND, GLB, STL and three PNG views using Bezier curves, revolved profiles, hierarchy/world transforms, mirror, radial copies, linear arrays, alignment, inset, UV projection, bounded geometry nodes, procedural text and PBR/procedural material nodes. A chained 4×3 array followed by Boolean produced the expected 96 vertices with no duplicated residual modifiers. Unused materials survived separate Blender processes and could be assigned later. Packed GLB retained baked procedural color/normal textures. Construction cutters remained editable in BLEND while excluded from visible exports. Large STUDIO staging did not alter object framing or GLB bounds.

Reverse inspection views temporarily hide staging that intersects the camera-to-object line, so a ground plane cannot cover the entire rear view. The assisted GPU's actual rear render verified this, while its main view retained the floor.

The worker executes declarative, schema-validated operations only, with auto-execution disabled and owned-path validation. It accepts no arbitrary AI Python. Exporting outside the owned artifact store and destructive/consequential actions retain confirmations. Exact text is converted Blender geometry and is verified through original/applied-cutter provenance. STL export does not imply manifold, printable or manufacturing-certified geometry.

## Unrelated automatic generation tests

The same production design/research/stage/review architecture was exercised for all seven requested subjects and a bonus clock. These are **actual failures or unapproved results**, not renamed passes. Earlier attempts exposed invalid model JSON, mixed geometry axes/scales, lost unused materials, array/Boolean duplication, dense overlapping arrays and incomplete replacement plans. The code fixes are generic. Final improvements to reasoning, image-grounded revisions and best-checkpoint recovery were not followed by another exhaustive run of every subject.

| Subject                    | Latest mode                              | Real artifacts / Library                     | Actual visual result                                                                                                                                                      |
| -------------------------- | ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Futuristic GPU, autonomous | ULTRA                                    | BLEND/GLB/STL/three PNGs; saved and reopened | Best reviewed overall **4.5/10**, unapproved; 2 correction passes / 3 scored rounds. Subsequent resume hit provider timeout; best actual historical checkpoint recovered. |
| Hockey puck                | STANDARD                                 | BLEND/GLB/three PNGs; saved/reopened         | Overall **3/10**, unapproved                                                                                                                                              |
| Desk lamp                  | QUICK after earlier failed STANDARD run  | No completed final artifact                  | Provider returned a two-element primitive dimensions vector after repair; validation rejected it.                                                                         |
| Sci-fi helmet              | QUICK after failed STANDARD blockout run | BLEND/GLB/three PNGs; saved/reopened         | Visual reviewer timed out; **unreviewed and unapproved**, no invented score                                                                                               |
| Mechanical watch           | STANDARD                                 | BLEND/GLB/three PNGs; saved/reopened         | Overall **2.5/10**, unapproved                                                                                                                                            |
| Chair                      | STANDARD                                 | BLEND/GLB/three PNGs; saved/reopened         | Final review **0/10**, blank/failed result. This run preceded the best-reviewed-version safeguard.                                                                        |
| Speaker                    | STANDARD                                 | BLEND/GLB/three PNGs; saved/reopened         | Overall **3/10**, unapproved                                                                                                                                              |
| Mechanical desk clock      | STANDARD                                 | Incomplete                                   | Provider/structured-planning timeout; no final quality score                                                                                                              |

### Recorded category scores (0–10)

| Subject                              | Recognition | Silhouette | Proportions | Geometry | Detail | Materials | Lighting | Composition | Intent | Overall |
| ------------------------------------ | ----------- | ---------- | ----------- | -------- | ------ | --------- | -------- | ----------- | ------ | ------- |
| Autonomous GPU, retained revision 10 | 4           | 3          | 5           | 6        | 2      | 5         | 7        | 6           | 4      | 4.5     |
| Puck                                 | 4           | 4          | 6           | 3        | 1      | 2         | 2        | 3           | 2      | 3       |
| Watch                                | 3.5         | 4          | 2.5         | 2        | 1      | 3         | 4        | 4           | 2.5    | 2.5     |
| Chair, before preservation fix       | 0           | 0          | 0           | 0        | 0      | 0         | 0        | 0           | 0      | 0       |
| Speaker                              | 3           | 3          | 3           | 3        | 2      | 3         | 2        | 4           | 3      | 3       |

The autonomous GPU remained a slab with incorrect fan orientation, buried/missing components and stray rods. Review first scored it 3.5, then 4.5, then 1.8; the actual better revision was retained instead of accepting the last one. Several early reviews used local vision when NVIDIA Kimi was rate-limited; the third used real Kimi K3. Neither a successful export nor a model's praise overrides the strict quality thresholds.

## Additional assisted original GPU artifact

To leave a useful example, Codex authored a separate original design through the same public general Blender tools. **This is an assisted artifact, not evidence that JARVIS's automatic planner achieved ULTRA.** Its decomposition used the researched modern-card silhouette, fan/shroud proportions, fin stack, PCB, contacts, I/O bracket and power connector; no RTX 4060 geometry or branding was copied. The prior automatically proposed three 92 mm fans in a 265 mm length were inconsistent; the assisted design uses a coherent longer proportion instead.

BLOCKOUT, STRUCTURE, DETAIL, MATERIAL/POLISH and RENDER were separate actual Blender processes. The resulting model has three true recessed 11-blade assemblies, chamfered shroud, metal surrounds, layered cooler and board, slotted bracket, electrical contacts, procedural surface materials and three 960×960/64-sample views.

Initial actual Kimi K3 review of all three images scored **7/10 overall**, with recognition 8.5, silhouette 8, proportions 8, geometry 7, detail 6.5, materials 6.5, lighting 5.5, composition 6 and intent 7.5. It found crushed blacks on the backplate, unreadable vents/texture, generic ports, a floating studio pose and insufficient material/detail refinement. An automatic correction request timed out. Codex then used the same tools for a corrective pass: rear fill light, real two-sided ventilation slots and rear fasteners. The new rear image visibly exposes the backplate texture/vents, and side ventilation is readable. The carbon preset remains an approximation; port contours, fan shaping and studio placement still need refinement.

**Assisted correction count: 1.** Two critique rounds were attempted; only the first returned a complete score. The final cloud recheck timed out and local fallback also timed out. Final revision 7 is therefore **unreviewed/unapproved for ULTRA**. The last actual automated score is the earlier revision-5 result (7/10); it must not be attributed to the corrected revision. Codex directly inspected all three corrected PNGs and confirmed the lighting/vent fixes, with remaining defects recorded above. No replacement scores were invented.

| Last completed assisted review, revision 5 | Recognition | Silhouette | Proportions | Geometry | Detail | Materials | Lighting | Composition | Intent | Overall |
| ------------------------------------------ | ----------- | ---------- | ----------- | -------- | ------ | --------- | -------- | ----------- | ------ | ------- |
| Kimi K3, actual three-image input          | 8.5         | 8          | 8           | 7        | 6.5    | 6.5       | 5.5      | 6           | 7.5    | 7       |

Final assisted artifact folder: `C:\Users\Giorg\AppData\Roaming\jarvis\3D\1cc6330a-3521-4673-ab3f-1339bfb8e328\revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993`. Files exist and the final GLB reopened in the installed JARVIS preview with a real `loaded:true` acknowledgement. Library ID: `b9de4dd5-ee1c-4fbd-818c-926342dd7342`.

- [scene.blend](C:/Users/Giorg/AppData/Roaming/jarvis/3D/1cc6330a-3521-4673-ab3f-1339bfb8e328/revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993/scene.blend)
- [model.glb](C:/Users/Giorg/AppData/Roaming/jarvis/3D/1cc6330a-3521-4673-ab3f-1339bfb8e328/revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993/model.glb)
- [model.stl](C:/Users/Giorg/AppData/Roaming/jarvis/3D/1cc6330a-3521-4673-ab3f-1339bfb8e328/revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993/model.stl)
- [render.png](C:/Users/Giorg/AppData/Roaming/jarvis/3D/1cc6330a-3521-4673-ab3f-1339bfb8e328/revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993/render.png)
- [render-side.png](C:/Users/Giorg/AppData/Roaming/jarvis/3D/1cc6330a-3521-4673-ab3f-1339bfb8e328/revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993/render-side.png)
- [render-back.png](C:/Users/Giorg/AppData/Roaming/jarvis/3D/1cc6330a-3521-4673-ab3f-1339bfb8e328/revision-7-90d6bea7-fa08-48c1-a597-c46be96f2993/render-back.png)

The separate autonomous GPU checkpoint remains under `%APPDATA%\jarvis\3D\32f5235a-b672-4482-a978-e604a48b0901\revision-10-971063b4-7602-4db4-9206-919f2845d7c6` with its actual 4.5/10 review.

Full design spec, references, stage records and actual review history are stored alongside the final project in `design-review.json`. Normalized illustrative scene coordinates are used; these artifacts are not dimensionally certified manufacturing models.

## Release checks and limitations

- **284 JavaScript tests passed**; TypeScript, ESLint and production build passed. Tests include actual preservation/cancellation/routing cases rather than treating image quality as a unit-test pass.
- Packaging verified version 0.7.0 metadata and 98 bundled application files. The installer was applied to the existing JARVIS installation. Voice/provider/privacy preferences were restored; secrets remain encrypted outside Git.
- Working saved model assets were reopened through a fresh Library/service instance. The earlier nine-card GPU workspace's missing Library entry was recovered from its prior acceptance snapshot; its original BLEND/GLB assets remain intact.
- Actual installed preview acknowledgement: `loaded:true` for final asset `8510e95e-d627-4d5b-9e56-cbddd61adabc`. A paused background entrance animation initially made the card invisible despite loaded geometry; the installed fix displays background cards statically. Installed archive SHA-256: `f06289081b5e0eddec8bfede3c8044839d39249f79e15f77e47e2ec34a3a52e3`.
- NVIDIA's former JARVIS 300/day and session caps are removed. Real authentication, model availability, rate limits, server errors, timeouts, malformed responses, capability and privacy rules still cause visible fallback. Gemini's separate configurable local safety budget is preserved.
- TRELLIS local inference, warmup and real text/image mesh generation were **not** performed. Optional adapter/variant contracts were fixture-tested only. This hardware did not meet the accepted 12 GB VRAM / 32 GB RAM requirements; Docker/toolkit/distribution installation was not forced.
- Free hosted model reliability and the planner's geometry quality remain major limits. The seven-subject automatic quality test has not passed. There is no claim that arbitrary future objects will meet HIGH/ULTRA or that everything is 100% working.
- Windows reported no available physical microphone during these checks; physical hands-free speech and barge-in remain manual tests with a connected microphone. Existing Kokoro British male voice settings were preserved.
