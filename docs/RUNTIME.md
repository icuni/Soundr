# Soundr M1 runtime

Implemented by [ADR-004](decisions/ADR-004-local-workstation-and-shared-operations.md), 16 October 2026.

## Boundaries

~~~mermaid
flowchart LR
  Script[Screenwritr snapshot] --> Adapter[Validated snapshot adapters]
  Boards[Storytellr snapshot] --> Adapter
  Picture[Animatic or Blender render] --> Import[Verified immutable media import]
  UI[Soundr browser UI] --> Service[Local operation service]
  MCP[Official stdio MCP bridge] --> Service
  Adapter --> Service
  Import --> Service
  Service --> Store[Versioned project store]
  Store --> Worker[Deterministic render worker]
  Worker --> Playback[Prepared float PCM playback]
  Worker --> Delivery[Master and D/M/E WAVs + receipt]
~~~

UI and MCP call one localhost service. The MCP process does not write projects itself. The launcher locks its data root to one server. REAPER, an AI service and sibling processes are not required.

| Module | Responsibility |
|---|---|
| `core/model.mjs` | Strict shapes and semantic validation |
| `core/commands.mjs` | Shared atomic command vocabulary |
| `core/store.mjs` | Revisions, durable receipts, history, snapshots and recovery |
| `core/adapters.mjs` | Supplied story snapshots, stable IDs and provenance |
| `core/time.mjs` | Exact rational frame/sample conversion |
| `core/reconform.mjs` | Pure shot-map planner and explicit resolutions |
| `core/wav.mjs`, `core/dsp.mjs` | Decode, deterministic signal evaluation and WAV writing |
| `server/service.mjs` | Operations shared by UI and MCP |
| `server/renderer.mjs`, `render-worker.mjs` | Serialized bounded jobs and frozen inputs |
| `ui/transport.mjs` | Output audio clock, picture sync and native frame observations |
| `mcp/stdio.mjs` | Official MCP transport; protocol-only stdout |

## Session model

Original recordings enter a content-addressed store. Their SHA-256 identities survive edits, takes and save/reopen. BWF TimeReference is retained as an exact decimal string; it does not automatically determine placement.

Clips reference source sample ranges. Splits retain offsets into the original fade envelope, preserving sound even when splitting inside a fade. Trims establish new editable bounds. Enabled overlaps mix; take groups play their selected take. Parked clips and unselected performances remain available.

Clips have stable Soundr IDs and linkable story-project, scene, shot, character and line IDs. Upstream application/project/entity/revision references remain separate from names. Uncertain speakers stay unassigned. Cue ranges follow the selected performance, including split segments, and cue-relative automation follows those ranges.

The initial surface has four category tracks and four buses. Ambience remains separate and routes into effects for delivery. Routes form a validated DAG. Built-in gain/high-pass processing and automation use native units and stored processor order.

## Timing

The timeline uses integer samples at 48 kHz. Frame rates are rational pairs. Convert **absolute** frame positions using BigInt and nearest-sample rounding, with half-sample ties away from zero. Never accumulate rounded frame durations.

Picture records distinguish source-in frame, timeline-start sample, frame count, rational rate, cut ID and hash. FFprobe checks every frame timestamp. Undeclared cadence, VFR, unsupported codecs, nonzero container timestamps and overlong proxies are rejected.

The authoritative BWF sample origin and non-drop-frame display label are explicit. The label is not a drop-frame clock. Export origin is project origin plus requested start sample. Master and stems share sample count and origin.

The browser plays a prepared float32 master from the delivery evaluator. Picture follows AudioContext output timestamps; native video-frame callbacks measure software presentation residuals. Edits require a new prepared mix. This is not a low-latency capture or live-plugin engine. Software observations do not calibrate the physical speaker/display path.

## Persistence and retries

An envelope requires `projectId`, `expectedRevision`, `requestId` and validated commands. A batch commits completely or leaves the project unchanged. Identical retries return a persisted receipt; different arguments under the same ID fail. Stale revisions fail explicitly.

Project, receipts and history commit together through a flushed temporary file and atomic rename. A previous valid checkpoint is retained. Recovery preserves the damaged file and reports the fallback. Immutable version snapshots are flushed before publication. Undo/redo and restore create new revisions. M1 retains 100 undo entries and bounds ordinary receipts to 10,000.

Back up the complete data root with the server stopped to retain media and versions together. Runtime JSON is local application state; portable project packaging and media relinking remain future work.

## Picture revisions

Initial adoption is explicit. A higher-quality same-cut render must match cut ID, rate, frame count and offsets. Changed timing requires a reviewed plan.

The planner uses stable shot IDs and moves sound without stretching it. Spanning, shortened, removed and affected unattached sounds require choices. Affected absolute automation is flagged; cue-relative automation follows its cue. Removed shot IDs remain as tombstones.

Preview and audition do not mutate the session. Apply requires the original project hash/revision, a current plan and every resolution. It is one undoable edit. Plans are in memory; preview again after restart.

## Delivery

A job freezes the project before queueing and verifies required source/picture hashes. Missing/changed media, unsupported processing and resource limits produce explicit failures. Preparation failures also receive terminal status.

Default output is master, dialogue, music and effects: stereo 48 kHz PCM24 BWF. Ambience joins effects. D/M/E tap after category processing and before master processing. Master-only gain/processing can intentionally prevent a stem sum from matching the master; the tested neutral-master graph sums within quantization tolerance.

Normalization and dither are off. Tails end at the declared range. Receipts record range, origin, picture/hash, required assets, included clip ranges, omissions, graph identity, output hashes and measured sample peak/RMS/clipping. Integrated LUFS and true peak remain unmeasured. Completion is not editorial approval.

Files are staged and become downloadable only on completion. Committed jobs can resume at startup. Internal playback uses an authenticated extensionless binary API, avoiding download-manager interception of WAV URLs. Delivery links remain ordinary downloads.


## Picture-format coverage

CFR H.264 MP4 is the verified M1 picture route. WebM import remains experimental: the current strict timestamp check can reject coarse container timebases. Quantization-aware WebM validation is deferred.
