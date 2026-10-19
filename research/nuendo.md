# Nuendo: dialogue operations and picture changes

Evidence: DOCUMENTED, Nuendo 15.0 webhelp. No local Nuendo session or proprietary code was inspected. The general feature landing page returned insufficient body text and is not the evidence for the detailed findings below.

## Documented behaviour

ReConform compares old/new EDL versions to generate a Change EDL, or accepts an existing Change EDL. The operator checks and corrects its entries before applying changes. Preview can show the result without changing the original media. [ReConform workflow](https://www.steinberg.help/r/nuendo/15.0/en/cubase_nuendo/topics/reconform/reconform_workflow_c.html)

The documented preview can audition source and destination entries. Its temporary destination material is offset by one day, locked during preview, and removed when preview ends. This is a documented implementation detail, not a runtime observation. [Preview](https://www.steinberg.help/r/nuendo/15.0/en/cubase_nuendo/topics/reconform/reconform_change_edl_preview_r.html)

Overhanging events have a specific policy: an option preserves audio extending beyond a video clip, with a maximum overhang specified in frames; without it, those portions may be cut. [Overhanging audio](https://www.steinberg.help/r/nuendo/15.0/en/cubase_nuendo/topics/reconform/reconform_overhanging_audio_events_including_c.html)

ADR uses position/cycle markers for cue ranges, guide playback, rehearsal and recording. Nuendo documents automatic/Free Run modes, a remote script reader and an ADR API. [ADR overview](https://www.steinberg.help/r/nuendo/15.0/en/cubase_nuendo/topics/adr/adr_c.html)

## Proposed Soundr reconstruction

Make a dialogue cue a durable record: character ID, line ID and text revision, shot/event references, picture revision, range, candidate takes, selected take, rating and approval evidence. An actor's name is display text; IDs survive spelling changes.

Implement ADR as a state machine: select cue, configure guide/monitor inputs, rehearse, record a new immutable source, review, choose, then approve. Rehearsal cannot create an approved take. Recording failures preserve completed media and mark incomplete captures. Input latency, monitoring latency and compensation belong in the recording receipt. Recording is later than the first edit/import milestone.

Reconform consumes explicit old/new edit maps. Each plan contains mappings, moved/split/removed clips, affected cues, automation and routing implications, missing handles, and unresolved matches. Preview operates on a derived read-only project revision. It must not rewrite the live session or depend on a special one-day timeline offset.

Distinguish three anchors: absolute timeline, cue-relative and shot-relative. Moving a shot moves its explicitly attached sounds once. Long ambience, music, crossfades and shared effects may span mappings; never assign them solely from their starting timestamp. Removed shots quarantine their attached material in the plan instead of silently deleting source recordings.

Apply only to the revision used to generate the reviewed plan. Changing the project or edit map invalidates that preview. Commit the approved transformation as one undoable transaction. Text, take or picture changes invalidate the relevant approval state.

## Unknowns and acceptance

No claim is made about proprietary matching algorithms, EDL accuracy, latency or exhaustive format coverage. Test insertions, deletions, reorders, duplicates, speed changes, repeated source names and clips crossing shot boundaries. Ambiguous maps require a named human resolution; unsupported speed changes must be visible. Verify preview cancellation, apply, undo and save/reopen against the same manifests.
