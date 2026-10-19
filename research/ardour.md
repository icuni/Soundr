# Ardour: inspectable architecture

Evidence: DOCUMENTED and SOURCE-OBSERVED. The official development page identifies the GitHub mirror. Twelve files were fetched from commit `a9ea4a98a336729a69453edbcc29905a79ac75e1`, dated 16 October 2026 at 09:38:04 UTC. This is a source snapshot, not a tested release. [Official development entry](https://ardour.org/development.html)

The [local source ledger](evidence/ardour-source-inspection.json) retains per-file SHA-256, byte/line counts and symbol locations. The implementation remains upstream. No Ardour build, executable or runtime was tested.

## Documented architecture

Ardour sessions describe arrangements and automation separately from media. Regions describe editable segments; playlists arrange regions; tracks play/record them and buses receive routed signals. Session files use XML and can reference external media. [Ardour manual](https://manual.ardour.org/ardourmanual.html)

Developer documentation separates UI, audio processing and background transport/disk work. Its transport article describes queued session requests and background handling of work unsuitable for a realtime callback. That article is JACK-oriented and should not be treated as a complete description of every current backend. [Transport thread design](https://ardour.org/transport_threading.html)

The time-design notes explain how repeated conversion between time domains can introduce boundary errors, and why a consistent map snapshot matters within a processing cycle. [Handling time](https://ardour.org/timing.html)

Cross-thread notifications deliver callbacks to the receiving event loop; GUI work stays on the GUI thread. The linked article explicitly describes April 2023 and its known limitations. [Cross-thread signalling](https://ardour.org/cross-thread.html)

## Source landmarks

The following are static observations at the pinned commit. Links identify the exact upstream file and line.

| Concern | Observed landmark |
|---|---|
| Source identity/state | [`Source`, source.h:43](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/ardour/source.h#L43) and state methods at 97-98 |
| Region/source separation | [`SourceList`, region.h:117](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/ardour/region.h#L117); timeline position/source start/length at 138-147 |
| Arrangement editing | [`Playlist::add_region` / `split_region`, playlist.h:170](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/ardour/playlist.h#L170) |
| Track and routing | [`Track : Route`, track.h:54](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/ardour/track.h#L54); playlist access/selection at 175-181 |
| Processing chain | [`Route`, route.h:105](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/ardour/route.h#L105); processor list at 628 |
| Clip audio evaluation | [`AudioRegion::read_at`, audioregion.cc:603](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/audioregion.cc#L603); scale/fade logic appears later in that function |
| Engine boundary | [`AudioEngine::process_callback`, audioengine.cc:234](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/audioengine.cc#L234) and calls into session processing |
| Save/state | [`Session::save_state`, session_state.cc:789](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/session_state.cc#L789); structured sources/playlists/routes in state serialization |
| Render orchestration | [`ExportHandler`, export_handler.cc:155](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/export_handler.cc#L155); separate timespan lifecycle methods |
| Undoable UI edits | [`editor_ops.cc:6208`](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/gtk2_ardour/editor_ops.cc#L6208), reversible command grouping |

These observations support the separation of media identity, arrangement, routing, evaluation and UI operations. They do not establish comprehensive thread safety, realtime guarantees or functional correctness across the repository.

Focused body reading found source reads followed by envelope/scaling operations in the no-region-FX branch, and separate pre-FX fade handling when configured. Do not infer one universal processing order from one branch. [Region evaluation](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/audioregion.cc#L774)

The save path creates a backup of an existing session file, writes temporary state, then renames it into place, with failure returns. That is direct source evidence for a persistence pattern, not a demonstrated crash-safety guarantee on Soundr's Windows filesystem. [Save implementation](https://github.com/Ardour/ardour/blob/a9ea4a98a336729a69453edbcc29905a79ac75e1/libs/ardour/session_state.cc#L886)

## Proposed Soundr reconstruction

Use a headless project/command core, a separate playback/render engine and a UI that reads projections. Waveform generation, decoding, hashing, disk writes and video thumbnail work belong outside the audio callback. Publish immutable render-graph snapshots and apply validated changes at defined processing boundaries.

Keep an arrangement layer for alternate performances even if the first UI displays clips directly on tracks. Store source-in separately from timeline placement. Pin the project rate and preserve rational picture time; avoid repeatedly rounding between frames and samples.

## Licensing boundary

Ardour publishes GPL v2 terms; inspected source headers also carry their own notices. Reusing implementation would require an explicit compatible licensing/distribution plan, preserving notices and meeting source-distribution obligations. This pack includes original analysis and metadata, with no vendored Ardour engine code. Soundr's eventual code and dependency licences are undecided. This is a dependency constraint, not permission to treat publicly readable code as unrestricted. [Ardour licence text](https://ardour.org/copying.html)
