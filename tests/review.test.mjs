import test from 'node:test';
import assert from 'node:assert/strict';
import { smallProject, testRoot } from './fixtures.mjs';
import { applyCommand } from '../core/commands.mjs';
import { reconform } from '../core/reconform.mjs';
import { validateProject } from '../core/model.mjs';
import { hash, copy } from '../core/util.mjs';
import { createSoundrServer } from '../server/app.mjs';
import { recording } from './fixtures.mjs';
import { decodeWav } from '../core/wav.mjs';
function cutFixture() {
  const { project: p } = smallProject();
  p.durationSamples = 6000;
  p.story.scenes = [{ id: 'scene', name: 'Room', sourceRef: null }];
  p.story.shots = [
    {
      id: 'shot-a',
      name: 'A',
      sceneId: 'scene',
      startFrame: 0,
      durationFrames: 1,
      isPresent: true,
      sourceRef: null,
    },
    {
      id: 'shot-b',
      name: 'B',
      sceneId: 'scene',
      startFrame: 1,
      durationFrames: 1,
      isPresent: true,
      sourceRef: null,
    },
  ];
  p.pictures = ['old', 'new', 'third'].map((key) => ({
    id: 'picture-' + key,
    name: key + '.mp4',
    assetHash: 'a'.repeat(64),
    assetFile: 'a'.repeat(64) + '.mp4',
    frameRate: p.frameRate,
    durationFrames: 3,
    sourceInFrame: 0,
    timelineStartSample: 0,
    cutId: key,
  }));
  p.activePictureId = 'picture-old';
  return p;
}
test('parked sounds keep removed-shot identities through later reconforms', () => {
  const p = cutFixture();
  applyCommand(p, {
    type: 'clip.add',
    sourceId: 'source-test',
    trackId: 'track-effects',
    startSample: 2500,
    sourceInSample: 0,
    durationSamples: 1000,
    lineId: null,
    sceneId: 'scene',
    shotId: 'shot-b',
  });
  const shots = [{ ...p.story.shots[0], durationFrames: 3 }],
    base = hash(p),
    plan = reconform(p, { pictureId: 'picture-new', shots });
  assert.equal(plan.conflicts[0].kind, 'removed-shot');
  assert.equal(hash(p), base);
  const next = reconform(
    p,
    { pictureId: 'picture-new', shots },
    { ['clip:' + p.clips[0].id]: 'park' },
  ).afterProject;
  assert.equal(next.clips[0].enabled, false);
  assert.equal(next.story.shots.find((s) => s.id === 'shot-b').isPresent, false);
  const later = reconform(next, { pictureId: 'picture-third', shots });
  assert.equal(later.unresolved, 0);
  assert.equal(later.afterProject.clips[0].story.shotId, 'shot-b');
  validateProject(later.afterProject);
});
test('unattached audio in a shortened shot needs a resolution; direct imported timing is blocked', () => {
  const p = cutFixture();
  p.story.shots = [{ ...p.story.shots[0], durationFrames: 3 }];
  applyCommand(p, {
    type: 'clip.add',
    sourceId: 'source-test',
    trackId: 'track-effects',
    startSample: 3000,
    sourceInSample: 0,
    durationSamples: 1000,
    lineId: null,
    sceneId: 'scene',
    shotId: null,
  });
  const shots = [{ ...p.story.shots[0], durationFrames: 1 }],
    plan = reconform(p, { pictureId: 'picture-new', shots });
  assert.equal(plan.unresolved, 1);
  assert.equal(plan.conflicts[0].kind, 'unattached-audio');
  const story = copy(p.story);
  story.shots = shots;
  assert.throws(
    () => applyCommand(p, { type: 'story.set', storyProjectId: p.storyProjectId, story }),
    { code: 'PICTURE_CHANGE_REQUIRES_PLAN' },
  );
});
test('private playback API serves real float PCM rather than a download-manager WAV URL', async () => {
  const root = await testRoot(),
    app = await createSoundrServer({ dataRoot: root, port: 0, writeRuntime: false });
  let n = 0;
  try {
    let p = await app.service.create({
      title: 'Playback boundary',
      frameRate: { numerator: 24, denominator: 1 },
      requestId: 'playback-create',
    });
    const input = () => ({
      projectId: p.id,
      expectedRevision: p.revision,
      requestId: 'playback-' + ++n,
    });
    await app.service.store.execute({
      ...input(),
      commands: [
        {
          type: 'project.timing.set',
          durationSamples: 4800,
          frameRate: p.frameRate,
          timelineOrigin: p.timelineOrigin,
        },
      ],
    });
    p = (await app.service.store.inspect(p.id)).project;
    const imported = await app.service.importAsset(
      { ...input(), kind: 'audio', name: 'fixture.wav' },
      recording(),
    );
    p = (await app.service.store.inspect(p.id)).project;
    await app.service.store.execute({
      ...input(),
      commands: [
        {
          type: 'clip.add',
          sourceId: imported.detail.assetId,
          trackId: 'track-effects',
          startSample: 0,
          sourceInSample: 0,
          durationSamples: 4800,
        },
      ],
    });
    p = (await app.service.store.inspect(p.id)).project;
    const response = await fetch(app.url + '/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-soundr-session': app.token },
        body: JSON.stringify({ projectId: p.id, expectedRevision: p.revision }),
      }),
      preview = await response.json();
    assert.match(preview.url, /^\/api\/playback\/[a-f0-9]{64}$/);
    const audio = await fetch(app.url + preview.url, {
      headers: { 'x-soundr-session': app.token },
    });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'application/octet-stream');
    assert.equal(decodeWav(Buffer.from(await audio.arrayBuffer())).frames, 4800);
  } finally {
    await new Promise((r) => app.server.close(r));
  }
});

