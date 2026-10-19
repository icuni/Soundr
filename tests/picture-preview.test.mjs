import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SoundrService } from '../server/service.mjs';
import { decodeWav } from '../core/wav.mjs';
import { testRoot } from './fixtures.mjs';
const exec = promisify(execFile);
test('an animatic plays before audio import; an empty delivery fails explicitly', async () => {
  const root = await testRoot(),
    file = path.join(root, 'silent-picture.mp4');
  await exec(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x182a34:s=320x180:r=24',
      '-frames:v',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-an',
      file,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  const service = await new SoundrService(root).init();
  let p = await service.create({
    title: 'Picture before voices',
    frameRate: { numerator: 24, denominator: 1 },
    requestId: 'picture-first-create',
  });
  const imported = await service.importAsset(
    {
      projectId: p.id,
      expectedRevision: 0,
      requestId: 'picture-first-import',
      kind: 'picture',
      name: 'animatic.mp4',
      frameRate: p.frameRate,
    },
    await fs.readFile(file),
  );
  p = (await service.store.inspect(p.id)).project;
  await service.store.execute({
    projectId: p.id,
    expectedRevision: p.revision,
    requestId: 'picture-first-adopt',
    commands: [{ type: 'picture.use', pictureId: imported.detail.assetId, mode: 'initial' }],
  });
  p = (await service.store.inspect(p.id)).project;
  const preview = await service.audioPreview(p.id, p.revision),
    audio = decodeWav(await fs.readFile(preview.file));
  assert.equal(audio.frames, 4000);
  assert.ok(audio.channels.every((c) => c.every((value) => value === 0)));
  assert.deepEqual(preview.manifest.requiredSources, []);
  const receipt = await service.enqueue({
    projectId: p.id,
    expectedRevision: p.revision,
    requestId: 'picture-empty-delivery',
  });
  let status;
  for (let i = 0; i < 300; i++) {
    status = await service.renderer.status(receipt.detail.jobId);
    if (['failed', 'completed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(status.status, 'failed');
  assert.equal(status.error.code, 'MEDIA_UNAVAILABLE');
});
