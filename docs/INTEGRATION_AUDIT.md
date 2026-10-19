# Orama Soundr: audit before implementation

16 October 2026. This records the observed starting point before Soundr runtime code was added. Orama is the user's working suite name; Soundr remains an independent film-audio workstation. Existing sibling repositories are read-only in this task.

| Requirement | Already exists | Needs extending | Missing in Soundr at audit |
|---|---|---|---|
| Story identity | Screenwritr exports versioned `org.icuni.story-graph` snapshots, opaque story/scene/block/entity IDs and source URIs | Dialogue-block-to-character resolution must preserve explicit cue relationships; inferred links need review. Storytellr board/scene IDs need explicit cross-app mappings | Runtime story import, cue queries, stable audio attachments |
| Editable sessions | Soundr v0.1 research model separates sources, clips, takes, tracks, buses and envelopes | Add suite/story metadata, working persistence and version history | Editing, undo/redo, take selection, signal evaluation |
| Picture timing | Storytellr v2 stores board durations, media placements and source-in offsets in frames | Its `fps: number` needs an explicit rational handoff; audio sample rate/origin and picture-cut identity must be added to Soundr's boundary | Audio-clock transport, picture import/verification, synchronized render ranges |
| Versioned handoffs | Screenwritr snapshot identity/timestamp; Storytellr revisioned service and hashed media assets | Retain source app/project/entity/revision separately from Soundr IDs; freeze picture and asset hashes | Immutable picture revisions, reopenable edit snapshots, delivery manifests |
| Reviewable picture changes | Proposed Soundr reconform rules; Storytellr atomic revisioned commands | Implement an explicit shot map, spanning/truncated/deleted-sound conflicts, preview/resolutions/undo | Working reconform planner and review UI |
| Film mixing/delivery | Storytellr media clips already have simple gain/fades | Dedicated Soundr routing, clip gain versus mix automation and ambience control | DSP, full mix, D/M/E stems, repeatability checks |
| MCP | Screenwritr has read-only, sharing-controlled MCP. Storytellr documents shared UI/MCP mutation semantics. Orchestra has a bounded sibling envelope, with counterpart adoption pending | Soundr needs its own transport and command service; existing sibling tools do not automatically grant write access or integration | Soundr tools, retries, atomic edits, clear receipts |

## Source evidence

- `Screenwritr/lib/family-contract.mjs`: `CREATIVE_FAMILY_MANIFEST`, `sourceReference`, `createStoryGraph`; characters/scenes/blocks and explicit/candidate relationships are distinct. Existing manifest lists downstream integrations as planned.
- `Screenwritr/docs/mcp.md`: read-only active-story interface; sharing/revocation and `expectedStoryId`. Soundr must not bypass those grants or read private live sessions.
- `Storytellr/src/engine/types.ts`: `Project.schemaVersion=2`, numeric fps, stable scene/board/media IDs, frame ranges/source-in, content hashes, simple gain/fades. A board is the current shot-like timeline unit; do not invent a native dialogue-line link.
- `Storytellr/docs/decisions/ADR-002-shared-editor-and-mcp.md`: one revisioned service, atomic validated command batches, expected revision/request IDs, content-addressed media and snapshot render jobs. Source documentation is not fresh runtime proof.
- `Orchestra/docs/decisions/ADR-029-typed-sibling-conversation-envelope.md`: bounded envelope and receipt correlation; counterpart adoption explicitly pending. It is not an existing Soundr bridge.
- Soundr contained only research/specification/schema/example/acceptance artifacts, with all audio/runtime scenarios marked NOT RUN. It was not a Git checkout.

## Implementation scope accepted from the latest request

Build a standalone local browser workstation backed by a headless Node command/persistence/render service and local stdio MCP. REAPER is a functional reference and is never launched or required. Use one deterministic DSP evaluator for playback preparation and final renders, keeping heavy work off the UI thread. This first engine is a bounded short-scene implementation, not a native low-latency recording engine.

The latest request brings basic reviewed picture-change handling into M1. Build it with explicit cut maps and director-resolved conflicts; automatic EDL matching, time stretching, plugin hosting and immersive mixing remain later work.

Import existing Screenwritr story-graph and Storytellr project snapshots through validated adapters. Preserve IDs and provenance; do not modify either sibling. A finished Blender movie is an explicitly imported, hashed picture revision. Live two-way app bridges and a Blender exporter are missing and remain separate integration work.

Verification will use generated, clearly labelled media plus UI/MCP and output checks. A generated scene cannot establish human voice-performance quality, the user's real project integration or physical speaker/display calibration.


## M1 outcome

The pre-implementation inventory above is preserved. Soundr now implements the missing local editing, persistence, timing, rendering, cue-query and MCP capabilities, plus explicit-map reviewed reconform and snapshot adapters. [MILESTONE_1.md](MILESTONE_1.md) records executed evidence.

The integration extensions still required are live sharing-aware Screenwritr/Storytellr exchange, rational timing/origin and asset-version handoffs from peers, a Blender exporter and portable project packaging. Existing sibling code remains unchanged.
