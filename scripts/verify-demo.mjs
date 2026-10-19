import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ProjectStore } from '../core/store.mjs';
import { decodeWav } from '../core/wav.mjs';
import { hash, id } from '../core/util.mjs';
const APP = fileURLToPath(new URL('../', import.meta.url)),
  root = path.resolve(process.env.SOUNDR_DATA_ROOT || path.join(APP, '.soundr-data')),
  out = path.join(APP, 'output', 'acceptance'),
  exec = promisify(execFile);
await fs.mkdir(out, { recursive: true });
const demo = JSON.parse(await fs.readFile(path.join(root, 'demo.json'), 'utf8')),
  client = new Client({ name: 'soundr-scene-proof', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(APP, 'mcp', 'stdio.mjs'), '--data-root', root],
  stderr: 'pipe',
});
await client.connect(transport);
async function tool(name, args) {
  const raw = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 }),
    data = raw.structuredContent || JSON.parse(raw.content[0].text);
  if (raw.isError) throw Object.assign(new Error(data.error.message), data.error);
  return data;
}
const inspect = async () =>
  (await tool('soundr_inspect_project', { projectId: demo.projectId, detail: 'full' })).project;
const command = async (p, commands) =>
  tool('soundr_apply_commands', {
    projectId: p.id,
    expectedRevision: p.revision,
    requestId: id('proof'),
    commands,
  });
