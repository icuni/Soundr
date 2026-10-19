import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject } from '../core/model.mjs';
import { encodeWav, decodeWav, peaksOf } from '../core/wav.mjs';
import { hash, id } from '../core/util.mjs';
export const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function testRoot() {
  const root = path.join(APP_ROOT, 'output', 'tests', id('run'));
  await fs.mkdir(root, { recursive: true });
  return root;
}
export function recording(frames = 4800, { mono = true, impulseAt = 500 } = {}) {
  const channels = Array.from({ length: mono ? 1 : 2 }, () => new Float32Array(frames));
  for (let n = 0; n < frames; n++)
    for (let c = 0; c < channels.length; c++)
      channels[c][n] = 0.1 * Math.sin((2 * Math.PI * 440 * n) / 48000);
  for (const channel of channels) channel[impulseAt] = 0.8;
  return encodeWav(channels);
}
export function smallProject(frames = 4800) {
  const p = newProject('Signal test');
  p.durationSamples = frames;
  const bytes = recording(frames),
    audio = decodeWav(bytes);
  p.sources.push({
    id: 'source-test',
    name: 'Owned generated test',
    assetHash: hash(bytes),
    assetFile: hash(bytes) + '.wav',
    sampleRate: 48000,
    channels: audio.channels.length,
    frames,
    peaks: peaksOf(audio),
  });
  return { project: p, bytes, audio };
}
export const blankStory = { characters: [], scenes: [], lines: [], shots: [], imports: [] };
