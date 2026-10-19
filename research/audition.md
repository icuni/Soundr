# Audition: repair as a separate workflow

Evidence: DOCUMENTED. INVENTORY-OBSERVED: uninstall registrations list Audition 24.6.7, 25.6.6 and 26.5. No application or waveform was opened; no repair result was heard or measured.

## Documented behaviour

The waveform display represents amplitude over time. The spectral display represents frequency over time, with brightness indicating strength. Adobe describes a tradeoff between frequency and time detail when spectral resolution changes. This supplies a useful navigation/selection model for localized noise, not proof of a specific restoration algorithm. [Spectral display](https://helpx.adobe.com/audition/desktop/editing-audio-files/displaying-audio-waveform-editor.html)

Adobe distinguishes destructive Waveform editing from nondestructive Multitrack operations. Entering an individual file's waveform workflow can therefore have different save consequences from moving a timeline clip. [Editor comparison](https://helpx.adobe.com/audition/desktop/workspace-and-setup/viewing-zooming-navigating-audio.html)

Multitrack `.sesx` sessions hold source references and mix settings rather than embedding the audio itself. Media management is part of portability. [Multitrack overview](https://helpx.adobe.com/audition/desktop/mixing-multitrack-sessions/multitrack-editor-overview.html)

## Proposed Soundr reconstruction

Defer spectral restoration until ordinary editing and delivery work. When added, show time/frequency selection and allow before/after auditioning. Always retain the original source and create a derivative with parent-source hash, selected range, operation/settings and processing version. Replacing the selected clip with that derivative is an undoable project command.

Do not label a spectrogram as a repair engine. Display analysis, selection, processing and audible acceptance are different capabilities. Cache spectral tiles independently of source files and invalidate them by source hash and analysis settings.

Before accepting a repair, compare speech intelligibility, damaged consonants, new artifacts, boundaries and level changes. Noise reduction must never silently become a condition for importing or rendering a source.

## Unknowns and acceptance

Proprietary restoration algorithms, saved session internals beyond published concepts and installed licence health remain unknown. The optional benchmark extension repairs an owned copied recording, preserves the source hash and records settings plus an audible before/after assessment. It is not part of Soundr's first milestone.
