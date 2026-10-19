# Orama Soundr

Soundr is the independent film-audio workstation within **Orama**, the working name for the filmmaking suite. REAPER is the main functional reference. Soundr uses its own project model, commands and audio evaluator.

M1 is a working local prototype: story-linked dialogue and alternate takes, non-destructive editing, picture playback, save/reopen, routing, automation, master/D/M/E exports, and reviewed picture changes. Verification uses original generated test media. Real-scene editorial acceptance and physical speaker/display calibration remain open.

## Run

Requires Node 22.18 or newer. FFmpeg/FFprobe must be on PATH for picture inspection. Use a current Chromium browser.

~~~powershell
Set-Location 'D:\ICUNI Group\ICUNI Labs\Soundr'
npm ci --ignore-scripts
npm start
~~~

Open [Soundr locally](http://127.0.0.1:17841). Choose **Open demo** or **New session**. A session can begin with early voices before picture exists.

Each edit commits locally. **Save version** names a checkpoint; **Versions** restores an earlier cut and mix as an undoable revision. **Export mix & stems** produces four synchronized WAVs and a delivery receipt.

For a fresh checkout, demo generation also needs Python/Pillow and FFmpeg. Start Soundr, then run `npm run demo`. It attempts local Windows speech and falls back to clearly labelled test tones.

## Start here

- [M1 verification and remaining work](docs/MILESTONE_1.md)
- [Integration audit completed before implementation](docs/INTEGRATION_AUDIT.md)
- [Runtime architecture and timing](docs/RUNTIME.md)
- [MCP setup and tools](docs/MCP.md)
- [Requirements and scope](docs/BUILD_SPEC.md)
- [REAPER study](research/reaper.md) and [six-system research coverage](research/README.md)

## Scope

Audio: mono/stereo, 48 kHz, 16/24/32-bit PCM or float32 WAV. Verified picture route: zero-origin CFR H.264 MP4. WebM import is experimental; coarse container timestamps may fail the strict cadence gate. Exact rates: 12, 24, 25, 30, 60, 24000/1001 and 30000/1001. Sessions are bounded to 180 seconds, audio uploads to 64 MiB, picture uploads to 256 MiB and estimated render memory to 1 GiB.

M1 starts with separate dialogue, ambience, effects and music tracks, category buses and a master. It supports imported replacement takes, gain/high-pass processing and native-unit automation. Recording/ADR, custom track/bus creation, time stretch, resampling, third-party plugins, drop-frame labels, VFR mapping, interchange and immersive mixing follow later.

Snapshot adapters preserve Screenwritr and Storytellr IDs. Live two-way bridges and a Blender exporter are not implemented. Blender renders enter as explicit, hashed picture revisions.

## Checks

~~~powershell
npm test
npm run schema
python scripts/validate_pack.py
~~~

Tests exercise the actual core, HTTP service, official stdio MCP client and rendered audio. Full-scene receipts are in `output/acceptance`; [acceptance/m1](acceptance/m1/verification.json) holds a compact verification record. Dependencies, generated media, runtime credentials, renders and browser logs are ignored by version control.

The v0.1 schema/example and original architecture documents are historical research designs. Runtime v2 uses [project-v2.schema.json](schemas/project-v2.schema.json) and [command-envelope-v2.schema.json](schemas/command-envelope-v2.schema.json), with additional semantic validation. No automatic v0.1 migration is claimed.

All six reference-application scene benchmarks remain **NOT RUN**. Soundr's executed checks are separate. No sibling app, global MCP configuration, remote repository or deployment was changed.