test('a missing queued render request becomes a terminal failure receipt', async () => {
  const { Renderer } = await import('../server/renderer.mjs'),
    fs = await import('node:fs/promises'),
    path = await import('node:path');
  const root = await testRoot(),
    renderer = new Renderer(root),
    p = smallProject().project;
  const prepared = await renderer.prepare(p, 'missing-request-proof', {
    startSample: 0,
    endSample: 4800,
  });
  await fs.rename(
    path.join(prepared.dir, 'request.json'),
    path.join(prepared.dir, 'request.held.json'),
  );
  renderer.enqueue(prepared.jobId);
  await renderer.tail;
  const status = await renderer.status(prepared.jobId);
  assert.equal(status.status, 'failed');
  assert.equal(status.error.code, 'IO_ERROR');
});

test('fractional reconform accepts its exact rounded endpoint and rejects unsafe timeline origins', () => {
  const p = cutFixture(),
    rate = { numerator: 30000, denominator: 1001 };
  p.frameRate = rate;
  p.durationSamples = 190590;
  for (const pic of p.pictures) {
    pic.frameRate = rate;
    pic.durationFrames = 119;
  }
  p.story.shots = [{ ...p.story.shots[0], durationFrames: 119 }];
  const plan = reconform(p, { pictureId: 'picture-new', shots: copy(p.story.shots) });
  assert.equal(plan.unresolved, 0);
  assert.equal(plan.afterProject.durationSamples, 190590);
  const unsafe = copy(p);
  unsafe.timelineOrigin.sample = Number.MAX_SAFE_INTEGER;
  assert.throws(() => validateProject(unsafe), { code: 'VALIDATION_ERROR' });
  const mismatched = copy(p);
  mismatched.durationSamples++;
  assert.throws(() => validateProject(mismatched), { code: 'VALIDATION_ERROR' });
});
test('a same-cut picture upgrade preserves every edit and never adopts changed timing', () => {
  const p = cutFixture();
  applyCommand(p, {
    type: 'clip.add',
    sourceId: 'source-test',
    trackId: 'track-effects',
    startSample: 500,
    sourceInSample: 0,
    durationSamples: 1000,
    lineId: null,
    sceneId: 'scene',
    shotId: 'shot-a',
  });
  const earlier = copy(p),
    picture = p.pictures[1];
  picture.cutId = p.pictures[0].cutId;
  picture.assetHash = 'b'.repeat(64);
  picture.assetFile = picture.assetHash + '.mp4';
  const edits = hash(p.clips);
  applyCommand(p, { type: 'picture.use', pictureId: picture.id, mode: 'same-cut' });
  assert.equal(p.activePictureId, picture.id);
  assert.equal(hash(p.clips), edits);
  assert.equal(earlier.activePictureId, 'picture-old');
  validateProject(p);
  assert.throws(
    () => applyCommand(p, { type: 'picture.use', pictureId: 'picture-third', mode: 'same-cut' }),
    { code: 'PICTURE_CHANGE_REQUIRES_PLAN' },
  );
  assert.equal(p.activePictureId, picture.id);
});

test('render preflight rejects excessive working memory before allocating scene buffers', async () => {
  const { Renderer } = await import('../server/renderer.mjs'),
    root = await testRoot(),
    p = smallProject().project;
  p.durationSamples = 8640000;
  p.sources = [];
  for (let i = 0; i < 3; i++) {
    p.sources.push({
      id: 'source-large-' + i,
      name: 'Long stereo ' + i,
      assetHash: 'a'.repeat(64),
      assetFile: 'a'.repeat(64) + '.wav',
      sampleRate: 48000,
      channels: 2,
      frames: 8640000,
      peaks: [],
    });
    applyCommand(p, {
      type: 'clip.add',
      sourceId: 'source-large-' + i,
      trackId: 'track-effects',
      startSample: 0,
      sourceInSample: 0,
      durationSamples: 4800,
      lineId: null,
      sceneId: null,
      shotId: null,
    });
  }
  await assert.rejects(
    new Renderer(root).worker({ root, project: p, mode: 'delivery', outputDir: root }),
    { code: 'RESOURCE_LIMIT' },
  );
});
