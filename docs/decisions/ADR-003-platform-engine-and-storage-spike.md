# ADR-003: Select platform, engine and persistence through a bounded spike

## Status

Proposed. No framework, audio backend, storage engine or third-party DSP dependency is selected or installed by this research task.

## Date

16 October 2026.

## Context

Sibling applications use web/Electron tooling, while professional audio needs device timing, bounded callback work, reliable offline output and durable project state. Familiarity alone cannot establish engine suitability. A code licence must be checked before adoption.

## Decision proposed

Implement the headless logical core first. Compare a browser/Web Audio prototype and a native audio-engine path on the identical owned 75-second scene. A web UI may wrap a native engine; these are not mutually exclusive. Treat Windows device output/recording, background scheduling, seek recovery and offline-render parity as explicit decision criteria.

Compare transactional local storage against atomic project checkpoints with bounded history/idempotency. Prototype interrupted writes and restart on the actual filesystem before choosing. The JSON model remains the portable logical contract in either case.

## Evidence needed to accept

- Identical assets, edits, route graph and automation; recorded machine/device/driver/buffer settings.
- Measured sync after seeks and over the scene; underruns and resource use; decoded-output alignment and repeatability.
- UI responsiveness while decoding/waveform jobs run, plus device loss/recovery behaviour.
- Correct old/new project recovery under interrupted save, disk error and duplicated command response.
- Exact dependency versions, source/licence provenance and packaging path.

## Consequences

A visually convincing mockup cannot settle this decision. A fixed short workload is enough for M1 suitability, not evidence of unlimited track counts or professional-DAW parity. Third-party plugin hosting, ASIO distribution, codecs and interchange each require their own version/licence review when selected.
