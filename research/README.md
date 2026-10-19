# Soundr research findings

Research date: 16 October 2026. REAPER is the primary editing reference. The other systems supply focused lessons for Soundr's film workflow and technical design.

| Reference | Lesson for Soundr | Evidence completed | Next empirical check |
|---|---|---|---|
| [REAPER](reaper.md) | Composable edits, takes, routing, automation and explicit render selection | Official feature documentation and public ReaScript API | Run the scene protocol in an isolated session |
| [Nuendo](nuendo.md) | ADR cues and a reviewed, previewable reconform plan | Official Nuendo 15.0 workflow documentation | Inspect boundary events, handles and automation after reconform |
| [Pro Tools](pro-tools.md) | Clip gain separation and dependable exchange/delivery | Current edition matrix; historical official gain-staging reference | Exchange a real session and inspect losses |
| [Fairlight](fairlight.md) | Fast dialogue/take auditioning against visible picture | Official workflow documentation; local installation registration | Capture actual recording, comping and sync behaviour |
| [Ardour](ardour.md) | Source/region/playlist/track separation; engine/UI boundaries | Official manuals plus twelve source files at an exact commit | Build/run coverage remains untested |
| [Audition](audition.md) | Spectral repair as a later specialist workflow | Official editor/spectral documentation; local registrations | Repair a copied source and inspect derivative lineage |

These are documented capability studies and a bounded source analysis, not claims that the proprietary applications' internal engines have been inspected. The derived Soundr structures and algorithms are design proposals.

## Findings that change the build

1. Preserve source identity independently of every timeline edit. Store positions and source ranges explicitly; do not bake routine trims, moves or fades into recordings.
2. Represent alternate takes and the chosen performance explicitly. A second visible lane must not accidentally become a second audible voice.
3. Give every route, automation target and render selection a stable identity. A stem is a deliberate signal-path selection, not just a filename.
4. Store story references and picture revision from the first project version. Adding these later would require recovering identity from filenames and timecodes.
5. Treat picture changes as a proposed transformation with conflicts, preview and undo. Cross-boundary room tone, music and reverb tails require policy.
6. Separate technical success from editorial acceptance. An exported WAV can be structurally correct and still have the wrong take or sync.

These six points are Soundr design conclusions drawn from the studies; vendor-specific factual claims and their primary links are in the individual reports.

## Evidence rules

| Label | Meaning |
|---|---|
| DOCUMENTED | A primary vendor/manual/API source states the behaviour; no local runtime proof |
| SOURCE-OBSERVED | A named symbol or implementation was read at a pinned public source revision |
| INVENTORY-OBSERVED | A local registration or bounded installation path was read; no execution proof |
| PROPOSED | Soundr's own product or engineering decision |
| NOT RUN / UNKNOWN | No relevant empirical observation exists |

No benchmark action log has been populated with fictional observations. No performance numbers, acoustic quality claims or full compatibility claims are made. No proprietary decompilation was performed. Ardour's own development page identifies its GitHub repository as an official mirror. [Ardour development](https://ardour.org/development.html)

## Local coverage and limitations

Read-only checks examined the standard Program Files vendor folders and the HKLM, WOW6432Node and HKCU uninstall-registration trees. They found Resolve 20.1.00020 and Audition 24.6.7, 25.6.6 and 26.5 registrations. They did not detect the other four products in that bounded search. No recursive scan of all disks was performed, and no application was launched or user session changed.

No owned 60-90-second picture/audio scene was selected or supplied. The shared scene protocol is ready, but all six application runs remain NOT RUN. Product licences, exact runtime versions, audio hardware settings and the scene's rights need to be recorded when that experiment is actually performed.

The sandbox's first direct public-source request failed with `No such host is known`. A network-enabled request subsequently obtained the Ardour commit and all twelve selected files. Browser retrieval of those exact raw commit URLs reported cache misses; successful source retrieval is evidenced separately by the local SHA-256/symbol ledger. The REAPER PDF body and Nuendo feature landing page were not used to support detailed claims. [Source register](SOURCES.md)
