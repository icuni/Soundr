import { z } from 'zod/v4';
import { AutomationSchema, Id, ProcessorSchema, ProjectId, Rate, StorySchema } from './model.mjs';
import { check, copy, id, hash } from './util.mjs';
import { frameToSample, sameRate } from './time.mjs';
const N = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  S = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  Gain = z.number().min(-120).max(36);
const command = (type, fields = {}) => z.strictObject({ type: z.literal(type), ...fields });
export const CommandSchema = z.discriminatedUnion('type', [
  command('project.timing.set', {
    durationSamples: N.min(1).max(8640000),
    frameRate: Rate,
    timelineOrigin: z.strictObject({
      sample: N,
      timecode: z.string().regex(/^\d{2}:\d{2}:\d{2}:\d{2}$/),
    }),
  }),
  command('project.set', { title: z.string().min(1).max(250) }),
  command('story.set', { storyProjectId: Id, story: StorySchema }),
  command('clip.add', {
    sourceId: Id,
    trackId: Id,
    startSample: N,
    sourceInSample: N,
    durationSamples: N.min(1),
    name: z.string().max(250).optional(),
    lineId: Id.nullable().default(null),
    sceneId: Id.nullable().default(null),
    shotId: Id.nullable().default(null),
  }),
  command('clip.move', { clipIds: z.array(Id).min(1).max(200), deltaSamples: S }),
  command('clip.trim', { clipId: Id, side: z.enum(['left', 'right']), amountSamples: S }),
  command('clip.slip', { clipId: Id, deltaSamples: S }),
  command('clip.split', { clipId: Id, atSample: N }),
  command('clip.duplicate', { clipId: Id, deltaSamples: S }),
  command('clip.set', {
    clipId: Id,
    gainDb: Gain.optional(),
    enabled: z.boolean().optional(),
    name: z.string().max(250).optional(),
    fadeIn: N.optional(),
    fadeOut: N.optional(),
    fadeCurve: z.enum(['equal-gain', 'equal-power']).optional(),
  }),
  command('clip.link', {
    clipId: Id,
    lineId: Id.nullable(),
    sceneId: Id.nullable().default(null),
    shotId: Id.nullable().default(null),
  }),
  command('take.add', { groupId: Id, sourceId: Id, label: z.string().max(250) }),
  command('take.select', { groupId: Id, takeId: Id }),
  command('cue.approve', {
    cueId: Id,
    status: z.enum(['draft', 'needs-review', 'approved', 'rejected']),
    reviewer: z.string().min(1).max(160),
  }),
  command('track.set', {
    trackId: Id,
    gainDb: Gain.optional(),
    pan: z.number().min(-1).max(1).optional(),
    muted: z.boolean().optional(),
  }),
  command('bus.set', { busId: Id, gainDb: Gain.optional(), muted: z.boolean().optional() }),
  command('processor.set', { ownerId: Id, processor: ProcessorSchema }),
  command('route.set', {
    route: z.strictObject({
      id: Id,
      fromId: Id,
      toBusId: Id,
      tap: z.enum(['pre-fader', 'post-fader']),
      gainDb: Gain,
    }),
  }),
  command('automation.set', { automation: AutomationSchema }),
  command('picture.use', { pictureId: Id, mode: z.enum(['initial', 'same-cut']) }),
  command('history.undo'),
  command('history.redo'),
  command('project.save', { label: z.string().max(160).default('Saved version') }),
]);
export const EnvelopeSchema = z.strictObject({
  projectId: ProjectId,
  expectedRevision: N,
  requestId: Id,
  commands: z.array(CommandSchema).min(1).max(100),
});
const find = (array, key, label) => {
  const e = array.find((x) => x.id === key);
  check(e, 'NOT_FOUND', (label || 'Entity') + ' was not found.', { id: key });
  return e;
};
const upsert = (array, item) => {
  const at = array.findIndex((e) => e.id === item.id);
  if (at < 0) array.push(item);
  else array[at] = item;
};
const faded = (clip) => {
  clip.fadeOffsetSamples = 0;
  clip.fadeSpanSamples = clip.durationSamples;
  clip.fadeIn.samples = Math.min(clip.fadeIn.samples, clip.durationSamples);
  clip.fadeOut.samples = Math.min(clip.fadeOut.samples, clip.durationSamples);
};
const anchor = (p, c) => {
  if (c.anchor.type === 'cue')
    c.anchor.offsetSamples = c.startSample - find(p.cues, c.anchor.cueId).startSample;
};
const review = (p, c) => {
  if (c.anchor.type === 'cue') {
    const q = find(p.cues, c.anchor.cueId);
    q.approval = 'needs-review';
    q.approvalRecord = null;
  }
};
function link(p, c, args) {
  const line = args.lineId ? find(p.story.lines, args.lineId, 'Dialogue line') : null;
  c.story = {
    projectId: p.storyProjectId,
    sceneId: line?.sceneId || args.sceneId,
    shotId: args.shotId,
    characterId: line?.characterId || null,
    lineId: line?.id || null,
  };
}
export function applyCommand(p, c) {
  const changed = [];
  let detail = {};
  switch (c.type) {
    case 'project.timing.set':
      check(
        p.activePictureId === null,
        'PICTURE_CHANGE_REQUIRES_PLAN',
        'Use a reviewed picture change for an existing cut.',
      );
      p.durationSamples = c.durationSamples;
      p.frameRate = copy(c.frameRate);
      p.timelineOrigin = copy(c.timelineOrigin);
      break;
    case 'project.set':
      p.title = c.title;
      break;
    case 'story.set': {
      const cutMap = (shots) =>
        shots
          .filter((s) => s.isPresent !== false)
          .map((s) => ({
            id: s.id,
            sceneId: s.sceneId,
            startFrame: s.startFrame,
            durationFrames: s.durationFrames,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
      if (p.activePictureId && p.story.shots.length)
        check(
          hash(cutMap(p.story.shots)) === hash(cutMap(c.story.shots)),
          'PICTURE_CHANGE_REQUIRES_PLAN',
          'The imported shot timing differs from the current cut. Use a reviewed picture-change plan.',
        );
      if (p.storyProjectId !== c.storyProjectId) {
        check(
          p.clips.every(
            (x) => !x.story.sceneId && !x.story.shotId && !x.story.lineId && !x.story.characterId,
          ),
          'STORY_PROJECT_MISMATCH',
          'This session already links another story project. Import the matching story snapshot.',
        );
        for (const clip of p.clips) clip.story.projectId = c.storyProjectId;
      }
      p.storyProjectId = c.storyProjectId;
      p.story = copy(c.story);
      for (const q of p.cues) {
        q.approval = 'needs-review';
        q.approvalRecord = null;
      }
      break;
    }
    case 'clip.add': {
      const source = find(p.sources, c.sourceId, 'Recording'),
        track = find(p.tracks, c.trackId, 'Track');
      const item = {
        id: id('clip'),
        name: c.name || source.name,
        sourceId: c.sourceId,
        trackId: c.trackId,
        startSample: c.startSample,
        sourceInSample: c.sourceInSample,
        durationSamples: c.durationSamples,
        gainDb: 0,
        enabled: true,
        fadeIn: { samples: 0, curve: 'equal-gain' },
        fadeOut: { samples: 0, curve: 'equal-gain' },
        fadeOffsetSamples: 0,
        fadeSpanSamples: c.durationSamples,
        takeId: null,
        story: {
          projectId: p.storyProjectId,
          sceneId: null,
          shotId: null,
          characterId: null,
          lineId: null,
        },
        anchor: { type: 'absolute' },
      };
      link(p, item, c);
      if (track.kind === 'dialogue') {
        const cue = {
          id: id('cue'),
          lineId: item.story.lineId,
          startSample: item.startSample,
          durationSamples: item.durationSamples,
          approval: 'draft',
          approvalRecord: null,
          notes: '',
        };
        p.cues.push(cue);
        const take = { id: id('take'), sourceId: source.id, label: item.name, rating: null };
        p.takeGroups.push({
          id: id('group'),
          cueId: cue.id,
          selectedTakeId: take.id,
          takes: [take],
        });
        item.takeId = take.id;
        item.anchor = { type: 'cue', cueId: cue.id, offsetSamples: 0 };
      }
      p.clips.push(item);
      changed.push(item.id);
      detail = { clipId: item.id };
      break;
    }
    case 'clip.move':
      for (const clipId of new Set(c.clipIds)) {
        const clip = find(p.clips, clipId, 'Clip');
        clip.startSample += c.deltaSamples;
        anchor(p, clip);
        review(p, clip);
        changed.push(clip.id);
      }
      break;
    case 'clip.trim': {
      const clip = find(p.clips, c.clipId, 'Clip');
      if (c.side === 'left') {
        clip.startSample += c.amountSamples;
        clip.sourceInSample += c.amountSamples;
      }
      clip.durationSamples -= c.amountSamples;
      faded(clip);
      anchor(p, clip);
      review(p, clip);
      changed.push(clip.id);
      break;
    }
    case 'clip.slip': {
      const clip = find(p.clips, c.clipId);
      clip.sourceInSample += c.deltaSamples;
      review(p, clip);
      changed.push(clip.id);
      break;
    }
    case 'clip.split': {
      const left = find(p.clips, c.clipId),
        d = c.atSample - left.startSample;
      check(
        d > 0 && d < left.durationSamples,
        'VALIDATION_ERROR',
        'Split must fall inside the clip.',
      );
      const right = copy(left);
      right.id = id('clip');
      right.name = left.name + ' / 2';
      right.startSample += d;
      right.sourceInSample += d;
      right.durationSamples -= d;
      right.fadeOffsetSamples += d;
      left.durationSamples = d;
      anchor(p, right);
      review(p, left);
      p.clips.push(right);
      changed.push(left.id, right.id);
      detail = { leftId: left.id, rightId: right.id };
      break;
    }
    case 'clip.duplicate': {
      const original = find(p.clips, c.clipId);
      check(
        !original.takeId,
        'UNSUPPORTED_OPERATION',
        'Duplicate ordinary effects/music clips; use Add take for dialogue.',
      );
      const clip = copy(original);
      clip.id = id('clip');
      clip.startSample += c.deltaSamples;
      anchor(p, clip);
      p.clips.push(clip);
      changed.push(clip.id);
      detail = { clipId: clip.id };
      break;
    }
    case 'clip.set': {
      const clip = find(p.clips, c.clipId);
      for (const key of ['gainDb', 'enabled', 'name']) if (c[key] !== undefined) clip[key] = c[key];
      if (c.fadeIn !== undefined || c.fadeOut !== undefined || c.fadeCurve) {
        faded(clip);
        if (c.fadeIn !== undefined) clip.fadeIn.samples = c.fadeIn;
        if (c.fadeOut !== undefined) clip.fadeOut.samples = c.fadeOut;
        if (c.fadeCurve) {
          clip.fadeIn.curve = c.fadeCurve;
          clip.fadeOut.curve = c.fadeCurve;
        }
      }
      review(p, clip);
      changed.push(clip.id);
      break;
    }
    case 'clip.link': {
      const clip = find(p.clips, c.clipId),
        group = p.takeGroups.find((g) => g.takes.some((t) => t.id === clip.takeId));
      const targets = group
        ? p.clips.filter((x) => group.takes.some((t) => t.id === x.takeId))
        : [clip];
      for (const target of targets) {
        link(p, target, c);
        review(p, target);
        changed.push(target.id);
      }
      if (group) find(p.cues, group.cueId).lineId = c.lineId;
      break;
    }
    case 'take.add': {
      const g = find(p.takeGroups, c.groupId),
        source = find(p.sources, c.sourceId),
        base = p.clips.find((x) => x.takeId === g.selectedTakeId),
        q = find(p.cues, g.cueId);
      check(base, 'NOT_FOUND', 'Selected take clip is unavailable.');
      const take = {
          id: id('take'),
          sourceId: source.id,
          label: c.label || source.name,
          rating: null,
        },
        clip = copy(base);
      clip.id = id('clip');
      clip.name = take.label;
      clip.sourceId = source.id;
      clip.sourceInSample = 0;
      clip.startSample = q.startSample;
      clip.durationSamples = Math.min(q.durationSamples, source.frames);
      clip.takeId = take.id;
      clip.gainDb = 0;
      clip.enabled = true;
      faded(clip);
      anchor(p, clip);
      g.takes.push(take);
      p.clips.push(clip);
      changed.push(clip.id, g.id);
      detail = { clipId: clip.id, takeId: take.id, selected: false };
      break;
    }
    case 'take.select': {
      const g = find(p.takeGroups, c.groupId);
      check(
        g.takes.some((t) => t.id === c.takeId),
        'NOT_FOUND',
        'Take is not in this group.',
      );
      g.selectedTakeId = c.takeId;
      const q = find(p.cues, g.cueId);
      q.approval = 'needs-review';
      q.approvalRecord = null;
      changed.push(g.id, q.id);
      break;
    }
    case 'cue.approve': {
      const q = find(p.cues, c.cueId);
      q.approval = c.status;
      q.approvalRecord =
        c.status === 'approved'
          ? {
              reviewer: c.reviewer,
              pictureId: p.activePictureId,
              takeId: p.takeGroups.find((g) => g.cueId === q.id)?.selectedTakeId || null,
              revision: p.revision + 1,
            }
          : null;
      changed.push(q.id);
      break;
    }
    case 'track.set':
    case 'bus.set': {
      const owner = c.type === 'track.set' ? find(p.tracks, c.trackId) : find(p.buses, c.busId);
      for (const key of ['gainDb', 'pan', 'muted']) if (c[key] !== undefined) owner[key] = c[key];
      changed.push(owner.id);
      break;
    }
    case 'processor.set': {
      const owner = find([...p.tracks, ...p.buses], c.ownerId);
      upsert(owner.processors, copy(c.processor));
      changed.push(c.processor.id);
      break;
    }
    case 'route.set':
      upsert(p.routes, copy(c.route));
      changed.push(c.route.id);
      break;
    case 'automation.set':
      upsert(p.automation, copy(c.automation));
      changed.push(c.automation.id);
      break;
    case 'picture.use': {
      const pic = find(p.pictures, c.pictureId, 'Picture revision'),
        old = p.pictures.find((x) => x.id === p.activePictureId);
      if (old)
        check(
          c.mode === 'same-cut' &&
            old.cutId === pic.cutId &&
            sameRate(old.frameRate, pic.frameRate) &&
            old.durationFrames === pic.durationFrames &&
            old.sourceInFrame === pic.sourceInFrame &&
            old.timelineStartSample === pic.timelineStartSample,
          'PICTURE_CHANGE_REQUIRES_PLAN',
          'Timing changed. Preview a picture-change plan first.',
        );
      else
        check(
          c.mode === 'initial',
          'VALIDATION_ERROR',
          'Choose initial picture for the first import.',
        );
      p.activePictureId = pic.id;
      p.frameRate = copy(pic.frameRate);
      p.durationSamples =
        pic.timelineStartSample +
        frameToSample(pic.durationFrames - pic.sourceInFrame, pic.frameRate);
      for (const q of p.cues) {
        if (q.approval === 'approved') q.approval = 'needs-review';
        q.approvalRecord = null;
      }
      changed.push(pic.id);
      break;
    }
    default:
      check(false, 'UNSUPPORTED_OPERATION', 'This command requires the history or save service.');
  }
  return { changedIds: changed, detail };
}
