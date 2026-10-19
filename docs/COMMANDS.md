# Shared UI and MCP command contract

> Historical M0/v0.1 design. Current M1 behavior is documented in [RUNTIME.md](RUNTIME.md), [MCP.md](MCP.md) and [MILESTONE_1.md](MILESTONE_1.md). The original example/schema is not a runtime v2 project.


Status: proposed v0.1 interface. No MCP tools or command runtime have been installed. The table defines operations to implement, not available live tools.

## Envelope and result

```json
{
  "apiVersion": "0.1",
  "projectId": "soundr-scene-75s",
  "expectedRevision": 0,
  "requestId": "move-footstep-001",
  "command": "clip.move",
  "params": {"clipIds": ["clip-footstep"], "deltaSamples": 2000}
}
```

Validate a command-specific discriminated schema before dispatch. Reject unknown fields, nonfinite/unsafe numeric values, unresolved IDs and oversized inputs. Query operations take a read revision and pagination; mutations require `expectedRevision` and `requestId`. Namespaced external text is data, never executable instructions.

Return one result shape:

```json
{
  "ok": true,
  "requestId": "move-footstep-001",
  "projectId": "soundr-scene-75s",
  "revisionBefore": 0,
  "revisionAfter": 1,
  "receiptId": "receipt-example-only",
  "changedIds": ["clip-footstep"],
  "warnings": [],
  "durability": "committed"
}
```

This is illustrative. A real success receipt cannot claim `committed` before state/revision/idempotency are durably committed. Read-only preview results instead identify the base revision, plan hash, affected entities and conflicts.

Errors use `{ "ok": false, "requestId": "...", "error": { "code": "REVISION_CONFLICT", "message": "...", "details": { "currentRevision": 1 } } }`. Stable codes include `VALIDATION_ERROR`, `NOT_FOUND`, `REVISION_CONFLICT`, `REQUEST_ID_CONFLICT`, `MEDIA_UNAVAILABLE`, `UNSUPPORTED_OPERATION`, `ROUTING_CYCLE`, `PLAN_STALE`, `UNRESOLVED_CONFLICTS`, `OUTPUT_EXISTS`, `IO_ERROR` and `CANCELLED`. Do not expose credentials or internal stack traces.

## Planned operations

| Operation | Inputs / effect | Key rule |
|---|---|---|
| `project.inspect` | Project ID; revision and dependency diagnostics | Read-only |
| `cue.query` | Character/line/shot reference, approval status, cursor/limit | Stable ordering; return snapshot revision and stale links |
| `cue.reveal` | Cue ID | Return all candidate takes and associated clips/tracks |
| `source.import` | User-approved file handle and destination media policy | Hash/inspect outside audio callback; no original overwrite |
| `clip.add` | Source/track IDs, source range, placement, cue/anchor | Validate source bounds and target track |
| `clip.move` | Clip IDs and signed sample delta | All-or-nothing; preserve source ranges and anchor consistency |
| `clip.trim` | Clip ID, side and signed sample amount | Reject empty/out-of-range result; remap local envelopes |
| `clip.split` | Clip ID and absolute split sample | Preserve coverage; assign new right ID; return both IDs |
| `clip.fade.set` | Clip ID, side, duration and curve | Non-destructive metadata |
| `clip.gain.set` | Clip ID and gain in dB | Affects pre-track-processing clip gain only |
| `take.select` | Take-group ID and candidate ID | Preserve candidates; invalidate relevant approval |
| `route.set` | Route ID, sender/destination, tap/gain/map | Validate graph and master reachability before commit |
| `processor.set` | Owner and builtin type/version/parameters/order | No arbitrary script/plugin loading |
| `automation.set` | Target/parameter, anchor, ordered points | Validate units, range and interpolation |
| `story.move.preview` | Storytellr shot/event reference and new placement | Enumerate deduplicated changes and absolute/spanning exceptions |
| `story.move.apply` | Reviewed plan ID/hash and resolutions | Expected revision; one undo transaction |
| `reconform.preview` | Old/new picture IDs and explicit edit map | Derived read-only revision; conflicts remain visible |
| `reconform.apply` | Reviewed plan ID/hash and resolutions | No apply with stale/unresolved plan |
| `render.plan` | Frozen revision, range, outputs and policies | Dependency preflight and names/processing manifest |
| `render.enqueue` | Reviewed plan plus approved output-root handle | Creates job; does not claim completion |
| `render.status` / `render.cancel` | Job ID | Terminal receipt after finalization; cancellation preserves evidence |
| `project.save` / `project.open` | Scoped project handle | Validate schema, recover safely and report save failures |
| `history.undo` / `history.redo` | Revision and history entry | New revision; preserve sources |

## Atomicity and idempotency

The core serializes mutations for each project. Validate all command effects against one base snapshot before committing any entity. A batch that contains one invalid source range must not apply earlier edits.

Key idempotency by `(projectId, requestId)` and a canonical payload hash. Check an already committed request **before** rejecting its original expected revision: an exact retry returns its saved receipt without a second change. The same ID with different payload returns `REQUEST_ID_CONFLICT`. A new request against a stale revision returns `REVISION_CONFLICT`. Persist the idempotency result with the mutation so a lost response/restart cannot repeat the edit.

Plans include base revision, dependency identities, input picture-map hashes and the proposed change set. Any relevant edit or relink invalidates the plan. Preview cancellation changes no authoritative project data. Applying a reviewed plan is one transaction; the reviewer identity and resolutions are recorded separately from an AI suggestion.

## Natural-language examples

“Show Amenewa's unapproved lines” resolves the character's stable reference, then issues `cue.query` with non-approved statuses. “Move every sound attached to this shot” resolves the shot ID, previews all affected cue/clip/automation identities and applies that reviewed transformation. A caller must never generate a string of shell commands or an unbounded raw-document patch to accomplish either action.

## Access and file boundaries

UI and MCP use the same authorized project session and command dispatcher. The first transport is local stdio. Capability handles identify opened projects, approved media roots and export roots; a bare path from model output is insufficient. Canonical path checks must account for Windows junctions/symlinks and collision checks must use filesystem semantics. No general file deletion, arbitrary network fetch, shell execution or “evaluate script” MCP tool is part of v0.1.
