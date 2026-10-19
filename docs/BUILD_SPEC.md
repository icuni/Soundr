# Soundr requirements and milestone status

16 October 2026. Soundr is Orama's dedicated film-audio workstation. The starting inventory is preserved in [the integration audit](INTEGRATION_AUDIT.md). Current implementation and evidence are in [MILESTONE_1.md](MILESTONE_1.md).

REAPER remains the main functional reference: intact sources, composable edits, routing, automation and predictable renders. The other [primary-source studies](../research/README.md) inform film revision, delivery, architecture and later repair.

## Coverage

| ID | Behaviour | M1 status |
|---|---|---|
| SND-001 | Immutable audio import and metadata/hash | Implemented; bounded 48 kHz mono/stereo WAV |
| SND-002 | Place, move, trim, slip, split, duplicate, undo/redo | Implemented; dialogue alternatives use takes |
| SND-003 | Fades and overlapping room tone | Implemented; equal-gain/equal-power |
| SND-004 | Preserve and select alternate takes | Implemented for imported recordings |
| SND-005 | Clip gain separate from mixer automation | Implemented |
| SND-006 | Tracks, buses, routing, shared processing | Implemented with four initial category tracks/buses; custom construction deferred |
| SND-007 | Volume/effect automation | Gain and high-pass parameters implemented |
| SND-008 | Durable save/reopen | Snapshots, recovery and injected-failure checks implemented |
| SND-009 | Picture sync through playback, seeks and export | Generated-media engineering checks pass; real-scene/physical acceptance pending |
| SND-010 | Aligned master/D/M/E WAVs and receipts | Implemented; PCM24 stereo BWF, declared range, no tails |
| SND-011 | Stable story and picture identity | Project/scene/shot/character/line implemented; arbitrary event namespace later |
| SND-012 | Unapproved lines and linked takes | UI and MCP query implemented |
| SND-013 | Shared UI/MCP commands and retries | Implemented; official stdio client verified |
| SND-014 | Explicit dependency/unsupported errors | Implemented for supported media, processors and resource bounds |
| SND-015 | Recording, ADR/count-in and latency evidence | M2; not implemented |
| SND-016 | Preview, resolve, audition, apply and undo reconform | Brought into M1; explicit stable-shot maps implemented |
| SND-017 | Interchange with preservation/loss report | M3; not implemented |
| SND-018 | Traceable spectral-repair derivatives | M3; not implemented |

The [M0 scenarios](../acceptance/scenarios.json) remain an unchanged research protocol. Executed Soundr checks are separate in [acceptance/m1](../acceptance/m1/verification.json). All six reference-application scene runs remain NOT RUN.

## Acceptance boundary

Demonstrate early dialogue/takes, animatic import, separate ambience/effects/music, edits through UI/MCP, save/reopen, frozen exports with a common origin and a reviewed picture update.

Generated media establishes engineering behaviour. It cannot approve a performance or replace the director's own film material.

## Next milestones

M2 extends production dialogue and integration: capture/ADR, explicit timing/asset-version handoffs, sharing-aware live Screenwritr/Storytellr bridges, a Blender exporter, custom track/bus construction and measured larger-session playback.

M3 adds interchange routes with loss reports, then specialist repair, broader channels, plugin hosting and immersive finishing. Deep music-production parity is not an early objective.

