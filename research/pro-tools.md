# Pro Tools: gain staging, exchange and delivery

Evidence: DOCUMENTED. The edition comparison was retrieved on 16 October 2026. A historical Pro Tools 12.8.2 reference guide corroborates clip-gain semantics; it is not evidence for current edition entitlements. No `.ptx` session, live application or proprietary implementation was inspected.

## Documented behaviour

The current comparison lists clip gain and track comping across the four editions. AAF/OMF/MXF interchange, selected-range export and single-file multi-stem bounce are listed for Studio and Ultimate, while field-recorder workflows are listed for Ultimate. A capability must therefore be recorded with its edition. [Avid edition comparison](https://www.avid.com/pro-tools/comparison)

The historical reference guide describes clip gain ahead of the mixer and plugin processing, attached to the clip when it moves. Matching recordings at that stage reduces corrective mixer automation. This is a stable design reference; current runtime semantics still need the empirical scene check. [Pro Tools 12.8.2 reference guide, Clip Gain chapter](https://resources.avid.com/SupportFiles/PT/Pro_Tools_Reference_Guide_12.8.2.pdf)

## Proposed Soundr reconstruction

Store clip gain separately from fader automation. A quiet take receives a clip correction before EQ/compression; scene-level music ducking uses track/bus automation. The UI must show which stage a control affects. Audition comparisons should disclose any loudness matching so a louder take is not mistaken for a better performance.

Define a delivery contract before choosing interchange libraries. Native Soundr projects preserve original/derived source identity, source offsets, clips, takes, fades, routing, automation, processing state, story links and picture revision. Every external export includes a manifest of what it can represent.

For AAF/OMF, explicitly test embedded versus linked media, handles, sample-rate conversion, channel layout, timeline offsets, BWF time references, clip gain, fades, automation and processor translation. Do not advertise lossless session exchange merely because a file opens. If an exporter bakes a process, record the new source and the settings; if it drops a feature, list the omission. Import into a new revision and retain the incoming file's hash.

A delivery manifest names the project revision/hash, picture revision/hash, render settings, actual included buses/range, external dependencies, missing assets/processors, omitted capabilities, warnings and output hashes. A render with unavailable required media is blocked by default. An explicitly requested incomplete diagnostic export is labelled incomplete and cannot masquerade as a final mix.

Make all dialogue/music/effects stems share a declared start, duration, channel order and tail policy. Preserve gain relationships by default. Independent loudness normalisation would change their recombination and must be a visible option.

## Unknowns and acceptance

Native Pro Tools format reconstruction, plugin-state compatibility and full AAF/OMF round trips remain unimplemented. The first Soundr handoff should be WAV stems plus a machine-readable manifest and cue sheet. Compare a round trip's timeline and decoded media, not just successful import. Nonlinear processing on a shared master bus can prevent independently rendered stems from summing to the processed master; the manifest must describe that relationship.
