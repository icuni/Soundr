# Soundr project model

> Historical M0/v0.1 design. Current M1 behavior is documented in [RUNTIME.md](RUNTIME.md), [MCP.md](MCP.md) and [MILESTONE_1.md](MILESTONE_1.md). The original example/schema is not a runtime v2 project.


Status: original proposed model. [Schema](../schemas/soundr-project.schema.json), [illustrative project](../examples/scene-75s.soundr.json). These describe data; no playback engine is implemented.

## Required entities

| Entity | Essential fields and responsibility |
|---|---|
| Source | Stable ID, URI, content hash, rate, channels, duration and availability; original/derivative lineage |
| Clip | Source ID, source-in, timeline start, duration, gain, fades, take/cue references and anchor |
| Track | Ordered clip IDs, overlap policy, gain/pan and ordered processing |
| Bus | Role, channels, gain and ordered processing; receives explicit routes |
| Automation | Stable target/parameter, time anchor, interpolation and ordered points |
| Cue | Story identity, character/line/shot references, text revision, range, picture revision and approval |
| Render job | Frozen revision/hash, picture revision, range, output buses, format/tails and delivery policy |

Supporting entities are take groups, picture revisions, processors and routing edges. Full phrase-comp playlists can extend the initial take-group representation; do not confuse a candidate source with a selected arrangement.

## Timing and source bounds

M1 uses 48,000 Hz audio and unity playback rate. Original source duration and clip source ranges use source samples; the initial schema constrains source rates to the project rate. A later converter produces an immutable derived source and an explicit original-to-derived mapping. Merely relabelling a 44.1 kHz file as 48 kHz is invalid.

All ranges are half-open: `[start, start + duration)`. Positions/durations are safe integers; duration is positive. `sourceIn + duration` cannot exceed source duration. Fade lengths cannot exceed clip duration. The sum of two fades may exceed duration, but their envelopes then both apply; the UI must disclose that choice.

Picture frames retain an exact numerator/denominator, revision ID, start timecode and timeline offset. A 24 fps frame is 2,000 samples at 48 kHz; 25 fps is 1,920. At 30000/1001 fps, frame boundaries can fall between samples. Preserve frame identity and convert with the declared nearest-sample rule, ties away from zero; do not repeatedly add rounded frame durations. Drop-frame timecode is a label convention, not a changed playback rate. It remains unsupported until separately tested.

## Selection and arrangement

Track clip arrays provide deterministic ordering; timeline positions determine playback. Overlaps on a `mix` track sum. A `selected-take` track also filters candidate clips against the selected take in their group. An enabled clip with no take reference remains a normal clip. Changing take selection does not remove inactive candidates.

For a cue-relative clip, resolved start equals `cue.startSample + offsetSamples`. Keep the stored start consistent as a validated projection. Moving that clip updates its offset; moving the cue preserves the offset and updates resolved placement. A left trim or split must remap the child's offset too. Absolute clips have no cue anchor; story membership alone does not mean they must move. A shot move resolves explicitly linked cues and their anchored clips, deduplicates clip IDs and previews spanning/absolute exceptions.

## Signal graph

M1 processing order is source read -> clip gain/fades -> track mix -> ordered track processors -> track gain/pan -> routed buses -> ordered bus processors -> bus gain -> destinations. Pre-fader sends tap immediately before the track/bus gain stage; post-fader sends tap after gain/pan. Mono sources enter stereo tracks with the declared centre-pan law; stereo sources retain channel identity. The first engine spike must make the pan law explicit and test it.

Routes identify their sender, destination bus, tap, send gain and channel map. The initial graph rejects cycles and duplicate accidental main paths. Exactly one master bus exists and has no outgoing route. Each active track requires a reachable master path. Shared effects need an assigned stem category or a separate effects return. Built-in gain/high-pass processors have stable IDs, versions, parameters and declared latency. Arbitrary plugin state is deferred.

Automation points are strictly ordered and use native parameter units. `linear` means linear interpolation of those units; for a gain target the units are dB, with conversion to amplitude after interpolation. Before the first point and after the last point, hold the endpoint value. Empty envelopes use the base parameter. Timeline-anchored automation stays at absolute time; cue-relative automation follows its cue. Reconform must explicitly inspect boundary points, including a point inserted to preserve interpolation across a split.

## Story and approval

External references include system, project ID, entity ID, entity type and revision. Text names are labels. A cue can reference a character, dialogue line and Storytellr shot/event simultaneously. Queries use IDs and return the imported revision plus stale-link diagnostics.

Approval is editorial state, separate from take rating and active selection. `approved` requires reviewer identity, selected take identity and picture revision. Changing relevant dialogue text, take choice, source processing or picture timing moves approval to `needs-review` and preserves prior evidence in history. Initial example cues are unapproved and their media is unresolved.

## Rendering and missing data

Draft jobs may have no content hash. Queueing requires a verified dependency set and a frozen semantic editing-state hash; operational job state and receipts are excluded from that hash to avoid self-reference. A later edit does not change a queued job. Reuse of a job ID with different frozen settings fails.

Missing media is a state, not permission to synthesize silence. Relink requires verified media identity or an explicit replacement operation that creates a new identity/lineage. Missing plugins or unsupported settings block equivalent final exports. A separately requested diagnostic export must list its omissions and mark itself incomplete.

The example is deliberately **structurally valid but not render-ready**. Its declared durations and paths are illustrative metadata; no recorded performance, picture file, source hash or successful export is implied.
