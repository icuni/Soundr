import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encodeWav, decodeWav } from '../core/wav.mjs';
import { frameToSample } from '../core/time.mjs';
import { hash, id } from '../core/util.mjs';
const APP = fileURLToPath(new URL('../', import.meta.url)),
  root = path.join(APP, '.soundr-data'),
  out = path.join(APP, 'output', 'acceptance'),
  exec = promisify(execFile),
  rate = { numerator: 30000, denominator: 1001 },
  sourceInFrame = 1,
  timelineStartSample = 4800,
  markerFrame = 61;
await fs.mkdir(out, { recursive: true });
const runtime = JSON.parse(await fs.readFile(path.join(root, 'runtime.json'), 'utf8')),
  base = 'http://127.0.0.1:' + runtime.port,
  headers = { 'Content-Type': 'application/json', 'x-soundr-session': runtime.token };
async function api(route, data) {
  const response = await fetch(base + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    result = await response.json();
  assert.ok(response.ok && result.ok !== false, JSON.stringify(result));
  return result;
}
const movie = path.join(out, 'fractional-picture.mp4');
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
    'color=c=0x182a34:s=320x180:r=30000/1001',
    '-vf',
    "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,61)'",
    '-frames:v',
    '120',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '2',
    '-an',
    '-movflags',
    '+faststart',
    movie,
  ],
  { windowsHide: true, timeout: 30000 },
);
const resumeIndex = process.argv.indexOf('--resume');
let p =
  resumeIndex >= 0
    ? (await api('/api/project/' + process.argv[resumeIndex + 1])).project
    : (
        await api('/api/projects', {
          title: 'Fractional timing · generated acceptance',
          frameRate: rate,
          requestId: id('fractional'),
        })
      ).project;
const refresh = async () => (p = (await api('/api/project/' + p.id)).project);
async function upload(bytes, name, kind, extra = {}) {
  const meta = {
      name,
      kind,
      expectedRevision: p.revision,
      requestId: id('fractional-import'),
      ...extra,
    },
    r = await fetch(base + '/api/import/' + p.id, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-soundr-session': runtime.token,
        'x-upload-meta': encodeURIComponent(JSON.stringify(meta)),
      },
      body: bytes,
    }),
    v = await r.json();
  assert.equal(v.ok, true, JSON.stringify(v));
  await refresh();
  return v.detail.assetId;
}
const frames = timelineStartSample + frameToSample(119, rate),
  markerSample = timelineStartSample + frameToSample(markerFrame - sourceInFrame, rate),
  sourceOffset = 24;
if (resumeIndex < 0) {
  const pictureId = await upload(await fs.readFile(movie), 'fractional-picture.mp4', 'picture', {
      frameRate: rate,
      sourceInFrame,
      timelineStartSample,
      cutId: 'cut-fractional-v001',
    }),
    audio = new Float32Array(frames + sourceOffset);
  audio[markerSample + sourceOffset] = 0.8;
  const sourceId = await upload(encodeWav([audio]), 'fractional-sync.wav', 'audio');
  await api('/api/commands', {
    projectId: p.id,
    expectedRevision: p.revision,
    requestId: id('fractional-edit'),
    commands: [
      { type: 'picture.use', pictureId, mode: 'initial' },
      {
        type: 'clip.add',
        sourceId,
        trackId: 'track-effects',
        startSample: 0,
        sourceInSample: sourceOffset,
        durationSamples: frames,
      },
    ],
  });
  await refresh();
}
const verifiedPicture = path.join(
  root,
  'assets',
  p.pictures.find((x) => x.id === p.activePictureId).assetFile,
);
const jobId = (
  await api('/api/render', {
    projectId: p.id,
    expectedRevision: p.revision,
    requestId: id('fractional-render'),
  })
).detail.jobId;
let job;
for (let i = 0; i < 1800; i++) {
  job = await api('/api/jobs/' + jobId);
  if (['completed', 'failed'].includes(job.status)) break;
  await new Promise((r) => setTimeout(r, 100));
}
assert.equal(job.status, 'completed', JSON.stringify(job));
const outputs = job.manifest.outputs,
  rendered = {};
for (const output of outputs) {
  const bytes = await fs.readFile(path.join(root, 'jobs', jobId, 'complete', output.file));
  assert.equal(hash(bytes), output.sha256);
  const d = decodeWav(bytes);
  assert.equal(d.frames, frames);
  assert.equal(d.originSample, 172800000);
  rendered[output.role] = d;
}
const effect = rendered.effects.channels[0];
let maximum = 0,
  actualMarker = -1;
for (let i = 0; i < effect.length; i++)
  if (Math.abs(effect[i]) > maximum) {
    maximum = Math.abs(effect[i]);
    actualMarker = i;
  }
assert.equal(actualMarker, markerSample);
const probe = JSON.parse(
  (
    await exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=best_effort_timestamp_time:stream=avg_frame_rate',
        '-show_frames',
        '-of',
        'json',
        verifiedPicture,
      ],
      { windowsHide: true },
    )
  ).stdout,
);
assert.equal(probe.frames.length, 120);
assert.equal(probe.streams[0].avg_frame_rate, '30000/1001');
const pictureMarker = Number(probe.frames[markerFrame].best_effort_timestamp_time),
  sourceStart = Number(probe.frames[sourceInFrame].best_effort_timestamp_time),
  independentTimelineMarker = timelineStartSample / 48000 + pictureMarker - sourceStart,
  residualSamples = (actualMarker / 48000 - independentTimelineMarker) * 48000;
assert.ok(Math.abs(residualSamples) <= 0.6, 'Fractional offset residual ' + residualSamples);
const evidence = {
  status: 'passed',
  projectId: p.id,
  jobId,
  frameRate: rate,
  sourceInFrame,
  timelineStartSample,
  clipSourceInSample: sourceOffset,
  pictureMarkerFrame: markerFrame,
  pictureMarkerPTS: pictureMarker,
  exportedMarkerSample: actualMarker,
  exportFrames: frames,
  bwfOrigin: 172800000,
  independentTimestampResidualSamples: residualSamples,
  outputs,
};
await fs.writeFile(path.join(out, 'fractional-sync.json'), JSON.stringify(evidence, null, 2));
console.log(
  '29.97 fps picture, explicit source/timeline offsets, clip slip and aligned stems verified; residual ' +
    residualSamples.toFixed(4) +
    ' sample.',
);
