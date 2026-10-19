# Soundr milestone 1

16 October 2026. **Working local prototype; generated-media engineering validation.** Human editorial acceptance with the user's scene is still pending.

## Implemented

- Independent Orama Soundr workstation with story-linked dialogue, character/line/scene/shot IDs, cues and alternate imported takes.
- Non-destructive placement, move, trim, slip, split, fades, gain, overlaps, parking, undo/redo and checkpoint/version restore.
- Separate dialogue, ambience, effects and music, shared buses, routing, gain/high-pass processing and native-unit automation.
- Exact rational frame/sample timing, explicit picture/source offsets, hashed picture versions and audio-clock picture playback.
- Frozen master/D/M/E PCM24 BWF exports, shared origins, file hashes, omissions and explicit completion/failure receipts.
- Official stdio MCP with thirteen tools using the same operation service as the UI.
- Stable-shot reconform: preview, explicit conflict choices, read-only audition, atomic apply and undo.
- Supplied Screenwritr story-graph v1 and native Storytellr v2 snapshot adapters.

## Executed proof

The compact machine-readable record is [verification.json](../acceptance/m1/verification.json). Detailed local receipts and generated outputs remain under `output/acceptance` and `.soundr-data`.

| Check | Observed result |
|---|---|
| Save/reopen | UI gain edit survives browser reload; an independent store instance reopens the identical saved project |
| UI and MCP | UI edit visible through MCP; separate MCP edit appears in the browser; identical retry applies once |
| Editing | Native clip drag and edge trim verified with undo; split-inside-fade preserves evaluated samples |
| Takes | Alternate selection and restoration verified without deleting either source |
| 75-second delivery | Two frozen exports are byte-identical across all four WAVs |
| Alignment | 3,600,000 samples per original output, stereo 48 kHz PCM24, BWF origin 172,800,000 |
| Stem sum | Neutral-master D+M+E matches master within PCM quantization tolerance |
| Independent sync | FFmpeg reads white picture markers at 0/28/50/70 seconds; corresponding exported impulses are present |
| Picture review | Five-second insertion proposes footstep 28→33 seconds and flags spanning room tone/music |
| Audition | Saved project remains identical while the resolved 80-second candidate plays |
| Apply/undo/redo | One apply produces the 80-second cut; undo restores 75 seconds and earlier picture; redo restores the candidate |
| Revised delivery | 3,840,000 samples; independent markers at 0/33/55/75 seconds; source hashes unchanged |
| Fractional offsets | Actual 30000/1001 proxy, source-in frame 1, timeline start 4800 samples, clip source-in 24 samples |
| Fractional measurement | Picture frame 61 maps to exported sample 100896; independent timestamps report zero residual in this fixture |
| Browser timing | 500 native video-frame observations; 0.228 frame p95 and 0.248 frame maximum absolute software residual in the recorded run |
| Failure handling | Failed save preserves checkpoint/receipt; corruption recovery warns; stale/duplicate/cyclic/unsupported edits fail; missing/changed media and excessive render memory fail explicitly |

The original 75-second renders took approximately 11.5 and 12.2 seconds in this environment. The verified 80-second render took approximately 7.3 seconds. These are observed runs, not a comparative performance benchmark.

## Native visual evidence and corrections

Local screenshots show the actual application, not design mockups:

- `output/playwright/workstation-initial.png`: initial monitor sizing failure.
- `output/playwright/workstation-selected.png`: corrected picture pane, dialogue line and editable source controls.
- `output/playwright/review-unresolved.png`: explicit spanning-audio choices; audition/apply disabled until resolved.
- `output/playwright/review-applied.png`: applied 80-second cut.
- Final desktop/responsive/delivery screenshots and action receipts are recorded with the verification bundle.

Corrections retained in the build evidence:

1. Video intrinsic size expanded the monitor and covered transport controls. The picture now stays inside its fixed pane.
2. An installed IDM extension intercepted internal WAV requests with HTTP 204. Native HTTP served valid audio. Internal playback now uses an authenticated extensionless binary API; actual browser playback passes.
3. Narrow Foley trim handles covered the whole clip. Handles now retain a draggable centre; native drag/undo passes.
4. A queued fractional test did not reach terminal state within its initial wait. That original exception was not captured. Render preparation errors now produce explicit terminal receipts, request-failure injection passes, and the saved fractional fixture completed after recovery. The acceptance script allows the bounded queue to finish.

## Integration status

The [pre-implementation audit](INTEGRATION_AUDIT.md) distinguishes existing upstream capabilities from Soundr additions. M1 extends those with local snapshot adapters, audio/story identity, validated operations and versioned media. It does not establish live peer bridges.

Missing work remains explicit: upstream rational timing/asset-version handoff contracts, live sharing-aware Screenwritr/Storytellr exchange, Blender exporter, portable session packaging, recording/ADR, custom track/bus creation, native low-latency engine, resampling/time stretch, drop-frame labels, VFR mapping, plugins, interchange, spectral repair and immersive delivery.

The prepared demo's voice takes are tone placeholders in this environment. Generated media cannot establish voice-performance quality. Physical A/V calibration, real-scene integration, sustained production playback and director acceptance remain **NOT RUN**.

## Research boundary

REAPER remains the editing reference; Soundr has no runtime REAPER dependency. [The six studies](../research/README.md) use primary documentation and pinned public-source evidence. All six reference-application scene benchmarks remain NOT RUN; Soundr's engineering checks do not claim feature parity or inspection of proprietary internals.


## Final review

The complete regression suite passes 23 checks. The verified picture fixtures use CFR H.264 MP4. WebM timebase-quantization handling remains experimental. See [the M1 review](REVIEW_M1.md) for corrections and coverage limits.
