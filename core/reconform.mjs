import { check, copy, hash } from './util.mjs';
import { ShotSchema, validateProject, refreshCueRanges } from './model.mjs';
import { frameToSample, MAX_SAMPLES } from './time.mjs';
export function reconform(p, { pictureId, shots }, resolutions = {}) {
  const pic = p.pictures.find((x) => x.id === pictureId);
  check(pic, 'NOT_FOUND', 'New picture revision was not found.');
  const oldPic = p.pictures.find((x) => x.id === p.activePictureId);
  check(oldPic, 'NOT_FOUND', 'Import an initial picture first.');
  const incoming = shots.map((s) => ShotSchema.parse(s));
  check(incoming.length > 0, 'VALIDATION_ERROR', 'An explicit new shot map is required.');
  const seen = new Set();
  for (const s of incoming) {
    check(
      !seen.has(s.id),
      'VALIDATION_ERROR',
      'A shot ID cannot appear twice in a cut map. Use a new ID for a duplicated shot.',
    );
    seen.add(s.id);
    check(
      p.story.scenes.some((x) => x.id === s.sceneId),
      'VALIDATION_ERROR',
      'Shot refers to an unknown scene.',
    );
  }
  const duration =
    pic.timelineStartSample + frameToSample(pic.durationFrames - pic.sourceInFrame, pic.frameRate);
  check(
    duration <= MAX_SAMPLES,
    'UNSUPPORTED_OPERATION',
    'M1 picture edits are limited to three minutes.',
  );
  const ordered = [...incoming].sort((a, b) => a.startFrame - b.startFrame);
  for (let i = 0; i < ordered.length; i++) {
    check(
      frameToSample(ordered[i].startFrame + ordered[i].durationFrames, pic.frameRate) <= duration,
      'VALIDATION_ERROR',
      'New shot extends beyond the picture.',
    );
    if (i)
      check(
        ordered[i - 1].startFrame + ordered[i - 1].durationFrames <= ordered[i].startFrame,
        'VALIDATION_ERROR',
        'New shot ranges overlap.',
      );
  }
  const oldShots = p.story.shots
      .filter((s) => s.isPresent !== false)
      .sort((a, b) => a.startFrame - b.startFrame),
    newById = new Map(incoming.map((s) => [s.id, s]));
  const interval = (s, rate) => ({
    start: frameToSample(s.startFrame, rate),
    end: frameToSample(s.startFrame + s.durationFrames, rate),
  });
  const shift = (s) =>
    frameToSample(newById.get(s.id).startFrame, pic.frameRate) -
    frameToSample(s.startFrame, p.frameRate);
  const after = copy(p),
    changes = [],
    conflicts = [],
    used = new Set();
  function choice(key, label, kind, options, entityId) {
    const selected = resolutions[key];
    if (selected !== undefined) {
      check(options.includes(selected), 'VALIDATION_ERROR', 'Invalid picture-change resolution.', {
        conflictId: key,
      });
      used.add(key);
    }
    conflicts.push({ id: key, kind, label, entityId, options, resolution: selected || null });
    return selected;
  }
  for (const c of after.clips) {
    const before = p.clips.find((x) => x.id === c.id),
      overlaps = oldShots.filter((s) => {
        const r = interval(s, p.frameRate);
        return before.startSample < r.end && before.startSample + before.durationSamples > r.start;
      });
    const old = oldShots.find((s) => s.id === before.story.shotId),
      next = old && newById.get(old.id);
    let decision = null;
    if (!before.enabled) continue;
    if (old && !next)
      decision = choice(
        'clip:' + c.id,
        c.name + ' belongs to a removed shot.',
        'removed-shot',
        ['park', 'keep-absolute'],
        c.id,
      );
    else if (
      overlaps.length > 1 ||
      (old &&
        (before.startSample < interval(old, p.frameRate).start ||
          before.startSample + before.durationSamples > interval(old, p.frameRate).end))
    ) {
      const source = p.sources.find((s) => s.id === c.sourceId),
        options = ['keep-absolute', 'park'];
      if (before.startSample === 0 && before.sourceInSample + duration <= source.frames)
        options.push('extend-to-picture');
      decision = choice(
        'clip:' + c.id,
        c.name + ' spans shot boundaries.',
        'spanning-audio',
        options,
        c.id,
      );
    } else if (old && next) {
      const oldRange = interval(old, p.frameRate),
        newRange = interval(next, pic.frameRate),
        localEnd = before.startSample + before.durationSamples - oldRange.start;
      if (localEnd > newRange.end - newRange.start)
        decision = choice(
          'clip:' + c.id,
          c.name + ' would be cut by the shorter shot.',
          'truncated-audio',
          ['trim', 'follow-with-tail', 'park', 'keep-absolute'],
          c.id,
        );
      else decision = 'follow-shot';
    } else if (
      oldShots.length === 0 ||
      overlaps.some(
        (s) =>
          !newById.has(s.id) ||
          shift(s) !== 0 ||
          frameToSample(s.durationFrames, p.frameRate) !==
            frameToSample(newById.get(s.id).durationFrames, pic.frameRate),
      ) ||
      oldShots.some(
        (s) =>
          newById.has(s.id) &&
          shift(s) !== 0 &&
          before.startSample >= interval(s, p.frameRate).start,
      )
    )
      decision = choice(
        'clip:' + c.id,
        c.name + ' has no shot attachment.',
        'unattached-audio',
        ['keep-absolute', 'park'],
        c.id,
      );
    else decision = 'keep-absolute';
    if (decision === 'park') c.enabled = false;
    if (decision === 'extend-to-picture') {
      c.durationSamples = duration;
      c.fadeOffsetSamples = 0;
      c.fadeSpanSamples = duration;
    }
    if (['follow-shot', 'follow-with-tail', 'trim'].includes(decision)) {
      c.startSample += shift(old);
      if (decision === 'trim') {
        c.durationSamples = Math.max(0, interval(next, pic.frameRate).end - c.startSample);
        check(
          c.durationSamples > 0,
          'UNRESOLVED_CONFLICTS',
          'This trim removes the whole clip. Park it instead.',
        );
        c.fadeOffsetSamples = 0;
        c.fadeSpanSamples = c.durationSamples;
        c.fadeIn.samples = Math.min(c.fadeIn.samples, c.durationSamples);
        c.fadeOut.samples = Math.min(c.fadeOut.samples, c.durationSamples);
      }
    }
    if (
      c.startSample !== before.startSample ||
      c.durationSamples !== before.durationSamples ||
      c.enabled !== before.enabled
    )
      changes.push({
        kind: 'clip',
        id: c.id,
        name: c.name,
        before: {
          startSample: before.startSample,
          durationSamples: before.durationSamples,
          enabled: before.enabled,
        },
        after: {
          startSample: c.startSample,
          durationSamples: c.durationSamples,
          enabled: c.enabled,
        },
        decision,
      });
  }
  refreshCueRanges(after);
  for (const q of after.cues) {
    q.approval = 'needs-review';
    q.approvalRecord = null;
  }
  for (const c of after.clips)
    if (c.anchor.type === 'cue')
      c.anchor.offsetSamples =
        c.startSample - after.cues.find((q) => q.id === c.anchor.cueId).startSample;
  function mappedPoint(sample) {
    const old =
      oldShots.find((s) => {
        const r = interval(s, p.frameRate);
        return sample >= r.start && sample < r.end;
      }) || (sample === p.durationSamples ? oldShots.at(-1) : null);
    if (!old || !newById.has(old.id)) return null;
    const result = sample + shift(old),
      r = interval(newById.get(old.id), pic.frameRate);
    return result <= r.end ? result : null;
  }
  for (const a of after.automation) {
    if (a.anchor.type === 'cue') continue;
    const mapped = a.points.map((pt) => mappedPoint(pt.sample));
    if (
      a.points.some((pt, i) => mapped[i] !== null && mapped[i] !== pt.sample) ||
      mapped.some((x) => x === null)
    ) {
      const options = ['keep-absolute'];
      if (mapped.every((x) => x !== null) && mapped.every((x, i) => i === 0 || x > mapped[i - 1]))
        options.push('follow-shots');
      const decision = choice(
        'automation:' + a.id,
        'Timeline automation ' + a.id + ' intersects the picture change.',
        'absolute-automation',
        options,
        a.id,
      );
      if (decision === 'follow-shots') {
        a.points.forEach((pt, i) => (pt.sample = mapped[i]));
        changes.push({ kind: 'automation', id: a.id, decision });
      }
    }
  }
  for (const key of Object.keys(resolutions))
    check(used.has(key), 'VALIDATION_ERROR', 'Unknown conflict resolution.', { conflictId: key });
  after.activePictureId = pic.id;
  after.frameRate = copy(pic.frameRate);
  after.durationSamples = duration;
  after.story.shots = [
    ...incoming.map((s) => ({ ...s, isPresent: true })),
    ...p.story.shots.filter((s) => !newById.has(s.id)).map((s) => ({ ...s, isPresent: false })),
  ];
  const unresolved = conflicts.filter((c) => !c.resolution).length;
  if (!unresolved) validateProject(after);
  return {
    baseRevision: p.revision,
    baseHash: hash(p),
    oldPictureId: oldPic.id,
    newPictureId: pic.id,
    newDurationSamples: duration,
    changes,
    conflicts,
    unresolved,
    afterProject: after,
  };
}
