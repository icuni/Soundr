# Render and handoff contract

> Historical M0/v0.1 design. Current M1 behavior is documented in [RUNTIME.md](RUNTIME.md), [MCP.md](MCP.md) and [MILESTONE_1.md](MILESTONE_1.md). The original example/schema is not a runtime v2 project.


Status: proposed. The [manifest template](../acceptance/render-manifest.template.json) is explicitly not an executed job receipt. No audio export has been produced in this task.

## Planning

Select the semantic editing revision and freeze its hash, source hashes, processor identities/settings, routing graph, picture revision/hash, range, outputs and processing policies. Validate actual dependency availability before queueing. UI solo/selection or a later edit cannot change the job. Track mute is semantic mix state and is captured in the snapshot.

Show exactly which buses and sources contribute. By default, dialogue, music and effects stems tap their category buses after category processing and before shared master processing. A master render is a separate output policy. Shared reverb belongs to an assigned category return or a named separate output; it must not be accidentally included twice or omitted.

M1 delivery is stereo 48 kHz 24-bit PCM WAV with declared common start/range and tails. Normalisation and dither are off for the initial repeatability gate. Broader output options require explicit new profiles and validation. Start timecode must be present in the manifest even if the container does not carry equivalent metadata.

## Execution and terminal state

Write to new temporary output files inside the approved destination. Check collisions before execution and again when finalizing; default to refusing an existing final filename. Validate output format, channels and decoded sample count, then hash and finalize the job's output set. Record partial outputs on failure/cancellation without labelling them complete. A multi-file export must not claim completion while any selected output failed.

Terminal states are completed, failed, cancelled or incomplete-diagnostic. Finalized outputs and receipts identify actual paths/hashes, included content, missing/omitted dependencies, processing versions and picture revision. A request accepted or job queued is not a completed render. A file present without a completed receipt is not a certified handoff.

## Repeatability and recombination

Run the same frozen M1 graph twice under the same engine/profile. Compare decoded PCM exactly. File hashes are also recorded, but container timestamps/metadata can differ independently. Do not promise bit-identical third-party effects, random generators, different resamplers or unseeded dither. Such additions need a declared determinism policy.

For a linear dry master, compare the internal sum of category outputs to the reference graph. After independent 24-bit quantisation, allow an explicitly declared error bound, initially `(number of stems + 1)` least-significant sample steps. This is a proposed quantisation check, not permission to ignore audible mismatch. If a limiter/compressor/saturator or other shared nonlinear operation processes the combined master, independent stems generally cannot reproduce that processed result merely by summing. Label the difference and offer an appropriate dry reference plus processed mix.

Peak/loudness measurements name the actual algorithm/version and measured scope. Until a meter is implemented and validated, fields remain null/unmeasured. Do not invent LUFS or true-peak compliance from file metadata.

## Orchestra handoff

Provide completed output files, manifest, cue sheet, content/picture identities and unresolved editorial notes. The receiving adapter verifies hashes and accepted format. It does not infer scene alignment from filenames. This pack creates no live sibling handoff or publication.
