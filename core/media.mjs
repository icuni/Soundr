import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decodeWav, peaksOf } from './wav.mjs';
import { check, hash, id } from './util.mjs';
import { FRAME_RATES, sameRate } from './time.mjs';
const exec = promisify(execFile);
export const AUDIO_LIMIT = 64 * 1024 * 1024,
  PICTURE_LIMIT = 256 * 1024 * 1024;
export async function scopedFile(root, relative) {
  check(
    typeof relative === 'string' &&
      relative.length < 1024 &&
      !path.isAbsolute(relative) &&
      !relative.split(/[\\/]/).includes('..'),
    'FORBIDDEN',
    'Choose a relative file inside Soundr imports.',
  );
  const base = await fs.realpath(root),
    file = await fs.realpath(path.resolve(base, relative));
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  check(
    fold(file).startsWith(fold(base + path.sep)),
    'FORBIDDEN',
    'File escapes its approved folder.',
  );
  check((await fs.stat(file)).isFile(), 'VALIDATION_ERROR', 'Choose a media file.');
  return file;
}
export async function probePicture(file, frameRate) {
  check(
    FRAME_RATES.some((r) => sameRate(r, frameRate)),
    'UNSUPPORTED_OPERATION',
    'Choose a supported exact frame rate.',
  );
  let output;
  try {
    output = await exec(
      process.env.SOUNDR_FFPROBE || 'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,avg_frame_rate,r_frame_rate,width,height:frame=best_effort_timestamp_time',
        '-show_frames',
        '-of',
        'json',
        file,
      ],
      { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch {
    check(
      false,
      'PICTURE_PROBE_FAILED',
      'FFprobe could not inspect the picture. Install FFmpeg/FFprobe or choose a CFR MP4/WebM proxy.',
    );
  }
  const data = JSON.parse(output.stdout),
    stream = data.streams?.[0],
    frames = data.frames || [];
  check(
    stream && frames.length > 0 && frames.length <= 10801,
    'UNSUPPORTED_OPERATION',
    'Choose a supported picture proxy at most three minutes long.',
  );
  check(
    ['h264', 'vp8', 'vp9', 'av1'].includes(stream.codec_name),
    'UNSUPPORTED_OPERATION',
    'Use H.264 MP4 or VP8/VP9/AV1 WebM picture.',
  );
  check(
    (frames.length * frameRate.denominator) / frameRate.numerator <= 180 + 1e-9,
    'RESOURCE_LIMIT',
    'M1 picture proxies must be at most three minutes long.',
  );
  const period = frameRate.denominator / frameRate.numerator,
    stamps = frames.map((f) => Number(f.best_effort_timestamp_time));
  check(
    stamps.every(Number.isFinite),
    'VALIDATION_ERROR',
    'Picture frame timestamps are unavailable.',
  );
  check(
    Math.abs(stamps[0]) < 0.00001,
    'UNSUPPORTED_OPERATION',
    'Use a zero-origin picture proxy; this container starts at a nonzero timestamp.',
  );
  check(
    stamps.every((stamp, i) => i === 0 || Math.abs(stamp - stamps[i - 1] - period) <= 0.000005),
    'FRAME_RATE_MISMATCH',
    'Picture is variable-rate or differs from the declared frame rate. Use a CFR proxy with its exact rate.',
  );
  return {
    durationFrames: frames.length,
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name,
  };
}
export async function prepareAsset(
  root,
  bytes,
  { kind, name, frameRate, cutId = 'cut-v001', sourceInFrame = 0, timelineStartSample = 0 },
) {
  check(
    Buffer.isBuffer(bytes) &&
      bytes.length > 0 &&
      bytes.length <= (kind === 'audio' ? AUDIO_LIMIT : PICTURE_LIMIT),
    'RESOURCE_LIMIT',
    'Media is empty or exceeds the M1 import size.',
  );
  const digest = hash(bytes),
    dir = path.join(root, 'assets');
  await fs.mkdir(dir, { recursive: true });
  let asset, extension;
  if (kind === 'audio') {
    const decoded = decodeWav(bytes);
    extension = 'wav';
    asset = {
      id: 'source-' + digest.slice(0, 24),
      name: name.slice(0, 250),
      assetHash: digest,
      assetFile: digest + '.wav',
      sampleRate: decoded.sampleRate,
      channels: decoded.channels.length,
      frames: decoded.frames,
      originalTimeReference: decoded.originalTimeReference,
      peaks: peaksOf(decoded),
    };
  } else {
    extension = path.extname(name).slice(1).toLowerCase();
    check(
      ['mp4', 'webm'].includes(extension),
      'UNSUPPORTED_OPERATION',
      'M1 picture import accepts MP4 and WebM.',
    );
    check(
      extension === 'mp4'
        ? bytes.toString('ascii', 4, 8) === 'ftyp'
        : bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
      'VALIDATION_ERROR',
      'Picture container header is invalid.',
    );
    const temp = path.join(dir, id('probe') + '.' + extension);
    await fs.writeFile(temp, bytes, { flag: 'wx' });
    let metadata;
    try {
      metadata = await probePicture(temp, frameRate);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    check(
      Number.isSafeInteger(sourceInFrame) &&
        sourceInFrame >= 0 &&
        sourceInFrame < metadata.durationFrames &&
        Number.isSafeInteger(timelineStartSample) &&
        timelineStartSample >= 0,
      'VALIDATION_ERROR',
      'Invalid picture source/timeline offset.',
    );
    const identity = { digest, frameRate, cutId, sourceInFrame, timelineStartSample };
    asset = {
      id: 'picture-' + hash(identity).slice(0, 24),
      name: name.slice(0, 250),
      assetHash: digest,
      assetFile: digest + '.' + extension,
      frameRate,
      durationFrames: metadata.durationFrames,
      sourceInFrame,
      timelineStartSample,
      cutId,
    };
  }
  const file = path.join(dir, asset.assetFile);
  try {
    const h = await fs.open(file, 'wx', 0o600);
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    check(
      hash(await fs.readFile(file)) === digest,
      'MEDIA_CHANGED',
      'An immutable media copy has changed.',
    );
  }
  return { asset, kind };
}
export async function verifiedAsset(root, asset) {
  const file = await scopedFile(path.join(root, 'assets'), asset.assetFile);
  const bytes = await fs.readFile(file);
  check(
    hash(bytes) === asset.assetHash,
    'MEDIA_CHANGED',
    'A source copy no longer matches its recorded version.',
    { assetId: asset.id },
  );
  return { file, bytes };
}
