import { z } from 'zod/v4';
import { check, id } from './util.mjs';
import { FRAME_RATES, MAX_SAMPLES, SAMPLE_RATE, sameRate, frameToSample } from './time.mjs';
export const Id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const ProjectId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const N = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Signed = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const Text = z.string().max(10000);
export const Rate = z.strictObject({
  numerator: z.number().int().positive().max(120000),
  denominator: z.number().int().positive().max(1001),
});
const Gain = z.number().min(-120).max(36);
const Sha = z.string().regex(/^[a-f0-9]{64}$/);
const Reference = z.strictObject({
  application: Text,
  projectId: Id,
  entityId: Id,
  revision: Text,
});
const EntityBase = { id: Id, name: Text, sourceRef: Reference.nullable().default(null) };
export const ShotSchema = z.strictObject({
  ...EntityBase,
  sceneId: Id,
  startFrame: N,
  durationFrames: N.min(1),
  isPresent: z.boolean().default(true),
});
export const StorySchema = z.strictObject({
  characters: z.array(z.strictObject(EntityBase)).max(2000),
  scenes: z.array(z.strictObject(EntityBase)).max(2000),
  lines: z
    .array(
      z.strictObject({
        id: Id,
        sceneId: Id,
        characterId: Id.nullable(),
        text: Text,
        reviewRequired: z.boolean(),
        sourceRef: Reference.nullable().default(null),
      }),
    )
    .max(10000),
  shots: z.array(ShotSchema).max(5000),
  imports: z
    .array(z.strictObject({ application: Text, projectId: Id, revision: Text, sha256: Sha }))
    .max(200),
});
const StoryLink = z.strictObject({
  projectId: Id,
  sceneId: Id.nullable(),
  shotId: Id.nullable(),
  characterId: Id.nullable(),
  lineId: Id.nullable(),
});
const Fade = z.strictObject({ samples: N, curve: z.enum(['equal-gain', 'equal-power']) });
const Anchor = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('absolute') }),
  z.strictObject({ type: z.literal('cue'), cueId: Id, offsetSamples: Signed }),
]);
export const ProcessorSchema = z.discriminatedUnion('type', [
  z.strictObject({ id: Id, type: z.literal('gain'), gainDb: Gain, enabled: z.boolean() }),
  z.strictObject({
    id: Id,
    type: z.literal('highpass'),
    cutoffHz: z.number().min(20).max(20000),
    q: z.number().min(0.1).max(10),
    enabled: z.boolean(),
  }),
]);
export const AutomationSchema = z.strictObject({
  id: Id,
  target: z.strictObject({
    kind: z.enum(['track', 'bus', 'processor']),
    id: Id,
    parameter: z.enum(['gainDb', 'cutoffHz', 'q']),
  }),
  anchor: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('timeline') }),
    z.strictObject({ type: z.literal('cue'), cueId: Id }),
  ]),
  interpolation: z.enum(['linear', 'step']),
  points: z.array(z.strictObject({ sample: Signed, value: z.number() })).max(10000),
});
export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(2),
  suite: z.literal('Orama'),
  id: ProjectId,
  title: z.string().min(1).max(250),
  revision: N,
  storyProjectId: Id,
  sampleRate: z.literal(SAMPLE_RATE),
  frameRate: Rate,
  durationSamples: N.min(1).max(MAX_SAMPLES),
  timelineOrigin: z.strictObject({
    sample: N,
    timecode: z.string().regex(/^\d{2}:\d{2}:\d{2}:\d{2}$/),
  }),
  activePictureId: Id.nullable(),
  pictures: z
    .array(
      z.strictObject({
        id: Id,
        name: Text,
        assetHash: Sha,
        assetFile: z.string().regex(/^[a-f0-9]{64}\.(mp4|webm|mov)$/),
        frameRate: Rate,
        durationFrames: N.min(1),
        sourceInFrame: N,
        timelineStartSample: N,
        cutId: Id,
      }),
    )
    .max(200),
  sources: z
    .array(
      z.strictObject({
        id: Id,
        name: Text,
        assetHash: Sha,
        assetFile: z.string().regex(/^[a-f0-9]{64}\.wav$/),
        sampleRate: z.literal(SAMPLE_RATE),
        channels: z.number().int().min(1).max(2),
        frames: N.min(1).max(MAX_SAMPLES),
        originalTimeReference: z.string().regex(/^\d+$/).nullable().optional(),
        peaks: z.array(z.number().min(0).max(100)).max(1024),
      }),
    )
    .max(200),
  story: StorySchema,
  cues: z
    .array(
      z.strictObject({
        id: Id,
        lineId: Id.nullable(),
        startSample: N,
        durationSamples: N.min(1),
        approval: z.enum(['draft', 'needs-review', 'approved', 'rejected']),
        approvalRecord: z
          .strictObject({
            reviewer: Text,
            pictureId: Id.nullable(),
            takeId: Id.nullable(),
            revision: N,
          })
          .nullable()
          .default(null),
        notes: Text,
      }),
    )
    .max(10000),
  takeGroups: z
    .array(
      z.strictObject({
        id: Id,
        cueId: Id,
        selectedTakeId: Id,
        takes: z
          .array(
            z.strictObject({
              id: Id,
              sourceId: Id,
              label: Text,
              rating: z.number().int().min(0).max(5).nullable(),
            }),
          )
          .min(1)
          .max(1000),
      }),
    )
    .max(2000),
  clips: z
    .array(
      z.strictObject({
        id: Id,
        name: Text,
        sourceId: Id,
        trackId: Id,
        startSample: N,
        sourceInSample: N,
        durationSamples: N.min(1),
        gainDb: Gain,
        fadeIn: Fade,
        fadeOut: Fade,
        fadeOffsetSamples: N,
        fadeSpanSamples: N.min(1),
        enabled: z.boolean(),
        takeId: Id.nullable(),
        story: StoryLink,
        anchor: Anchor,
      }),
    )
    .max(5000),
  tracks: z
    .array(
      z.strictObject({
        id: Id,
        name: Text,
        kind: z.enum(['dialogue', 'ambience', 'effects', 'music']),
        gainDb: Gain,
        pan: z.number().min(-1).max(1),
        muted: z.boolean(),
        processors: z.array(ProcessorSchema).max(16),
      }),
    )
    .min(1)
    .max(24),
  buses: z
    .array(
      z.strictObject({
        id: Id,
        name: Text,
        role: z.enum(['dialogue', 'effects', 'music', 'master', 'aux']),
        gainDb: Gain,
        muted: z.boolean(),
        processors: z.array(ProcessorSchema).max(16),
      }),
    )
    .min(1)
    .max(24),
  routes: z
    .array(
      z.strictObject({
        id: Id,
        fromId: Id,
        toBusId: Id,
        tap: z.enum(['pre-fader', 'post-fader']),
        gainDb: Gain,
      }),
    )
    .max(256),
  automation: z.array(AutomationSchema).max(256),
});
export function validateProject(value) {
  const parsed = ProjectSchema.safeParse(value);
  check(parsed.success, 'VALIDATION_ERROR', 'Project data is invalid.', {
    issues: parsed.success
      ? []
      : parsed.error.issues
          .slice(0, 12)
          .map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
  const p = parsed.data;
  check(
    FRAME_RATES.some((f) => sameRate(f, p.frameRate)),
    'UNSUPPORTED_OPERATION',
    'Unsupported picture frame rate.',
  );
  check(
    Number.isSafeInteger(p.timelineOrigin.sample + p.durationSamples),
    'VALIDATION_ERROR',
    'Timeline origin plus duration exceeds safe sample precision.',
  );
  const tc = p.timelineOrigin.timecode.split(':').map(Number);
  check(
    tc[1] < 60 && tc[2] < 60 && tc[3] < Math.round(p.frameRate.numerator / p.frameRate.denominator),
    'VALIDATION_ERROR',
    'Invalid non-drop-frame timecode label.',
  );
  const picture = p.pictures.find((x) => x.id === p.activePictureId);
  if (picture)
    check(
      picture.sourceInFrame < picture.durationFrames &&
        sameRate(p.frameRate, picture.frameRate) &&
        p.durationSamples ===
          picture.timelineStartSample +
            frameToSample(picture.durationFrames - picture.sourceInFrame, picture.frameRate),
      'VALIDATION_ERROR',
      'Active picture timing differs from the saved project timing.',
    );
  const all = [
    ...p.sources,
    ...p.pictures,
    ...p.tracks,
    ...p.buses,
    ...p.clips,
    ...p.cues,
    ...p.takeGroups,
    ...p.routes,
    ...p.automation,
    ...p.story.characters,
    ...p.story.scenes,
    ...p.story.lines,
    ...p.story.shots,
    ...p.tracks.flatMap((t) => t.processors),
    ...p.buses.flatMap((b) => b.processors),
    ...p.takeGroups.flatMap((g) => g.takes),
  ];
  const ids = new Set();
  for (const e of all) {
    check(!ids.has(e.id), 'VALIDATION_ERROR', `Duplicate ID: ${e.id}`);
    ids.add(e.id);
  }
  const map = (a) => new Map(a.map((e) => [e.id, e]));
  const sources = map(p.sources),
    tracks = map(p.tracks),
    buses = map(p.buses),
    cues = map(p.cues),
    scenes = map(p.story.scenes),
    shots = map(p.story.shots),
    characters = map(p.story.characters),
    lines = map(p.story.lines),
    takes = map(p.takeGroups.flatMap((g) => g.takes));
  check(
    p.activePictureId === null || p.pictures.some((x) => x.id === p.activePictureId),
    'VALIDATION_ERROR',
    'Unknown active picture.',
  );
  for (const l of lines.values())
    check(
      scenes.has(l.sceneId) && (!l.characterId || characters.has(l.characterId)),
      'VALIDATION_ERROR',
      'Line has an unknown scene or character.',
    );
  for (const s of shots.values())
    check(scenes.has(s.sceneId), 'VALIDATION_ERROR', 'Shot has an unknown scene.');
  for (const cue of cues.values())
    check(!cue.lineId || lines.has(cue.lineId), 'VALIDATION_ERROR', 'Cue has an unknown line.');
  for (const group of p.takeGroups) {
    check(
      cues.has(group.cueId) && group.takes.some((t) => t.id === group.selectedTakeId),
      'VALIDATION_ERROR',
      'Invalid take group.',
    );
    for (const t of group.takes)
      check(sources.has(t.sourceId), 'VALIDATION_ERROR', 'Take source is missing.');
  }
  for (const c of p.clips) {
    check(
      sources.has(c.sourceId) && tracks.has(c.trackId),
      'VALIDATION_ERROR',
      'Clip source or track is missing.',
    );
    check(
      c.sourceInSample + c.durationSamples <= sources.get(c.sourceId).frames,
      'VALIDATION_ERROR',
      'Clip exceeds its source handles.',
      { clipId: c.id },
    );
    check(
      c.startSample + c.durationSamples <= MAX_SAMPLES,
      'VALIDATION_ERROR',
      'Clip exceeds the three-minute M1 limit.',
    );
    check(
      c.fadeOffsetSamples + c.durationSamples <= c.fadeSpanSamples &&
        c.fadeIn.samples <= c.fadeSpanSamples &&
        c.fadeOut.samples <= c.fadeSpanSamples,
      'VALIDATION_ERROR',
      'Fade exceeds clip duration.',
    );
    check(
      !c.takeId || (takes.has(c.takeId) && takes.get(c.takeId).sourceId === c.sourceId),
      'VALIDATION_ERROR',
      'Invalid clip take.',
    );
    check(
      c.story.projectId === p.storyProjectId,
      'VALIDATION_ERROR',
      'Clip belongs to another story project.',
    );
    for (const [field, index] of [
      ['sceneId', scenes],
      ['shotId', shots],
      ['characterId', characters],
      ['lineId', lines],
    ])
      check(
        c.story[field] === null || index.has(c.story[field]),
        'VALIDATION_ERROR',
        `Unknown story ${field}.`,
      );
    if (c.story.lineId) {
      const l = lines.get(c.story.lineId);
      check(
        l.sceneId === c.story.sceneId && l.characterId === c.story.characterId,
        'VALIDATION_ERROR',
        'Dialogue identity disagrees with its line.',
      );
    }
    if (c.story.shotId)
      check(
        c.story.sceneId === shots.get(c.story.shotId).sceneId,
        'VALIDATION_ERROR',
        'Shot and scene links disagree.',
      );
    if (c.anchor.type === 'cue')
      check(
        cues.has(c.anchor.cueId) &&
          c.startSample === cues.get(c.anchor.cueId).startSample + c.anchor.offsetSamples,
        'VALIDATION_ERROR',
        'Clip cue anchor is inconsistent.',
      );
  }
  const nodes = new Map([...tracks, ...buses]),
    master = p.buses.filter((b) => b.role === 'master');
  check(master.length === 1, 'VALIDATION_ERROR', 'Exactly one master bus is required.');
  const edges = new Map([...nodes.keys()].map((k) => [k, []])),
    edgeKeys = new Set();
  for (const r of p.routes) {
    check(
      nodes.has(r.fromId) && buses.has(r.toBusId) && r.fromId !== master[0].id,
      'VALIDATION_ERROR',
      'Invalid routing endpoint.',
    );
    const k = `${r.fromId}/${r.toBusId}/${r.tap}`;
    check(!edgeKeys.has(k), 'VALIDATION_ERROR', 'Duplicate route.');
    edgeKeys.add(k);
    edges.get(r.fromId).push(r.toBusId);
  }
  const active = new Set(),
    done = new Set();
  function visit(n) {
    check(!active.has(n), 'ROUTING_CYCLE', 'Feedback routing is not supported.');
    if (done.has(n)) return;
    active.add(n);
    edges.get(n).forEach(visit);
    active.delete(n);
    done.add(n);
  }
  nodes.forEach((_, n) => visit(n));
  function reaches(n) {
    return n === master[0].id || edges.get(n).some(reaches);
  }
  for (const t of p.tracks)
    check(reaches(t.id), 'VALIDATION_ERROR', 'Every track must reach the master.');
  const processors = map([...p.tracks, ...p.buses].flatMap((t) => t.processors)),
    targets = new Set();
  for (const a of p.automation) {
    const index =
      a.target.kind === 'processor' ? processors : a.target.kind === 'track' ? tracks : buses;
    check(index.has(a.target.id), 'VALIDATION_ERROR', 'Unknown automation target.');
    const key = `${a.target.kind}/${a.target.id}/${a.target.parameter}`;
    check(!targets.has(key), 'VALIDATION_ERROR', 'Only one envelope per parameter is supported.');
    targets.add(key);
    const owner = index.get(a.target.id),
      ranges =
        a.target.kind === 'processor' && owner.type === 'highpass'
          ? { cutoffHz: [20, 20000], q: [0.1, 10] }
          : { gainDb: [-120, 36] };
    check(ranges[a.target.parameter], 'VALIDATION_ERROR', 'Invalid automation parameter.');
    const origin = a.anchor.type === 'cue' ? cues.get(a.anchor.cueId)?.startSample : 0;
    check(origin !== undefined, 'VALIDATION_ERROR', 'Unknown automation cue.');
    let last = -Infinity;
    for (const pt of a.points) {
      check(
        pt.sample > last && pt.sample + origin >= 0 && pt.sample + origin <= MAX_SAMPLES,
        'VALIDATION_ERROR',
        'Automation times must be ordered and in range.',
      );
      const [lo, hi] = ranges[a.target.parameter];
      check(
        pt.value >= lo && pt.value <= hi,
        'VALIDATION_ERROR',
        'Automation value is out of range.',
      );
      last = pt.sample;
    }
  }
  return p;
}
export function newProject(
  title = 'Untitled sound project',
  frameRate = { numerator: 24, denominator: 1 },
) {
  const p = {
    schemaVersion: 2,
    suite: 'Orama',
    id: id('project'),
    title,
    revision: 0,
    storyProjectId: id('story'),
    sampleRate: SAMPLE_RATE,
    frameRate,
    durationSamples: SAMPLE_RATE * 75,
    timelineOrigin: { sample: SAMPLE_RATE * 3600, timecode: '01:00:00:00' },
    activePictureId: null,
    pictures: [],
    sources: [],
    story: { characters: [], scenes: [], lines: [], shots: [], imports: [] },
    cues: [],
    takeGroups: [],
    clips: [],
    automation: [],
    tracks: [],
    buses: [],
    routes: [],
  };
  for (const kind of ['dialogue', 'ambience', 'effects', 'music'])
    p.tracks.push({
      id: `track-${kind}`,
      name: kind[0].toUpperCase() + kind.slice(1),
      kind,
      gainDb: 0,
      pan: 0,
      muted: false,
      processors: [],
    });
  for (const role of ['dialogue', 'music', 'effects', 'master'])
    p.buses.push({
      id: `bus-${role}`,
      name: role[0].toUpperCase() + role.slice(1),
      role,
      gainDb: 0,
      muted: false,
      processors: [],
    });
  for (const kind of ['dialogue', 'ambience', 'effects', 'music'])
    p.routes.push({
      id: `route-${kind}`,
      fromId: `track-${kind}`,
      toBusId: `bus-${kind === 'ambience' ? 'effects' : kind}`,
      tap: 'post-fader',
      gainDb: 0,
    });
  for (const role of ['dialogue', 'music', 'effects'])
    p.routes.push({
      id: `route-${role}-master`,
      fromId: `bus-${role}`,
      toBusId: 'bus-master',
      tap: 'post-fader',
      gainDb: 0,
    });
  return validateProject(p);
}
export function selectedClips(p) {
  const selected = new Set(p.takeGroups.map((g) => g.selectedTakeId));
  return p.clips.filter((c) => c.enabled && (!c.takeId || selected.has(c.takeId)));
}
export function refreshCueRanges(p) {
  const selected = new Set(p.takeGroups.map((g) => g.selectedTakeId));
  for (const q of p.cues) {
    const clips = p.clips.filter(
      (c) =>
        c.enabled && selected.has(c.takeId) && c.anchor.type === 'cue' && c.anchor.cueId === q.id,
    );
    if (clips.length) {
      q.startSample = Math.min(...clips.map((c) => c.startSample));
      q.durationSamples =
        Math.max(...clips.map((c) => c.startSample + c.durationSamples)) - q.startSample;
    }
  }
  for (const c of p.clips)
    if (c.anchor.type === 'cue') {
      const q = p.cues.find((q) => q.id === c.anchor.cueId);
      if (q) c.anchor.offsetSamples = c.startSample - q.startSample;
    }
}
export function invalidateApprovals(p) {
  for (const c of p.cues) if (c.approval === 'approved') c.approval = 'needs-review';
}
