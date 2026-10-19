# Shared scene benchmark

Status: **NOT RUN** in every reference application and in Soundr. No owned scene has been selected. The [example project](../examples/scene-75s.soundr.json) is a structural fixture with placeholder media, not an experiment result.

## Controlled workload

Choose one owned 60-90-second scene; 75 seconds is the initial specification. Use identical source assets and the same old/new picture revisions in each application. Preserve originals and create isolated experiment session folders. Record rights/source provenance, file SHA-256, rate/channels, lengths, picture frame rate/codec, start timecode and intended sync markers in a scene manifest.

Start with 48 kHz mono/stereo PCM audio, a constant-frame-rate picture proxy and at least two dialogue candidates, room tone, a footstep and a music bed. The illustrative timing is: dialogue at 12-16 seconds, room tone across the scene with a 35-40 second overlap, and a footstep at 28 seconds. Real scene timings may differ, but the frozen scene manifest becomes authoritative for every run.

Create a second picture edit with a five-second insertion at 20 seconds, making a 75-second scene 80 seconds. Retain stable shot IDs and an explicit old/new interval map. Add separate ambiguity cases for duplicated/reordered shots and material spanning boundaries. Do not alter the workload per application to produce a favourable result.

## Capture before starting

Record actual application version/edition, OS, CPU, RAM, audio device/driver, project/device sample rate, buffer size, monitoring offsets, plugin versions, media storage and video proxy. Capture a native screenshot. These settings are part of the result, not assumptions taken from an installed registration.

Populate a fresh copy of [the action-log template](action-log.template.csv). One row per action includes intention, exact operation/settings, expected/observed result, error, before/after artifact references and evidence. Timing is a measured observation; leave it unknown when not measured. Retain failures and the corrective action rather than erasing unsuccessful attempts.

## Common procedure

| Step | Action | Evidence to retain |
|---|---|---|
| 1 | Create isolated session; import picture and original assets; set clocks | Session, metadata, original hashes and screenshot |
| 2 | Place original dialogue at the declared sample/frame; adjust clip gain | Position/source-in/gain receipt and audition |
| 3 | Add alternate dialogue; compare and select a take | Candidate/selected identities, source preservation and recording of the decision |
| 4 | Trim/split/slip/move/undo at declared boundaries | Before/after positions and exact restored state |
| 5 | Overlap/crossfade room tone | Fade settings, waveform/native screenshot and audible assessment |
| 6 | Place footsteps; route dialogue/music/effects separately | Source/timing references and routing capture |
| 7 | Lower music under dialogue; apply shared built-in processing | Automation points/units, processor order/settings and bus isolation |
| 8 | Save, close and reopen the isolated session | Semantic state comparison, relink diagnostics and sync check |
| 9 | Introduce revised picture; preview and apply supported changes | Old/new map, change plan, ambiguous/overhanging material and human resolutions |
| 10 | Export aligned D/M/E stems and a reference mix | Frozen settings, range, processing/tail policy and delivery manifest |
| 11 | Repeat the render without edits; compare decoded audio | Output hashes, decoded-sample comparison and any variability |
| 12 | Hide one copied dependency and retry final export; restore it | Missing-media diagnostics and no silent substitution |

Step 9 records native reconform where documented. A manual change exercise in another application is labelled manual; it does not establish equivalent built-in reconform. If an edition lacks a capability, record `UNSUPPORTED` with edition/source evidence instead of fabricating a pass. Repair is an optional separate extension, not a prerequisite to completing the basic scene.

## Application-specific observation map

| Application | Inspect directly during the common run |
|---|---|
| REAPER | Item versus take/source attributes; lanes/selection; folder/send graph; envelopes; region-by-track render selection; generated local API docs |
| Nuendo | Cue/ADR controls; old/new EDL and reviewed Change EDL; source/destination preview; overhang and automation policies |
| Pro Tools | Clip gain versus mixer automation; alternate arrangements; edition-dependent exchange/video/stem settings; actual handoff losses |
| Fairlight | Picture/line navigation; layers/ratings/ADR; library audition versus placement; effects order and bus selection |
| Ardour | Source/region/playlist relationships; track/bus graph; save/session dependencies; exports |
| Audition | Multitrack nondestructive arrangement; source/session portability; optional Waveform/spectral derivative workflow |

These are experiment targets drawn from [the studies](../research/README.md), not an action log claiming they were executed.

## Soundr acceptance measurements

1. **Edit/source integrity:** source hashes unchanged; sample ranges and split coverage exact; all candidate IDs preserved.
2. **Persistence:** semantic state identical after reopen; IDs and source offsets unchanged. Inject interrupted saves and IO errors. Confirm recovery and retried-command behaviour.
3. **Offline sync:** declared sync transient appears at the expected rendered sample. Frame-to-sample rounding error is at most half a sample for accepted rates using the stated rule.
4. **Playback sync:** independently check visible flash/audio transient markers at start/middle/end and after seeks. Record measurement uncertainty and monitoring offset. Initial target is no growing drift and no more than one picture frame residual offset after calibration. This is a proposed target, not a measured result.
5. **Repeatability:** for M1 built-ins, fixed settings and dither off, decoded PCM must match exactly across repeated renders. Also report container hashes; metadata differences are separate from sample differences.
6. **Stem alignment:** identical sample count, start, channel order and declared tails. Validate category isolation. Compare dry-stem sum with the dry reference before nonlinear master processing, allowing the declared quantisation tolerance.
7. **Runtime stability:** record callback underruns, seek recovery, device loss and UI responsiveness for the same real workload. A short-scene pass is not a large-session capacity claim.
8. **Editorial acceptance:** a person reviews take choice, intelligibility, crossfades, noise, music balance and sync. Keep native screenshots and audible correction receipts.

See [scenarios.json](scenarios.json) for requirement coverage and [DELIVERY.md](../docs/DELIVERY.md) for output semantics. No automatic artifact check is a substitute for these runtime/editorial gates.

## Completion receipt

Each run ends with observed results, unavailable features, failures/corrections, links to sessions/screenshots/outputs and unresolved questions. Only change [benchmark-status.json](benchmark-status.json) from NOT RUN when that application's actual evidence exists. Do not promote a documentation study or generated fixture into a completed run.
