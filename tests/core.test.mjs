import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from '../core/store.mjs';
import { SoundrService } from '../server/service.mjs';
import { applyCommand } from '../core/commands.mjs';
import { validateProject, newProject } from '../core/model.mjs';
import { renderMix } from '../core/dsp.mjs';
import { decodeWav, encodeWav } from '../core/wav.mjs';
import { frameToSample, sampleToFrame } from '../core/time.mjs';
import { reconform } from '../core/reconform.mjs';
import { adaptStoryGraph, adaptStorytellr } from '../core/adapters.mjs';
import { hash, copy } from '../core/util.mjs';
import { recording, smallProject, testRoot } from './fixtures.mjs';
test('WAV imports preserve PCM and reject truncated/wrong-rate/nonfinite media', () => {
  const bytes = recording(),
    a = decodeWav(bytes);
  assert.equal(a.frames, 4800);
  assert.equal(a.sampleRate, 48000);
  assert.throws(() => decodeWav(bytes.subarray(0, bytes.length - 2)), { code: 'VALIDATION_ERROR' });
  const wrong = Buffer.from(bytes);
  wrong.writeUInt32LE(44100, 24);
  assert.throws(() => decodeWav(wrong), { code: 'UNSUPPORTED_OPERATION' });
  const invalid = encodeWav([new Float32Array([0.1, 0.2])], { float: true });
  invalid.writeFloatLE(NaN, 44);
  assert.throws(() => decodeWav(invalid), { code: 'VALIDATION_ERROR' });
  const bwf = encodeWav(a.channels, { originSample: 172800000 });
  assert.equal(decodeWav(bwf).originSample, 172800000);
});
test('fractional frame conversion rounds absolute positions without cumulative drift', () => {
  const rate = { numerator: 30000, denominator: 1001 };
  assert.equal(frameToSample(1, rate), 1602);
  assert.equal(frameToSample(2, rate), 3203);
  assert.equal(frameToSample(5, rate), 8008);
  for (let f = 0; f < 100000; f += 997) {
    const sample = frameToSample(f, rate);
    assert.ok(Math.abs(sample - (f * 48000 * 1001) / 30000) <= 0.5000001);
    assert.equal(sampleToFrame(sample, rate), f);
  }
  assert.equal(frameToSample(24000, { numerator: 24000, denominator: 1001 }), 48048000);
});
test('splitting inside overlapping fades preserves decoded mix samples exactly', () => {
  const { project: p, audio } = smallProject();
  applyCommand(p, {
    type: 'clip.add',
    sourceId: 'source-test',
    trackId: 'track-effects',
    startSample: 0,
    sourceInSample: 0,
    durationSamples: 4800,
    lineId: null,
    sceneId: null,
    shotId: null,
  });
  const clip = p.clips[0];
  applyCommand(p, {
    type: 'clip.set',
    clipId: clip.id,
    fadeIn: 2400,
    fadeOut: 2400,
    fadeCurve: 'equal-power',
  });
  validateProject(p);
  const sourceMap = new Map([['source-test', audio]]),
    before = renderMix(p, sourceMap)
      .get('bus-master')
      .map((c) => Buffer.from(c.buffer));
  applyCommand(p, { type: 'clip.split', clipId: clip.id, atSample: 1200 });
  validateProject(p);
  const after = renderMix(p, sourceMap)
    .get('bus-master')
    .map((c) => Buffer.from(c.buffer));
  assert.deepEqual(after, before);
  assert.equal(p.clips[1].sourceInSample, 1200);
  assert.equal(p.clips[0].durationSamples + p.clips[1].durationSamples, 4800);
});
test('durable commands are atomic, retry-safe, undoable and reopenable', async () => {
  const root = await testRoot(),
    service = await new SoundrService(root).init(),
    p = await service.store.create('Edits', { numerator: 24, denominator: 1 }),
    bytes = recording();
  const imported = await service.importAsset(
      {
        projectId: p.id,
        expectedRevision: 0,
        requestId: 'import-1',
        kind: 'audio',
        name: 'take.wav',
      },
      bytes,
    ),
    sourceId = imported.detail.assetId;
  const add = {
    projectId: p.id,
    expectedRevision: 1,
    requestId: 'add-1',
    commands: [
      {
        type: 'clip.add',
        sourceId,
        trackId: 'track-effects',
        startSample: 100,
        sourceInSample: 0,
        durationSamples: 4000,
      },
    ],
  };
  const receipt = await service.store.execute(add),
    clipId = receipt.detail.commands[0].clipId;
  assert.equal((await service.store.execute(add)).replayed, true);
  assert.equal((await service.store.inspect(p.id)).project.revision, 2);
  await assert.rejects(
    () =>
      service.store.execute({
        ...add,
        commands: [{ type: 'clip.move', clipIds: [clipId], deltaSamples: 1 }],
      }),
    { code: 'REQUEST_ID_CONFLICT' },
  );
  await assert.rejects(() => service.store.execute({ ...add, requestId: 'stale' }), {
    code: 'REVISION_CONFLICT',
  });
  await assert.rejects(
    () =>
      service.store.execute({
        projectId: p.id,
        expectedRevision: 2,
        requestId: 'atomic-fail',
        commands: [
          { type: 'clip.move', clipIds: [clipId], deltaSamples: 20 },
          { type: 'clip.trim', clipId, side: 'left', amountSamples: 10000 },
        ],
      }),
    { code: 'VALIDATION_ERROR' },
  );
  assert.equal((await service.store.inspect(p.id)).project.clips[0].startSample, 100);
  await service.store.execute({
    projectId: p.id,
    expectedRevision: 2,
    requestId: 'move-1',
    commands: [{ type: 'clip.move', clipIds: [clipId], deltaSamples: 250 }],
  });
  await service.store.execute({
    projectId: p.id,
    expectedRevision: 3,
    requestId: 'undo-1',
    commands: [{ type: 'history.undo' }],
  });
  assert.equal((await service.store.inspect(p.id)).project.clips[0].startSample, 100);
  await service.store.execute({
    projectId: p.id,
    expectedRevision: 4,
    requestId: 'redo-1',
    commands: [{ type: 'history.redo' }],
  });
  await service.store.execute({
    projectId: p.id,
    expectedRevision: 5,
    requestId: 'save-1',
    commands: [{ type: 'project.save', label: 'Save tested' }],
  });
  const reopened = await new ProjectStore(root).inspect(p.id);
  assert.equal(reopened.project.clips[0].startSample, 350);
  assert.equal(reopened.project.sources[0].assetHash, hash(bytes));
  assert.equal(
    hash(await fs.readFile(path.join(root, 'assets', reopened.project.sources[0].assetFile))),
    hash(bytes),
  );
  const restarted = new ProjectStore(root);
  assert.equal((await restarted.execute(add)).replayed, true);
});
test('failed checkpoint commit leaves the prior project and request record intact', async () => {
  const root = await testRoot(),
    store = new ProjectStore(root),
    p = await store.create('Before', { numerator: 24, denominator: 1 });
  store.fault = () => {
    throw new Error('Injected write failure');
  };
  await assert.rejects(() =>
    store.execute({
      projectId: p.id,
      expectedRevision: 0,
      requestId: 'failure',
      commands: [{ type: 'project.set', title: 'After' }],
    }),
  );
  const reopened = await new ProjectStore(root).inspect(p.id);
  assert.equal(reopened.project.title, 'Before');
  assert.equal(reopened.project.revision, 0);
});
test('corrupt current checkpoint recovers a valid previous version with a warning', async () => {
  const root = await testRoot(),
    s = new ProjectStore(root),
    p = await s.create('Before', { numerator: 24, denominator: 1 });
  await s.execute({
    projectId: p.id,
    expectedRevision: 0,
    requestId: 'title-1',
    commands: [{ type: 'project.set', title: 'After' }],
  });
  await fs.writeFile(path.join(s.dir(p.id), 'current.json'), '{broken');
  const result = await new ProjectStore(root).inspect(p.id);
  assert.equal(result.project.title, 'Before');
  assert.equal(result.warnings.length, 1);
});
test('routing cycles fail atomically', async () => {
  const s = new ProjectStore(await testRoot()),
    p = await s.create('Routing', { numerator: 24, denominator: 1 });
  await assert.rejects(
    () =>
      s.execute({
        projectId: p.id,
        expectedRevision: 0,
        requestId: 'cycle',
        commands: [
          {
            type: 'route.set',
            route: {
              id: 'route-cycle-a',
              fromId: 'bus-dialogue',
              toBusId: 'bus-effects',
              tap: 'post-fader',
              gainDb: 0,
            },
          },
          {
            type: 'route.set',
            route: {
              id: 'route-cycle-b',
              fromId: 'bus-effects',
              toBusId: 'bus-dialogue',
              tap: 'post-fader',
              gainDb: 0,
            },
          },
        ],
      }),
    { code: 'ROUTING_CYCLE' },
  );
  assert.equal((await s.inspect(p.id)).project.revision, 0);
});
test('story adapters preserve upstream IDs and avoid character name joins', () => {
  const graph = {
    schema: 'org.icuni.story-graph',
    schemaVersion: 1,
    snapshot: { storyId: 'film-1', updatedAt: 'v1' },
    scenes: [{ id: 'scene-1', heading: 'ROOM', blockIds: ['speaker-1', 'line-1'] }],
    entities: [
      { kind: 'characters', id: 'character-1', name: 'Amenewa', declared: true, inferred: false },
    ],
    blocks: [
      { id: 'speaker-1', type: 'character', text: 'A DIFFERENT DISPLAY LABEL' },
      { id: 'line-1', type: 'dialogue', text: 'Wait for me.' },
    ],
    relationships: [
      { from: 'character-1', to: 'speaker-1', type: 'dialogue-cue', confidence: 'explicit' },
    ],
  };
  const a = adaptStoryGraph(graph);
  assert.equal(a.story.lines[0].id, 'line-1');
  assert.equal(a.story.lines[0].characterId, 'character-1');
  assert.equal(a.storyProjectId, 'film-1');
  const uncertain = adaptStoryGraph({ ...graph, relationships: [] });
  assert.equal(uncertain.story.lines[0].characterId, null);
  assert.equal(uncertain.story.lines[0].reviewRequired, true);
  const st = adaptStorytellr({
    schemaVersion: 2,
    id: 'boards-1',
    fps: 24,
    scenes: [{ id: 'scene-1', name: 'Room' }],
    boards: [
      { id: 'shot-1', sceneId: 'scene-1', name: 'Close', durationFrames: 240 },
      { id: 'shot-2', sceneId: 'scene-1', name: 'Door', durationFrames: 120 },
    ],
  });
  assert.equal(st.shots[1].startFrame, 240);
  assert.equal(st.shots[1].id, 'shot-2');
});
test('reconform preview preserves originals and requires explicit spanning-audio choices', () => {
  const p = newProject('Cut test');
  p.story.scenes = [{ id: 'scene-1', name: 'Room', sourceRef: null }];
  p.story.shots = [
    {
      id: 'shot-1',
      sceneId: 'scene-1',
      name: 'First',
      startFrame: 0,
      durationFrames: 480,
      isPresent: true,
      sourceRef: null,
    },
    {
      id: 'shot-2',
      sceneId: 'scene-1',
      name: 'Second',
      startFrame: 480,
      durationFrames: 1320,
      isPresent: true,
      sourceRef: null,
    },
  ];
  const sha = 'a'.repeat(64);
  p.pictures = [
    {
      id: 'picture-old',
      name: 'Old',
      assetHash: sha,
      assetFile: sha + '.mp4',
      frameRate: p.frameRate,
      durationFrames: 1800,
      sourceInFrame: 0,
      timelineStartSample: 0,
      cutId: 'cut-1',
    },
    {
      id: 'picture-new',
      name: 'New',
      assetHash: sha,
      assetFile: sha + '.mp4',
      frameRate: p.frameRate,
      durationFrames: 1920,
      sourceInFrame: 0,
      timelineStartSample: 0,
      cutId: 'cut-2',
    },
  ];
  p.activePictureId = 'picture-old';
  p.sources = [
    {
      id: 'source-long',
      name: 'Ambience',
      assetHash: sha,
      assetFile: sha + '.wav',
      sampleRate: 48000,
      channels: 1,
      frames: 4320000,
      peaks: [0.1],
    },
    {
      id: 'source-step',
      name: 'Step',
      assetHash: sha,
      assetFile: sha + '.wav',
      sampleRate: 48000,
      channels: 1,
      frames: 48000,
      peaks: [0.1],
    },
  ];
  applyCommand(p, {
    type: 'clip.add',
    sourceId: 'source-long',
    trackId: 'track-ambience',
    startSample: 0,
    sourceInSample: 0,
    durationSamples: 3600000,
    lineId: null,
    sceneId: 'scene-1',
    shotId: null,
  });
  applyCommand(p, {
    type: 'clip.add',
    sourceId: 'source-step',
    trackId: 'track-effects',
    startSample: 1344000,
    sourceInSample: 0,
    durationSamples: 48000,
    lineId: null,
    sceneId: 'scene-1',
    shotId: 'shot-2',
  });
  validateProject(p);
  const before = hash(p),
    shots = [copy(p.story.shots[0]), { ...copy(p.story.shots[1]), startFrame: 600 }];
  const plan = reconform(p, { pictureId: 'picture-new', shots });
  assert.equal(hash(p), before);
  assert.equal(plan.unresolved, 1);
  assert.equal(plan.afterProject.clips[1].startSample, 1584000);
  const resolution = { [plan.conflicts[0].id]: 'extend-to-picture' },
    done = reconform(p, { pictureId: 'picture-new', shots }, resolution);
  assert.equal(done.unresolved, 0);
  assert.equal(done.afterProject.clips[0].durationSamples, 3840000);
  assert.equal(done.afterProject.sources[0].assetHash, sha);
  assert.equal(done.afterProject.activePictureId, 'picture-new');
});
