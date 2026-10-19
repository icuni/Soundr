# Fairlight: picture-first dialogue editing

Evidence: DOCUMENTED from Blackmagic's Fairlight page. INVENTORY-OBSERVED: local uninstall registrations list Resolve/Renderer 20.1.00020. Installation metadata does not prove which features are licensed or working. No project was opened or modified.

## Documented behaviour

Fairlight describes recording additional takes into track layers, ADR cues with character/dialogue fields, multiple recorded takes and favourite ratings. Its layers support phrase comping and alternative performances. The sound-library workflow auditions and places effects while working with picture. Audio/video scrollers assist alignment. FlexBus provides flexible track/bus routing, and clip/track effects have an explicit processing order. External processing creates a bounced clip version. These are selected published behaviours; vendor capacity and latency claims were not benchmarked. [Fairlight workflows](https://www.blackmagicdesign.com/products/davinciresolve/fairlight)

## Proposed Soundr reconstruction

Keep the picture viewer and selected story cue visible while editing. Selecting a Screenwritr line should reveal its cue, current take, alternatives, approval state and timeline location. Selecting a Storytellr shot/event should reveal related dialogue, effects and ambience. Navigation should not require searching filenames.

Separate library audition from timeline insertion. Previewing a footstep does not mutate the session or create an export dependency. Insertion creates a source record, clip and story attachment through the command service. Preview may use an independent monitor path; production routing changes only on insertion.

The take browser shows timing, source, actor/character reference, notes, rating, selection and approval as separate fields. A five-star candidate is not automatically approved. Comparing candidates preserves rejected sources and provides a clearly labelled gain-match option.

For fast replacement, select a cue, audition a take, preview alignment, then commit. Replacing the voice preserves the cue's story identity but reopens editorial approval. Any stretch beyond source handles is explicit; no hidden retiming to force lip sync.

Track/bus UI must expose the destination and processing order. A visible video frame does not prove audio sync: capture device latency and test the exported file independently of the editor.

## Unknowns and acceptance

The benchmark must measure actual steps, take switching, sync after seeks, export alignment and missing-library behaviour. Resolve project/database internals, Fairlight DSP scheduling and the exact installed licence tier are outside this inspection. Soundr's sibling integration is proposed; no Screenwritr, Storytellr or Orchestra adapter has been implemented.
