# ADR-004: a local workstation with shared operations

Status: accepted for bounded M1, 16 October 2026. Resolves ADR-003's open implementation-spike choice for this milestone.

## Decision

Build an independent Node 22 localhost service, browser editing surface, validated headless core and official stdio MCP bridge. Keep one writer per data root. UI and MCP use identical operations.

Use one deterministic worker evaluator for prepared playback and offline export. A frozen graph determines both. Restrict M1 to 48 kHz mono/stereo WAV and verified CFR picture; preserve rational rates and explicit offsets.

Store content-addressed media, flushed atomic checkpoints/receipts, immutable project versions and bounded undo history. Freeze render requests before worker execution.

Bring explicit-map reconform into M1 as requested. Preview/audition remain read-only; conflicts require choices, stale plans fail and application is one undoable edit.

## Evidence and tradeoffs

The generated 75-second scene, reviewed 80-second revision and fractional-offset fixture exercise actual media, UI/MCP edits, reopen, playback and rendered files. Independent FFmpeg/FFprobe measurements supplement internal timing. See [M1 evidence](../MILESTONE_1.md).

Preparation adds delay and does not provide native low-latency recording. This proves editing, timing and delivery contracts without a proprietary DAW. Capture/ADR, live processing and larger-session performance remain separate milestones.

Orama is the suite's working name. Existing Orchestra, Screenwritr, Storytellr and Blender ownership boundaries remain intact. Snapshot adapters are implemented; live bridges need counterpart contracts.

## Alternatives deferred

- Native C++/Rust real-time engine: benchmark the same saved workload before replacement.
- Electron: optional desktop packaging after workstation acceptance.
- REAPER as a mandatory playback/render dependency: not adopted.
- Ardour implementation reuse: not used; its public architecture informed research.

Engineering checks do not establish production readiness, empirical parity across reference apps, physical A/V calibration or human editorial acceptance.

