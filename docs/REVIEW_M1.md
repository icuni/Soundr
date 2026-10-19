# M1 review and limitations

Reviewed 16 October 2026. This is an engineering review of a local prototype, not a production or human editorial approval.

The complete core/protocol/transport suite passes 23 checks. Native browser work additionally verified editing, alternate takes, import, version restore, audition/apply and the completed delivery handoff. The restored version's four PCM streams exactly match the earlier 75-second export; source hashes remain unchanged. npm reports zero known production-dependency vulnerabilities in the saved audit.

Correctness fixes include inherited split fades, selected-cue ranges, exact fractional endpoints, explicit source-in/timeline visibility, removed-shot tombstones, shortened-shot ambiguity, terminal pre-render failures and save-checkpoint labels. Native checks also caught monitor sizing, narrow trim handles, the history-panel binding and small-screen toolbar overflow. Failure/correction receipts remain under output.

The browser's installed download manager intercepted internal WAV URLs; private binary playback resolved that case. Later capture sessions stalled and were reset by closing/reopening only the owned QA session. Final desktop and delivery captures then passed.

The verified picture route is CFR H.264 MP4. WebM import is experimental: its coarse container timestamps can fail the current strict cadence gate. Quantization-aware WebM validation is still required before broad WebM support is claimed.

M1 uses four initial category tracks/buses and prepared playback. Custom track/bus construction, capture/ADR, native low-latency operation, live sibling bridges, portable project packaging, resampling, time stretch, interchange and specialist finishing remain future work.

Human acceptance with real film recordings, physical speaker/display calibration and sustained larger-session playback remain open. The six reference-application scene benchmarks remain NOT RUN.