async function render(p) {
  const receipt = await tool('soundr_export_audio', {
    projectId: p.id,
    expectedRevision: p.revision,
    requestId: id('proof-render'),
  });
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = await tool('soundr_render_status', { jobId: receipt.detail.jobId });
    if (status.status === 'failed') throw new Error(JSON.stringify(status.error));
    if (status.status === 'completed') return status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Scene render did not finish.');
}
async function verify(job, p, markers) {
  const manifest = job.manifest,
    base = path.join(root, 'jobs', job.jobId, 'complete');
  assert.equal(manifest.picture.id, p.activePictureId);
  assert.equal(
    manifest.picture.sha256,
    p.pictures.find((x) => x.id === p.activePictureId).assetHash,
  );
  assert.equal(manifest.contentHash, hash(p));
  assert.equal(manifest.outputs.length, 4);
  const waves = {};
  for (const o of manifest.outputs) {
    const bytes = await fs.readFile(path.join(base, o.file));
    assert.equal(hash(bytes), o.sha256);
    const audio = decodeWav(bytes);
    assert.equal(audio.frames, p.durationSamples);
    assert.equal(audio.originSample, p.timelineOrigin.sample);
    assert.equal(audio.channels.length, 2);
    waves[o.role] = audio.channels;
  }
  let delta = 0;
  for (let c = 0; c < 2; c++)
    for (let n = 0; n < p.durationSamples; n++)
      delta = Math.max(
        delta,
        Math.abs(
          waves.master[c][n] - waves.dialogue[c][n] - waves.music[c][n] - waves.effects[c][n],
        ),
      );
  assert.ok(delta <= 4 / 8388608, 'Stem sum exceeded PCM rounding: ' + delta);
  for (const second of markers)
    assert.ok(
      Math.abs(waves.effects[0][second * 48000]) > 0.4,
      'Sync impulse missing at ' + second,
    );
  const audioProbe = JSON.parse(
    (
      await exec(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=sample_rate,channels,bits_per_sample,duration_ts:format_tags=time_reference',
          '-of',
          'json',
          path.join(base, 'master.wav'),
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  assert.equal(audioProbe.streams[0].sample_rate, '48000');
  assert.equal(audioProbe.streams[0].bits_per_sample, 24);
  assert.equal(audioProbe.streams[0].duration_ts, p.durationSamples);
  const picture = p.pictures.find((x) => x.id === p.activePictureId),
    pictureFile = path.join(root, 'assets', picture.assetFile),
    whiteFrames = [];
  for (const second of markers) {
    const result = await exec(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(second),
        '-i',
        pictureFile,
        '-frames:v',
        '1',
        '-vf',
        'scale=1:1',
        '-pix_fmt',
        'gray',
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      { windowsHide: true, encoding: 'buffer' },
    );
    const value = result.stdout[0];
    assert.ok(value > 245, 'White picture sync frame missing at ' + second);
    whiteFrames.push({
      second,
      frame: second * 24,
      grey: value,
      audioImpulse: waves.effects[0][second * 48000],
    });
  }
  return {
    jobId: job.jobId,
    projectRevision: p.revision,
    contentHash: manifest.contentHash,
    frames: p.durationSamples,
    durationSeconds: p.durationSamples / 48000,
    bwfOrigin: p.timelineOrigin.sample,
    stemSumMaxDifference: delta,
    whiteFrames,
    independentProbe: audioProbe,
    outputs: manifest.outputs,
    renderElapsedMs: manifest.elapsedMs,
  };
}
try {
  if (process.argv.includes('--finish')) {
    const prior = JSON.parse(await fs.readFile(path.join(out, 'before-cut.json'), 'utf8'));
    let p = await inspect();
    assert.equal(p.activePictureId, demo.newPictureId);
    assert.equal(p.durationSamples, 80 * 48000);
    assert.equal(p.clips.find((c) => c.name === 'Footstep').startSample, 33 * 48000);
    const revisedHash = hash({ ...p, revision: 0 });
    await command(p, [{ type: 'history.undo' }]);
    let old = await inspect();
    assert.equal(old.activePictureId, demo.oldPictureId);
    assert.equal(old.durationSamples, 75 * 48000);
    assert.equal(old.clips.find((c) => c.name === 'Footstep').startSample, 28 * 48000);
    await command(old, [{ type: 'history.redo' }]);
    p = await inspect();
    assert.equal(hash({ ...p, revision: 0 }), revisedHash);
    const job = await render(p),
      after = await verify(job, p, [0, 33, 55, 75]);
    for (const source of p.sources)
      assert.equal(
        hash(await fs.readFile(path.join(root, 'assets', source.assetFile))),
        source.assetHash,
      );
    const evidence = {
      status: 'passed',
      generatedMedia: true,
      voiceMode: demo.voiceMode,
      before: prior,
      after,
      reviewedCut: {
        oldPictureId: demo.oldPictureId,
        newPictureId: demo.newPictureId,
        footstepBeforeSeconds: 28,
        footstepAfterSeconds: 33,
        spanningRoomAndMusic: 'explicit extension using existing 90-second sources',
        undoRedoVerified: true,
      },
      physicalAVCalibration: 'NOT_RUN',
      realSceneHumanAcceptance: 'NOT_RUN',
      liveSiblingBridges: 'NOT_IMPLEMENTED',
    };
    await fs.writeFile(path.join(out, 'milestone.json'), JSON.stringify(evidence, null, 2));
    console.log(
      '80-second revised delivery, independent sync markers, source hashes and undo/redo verified.',
    );
  } else {
    let p = await inspect();
    assert.equal(p.activePictureId, demo.oldPictureId);
    const footstep = p.clips.find((c) => c.name === 'Footstep');
    const edit = {
      projectId: p.id,
      expectedRevision: p.revision,
      requestId: id('proof-mcp'),
      commands: [{ type: 'clip.set', clipId: footstep.id, gainDb: -1 }],
    };
    await tool('soundr_apply_commands', edit);
    assert.equal((await tool('soundr_apply_commands', edit)).replayed, true);
    p = await inspect();
    await command(p, [{ type: 'project.save', label: 'Saved before reviewed picture update' }]);
    const reopened = (await new ProjectStore(root).inspect(p.id)).project;
    assert.equal(hash(reopened), hash(p));
    console.log(
      'MCP edit, retry and independent disk reopen verified. Rendering the 75-second scene twice…',
    );
    const first = await render(p),
      second = await render(p);
    assert.deepEqual(
      first.manifest.outputs.map((x) => x.sha256),
      second.manifest.outputs.map((x) => x.sha256),
    );
    const before = await verify(first, p, [0, 28, 50, 70]);
    before.repeatJobId = second.jobId;
    before.byteIdenticalRepeatedExport = true;
    before.sourcesUnchanged = true;
    before.uiDialogueGainDb = p.clips.find((c) => c.story.lineId).gainDb;
    before.mcpFootstepGainDb = p.clips.find((c) => c.id === footstep.id).gainDb;
    const plan = await tool('soundr_preview_picture_change', {
      projectId: p.id,
      expectedRevision: p.revision,
      pictureId: demo.newPictureId,
      shots: demo.newShots,
    });
    assert.equal(plan.unresolved, 2);
    assert.equal(hash(await inspect()), hash(p));
    await fs.writeFile(path.join(out, 'before-cut.json'), JSON.stringify(before, null, 2));
    await fs.writeFile(path.join(out, 'change-plan.json'), JSON.stringify(plan, null, 2));
    console.log(
      '75-second repeatable deliveries and read-only change plan verified. Apply the reviewed cut in the UI, then run --finish.',
    );
  }
} finally {
  await client.close();
}
