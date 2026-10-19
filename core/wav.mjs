import { check } from './util.mjs';
import { SAMPLE_RATE, MAX_SAMPLES } from './time.mjs';
export function decodeWav(bytes) {
  check(
    bytes.length >= 44 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WAVE',
    'UNSUPPORTED_OPERATION',
    'Import a PCM or float WAV recording.',
  );
  const end = bytes.readUInt32LE(4) + 8;
  check(end <= bytes.length && end >= 44, 'VALIDATION_ERROR', 'The WAV container is truncated.');
  let fmt = null,
    data = null,
    origin = null;
  for (let offset = 12; offset + 8 <= end;) {
    const tag = bytes.toString('ascii', offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    check(start + size <= end, 'VALIDATION_ERROR', 'The WAV chunk is truncated.');
    if (tag === 'fmt ') {
      check(size >= 16, 'VALIDATION_ERROR', 'Invalid WAV format.');
      let encoding = bytes.readUInt16LE(start);
      if (encoding === 65534) {
        check(size >= 40, 'UNSUPPORTED_OPERATION', 'Unsupported extended WAV format.');
        encoding = bytes.readUInt16LE(start + 24);
      }
      fmt = {
        encoding,
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        blockAlign: bytes.readUInt16LE(start + 12),
        bits: bytes.readUInt16LE(start + 14),
      };
    }
    if (tag === 'data') {
      check(data === null, 'UNSUPPORTED_OPERATION', 'Multiple WAV data chunks are not supported.');
      data = bytes.subarray(start, start + size);
    }
    if (tag === 'bext' && size >= 346) origin = bytes.readBigUInt64LE(start + 338);
    offset = start + size + (size % 2);
  }
  check(fmt && data, 'VALIDATION_ERROR', 'WAV audio data is missing.');
  check(
    fmt.sampleRate === SAMPLE_RATE,
    'UNSUPPORTED_OPERATION',
    'M1 accepts 48 kHz audio. Convert a copy to 48 kHz before import.',
  );
  check(
    fmt.channels === 1 || fmt.channels === 2,
    'UNSUPPORTED_OPERATION',
    'M1 accepts mono and stereo audio.',
  );
  check(
    (fmt.encoding === 1 && [16, 24, 32].includes(fmt.bits)) ||
      (fmt.encoding === 3 && fmt.bits === 32),
    'UNSUPPORTED_OPERATION',
    'Use 16/24/32-bit PCM or 32-bit float WAV.',
  );
  const step = fmt.bits / 8;
  check(
    fmt.blockAlign === step * fmt.channels && data.length % fmt.blockAlign === 0,
    'VALIDATION_ERROR',
    'Invalid WAV sample alignment.',
  );
  const frames = data.length / fmt.blockAlign;
  check(
    frames > 0 && frames <= MAX_SAMPLES,
    'UNSUPPORTED_OPERATION',
    'M1 audio sources must be at most three minutes long.',
  );
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let n = 0; n < frames; n++)
    for (let c = 0; c < fmt.channels; c++) {
      const at = n * fmt.blockAlign + c * step;
      let value;
      if (fmt.encoding === 3) value = data.readFloatLE(at);
      else if (fmt.bits === 16) value = data.readInt16LE(at) / 32768;
      else if (fmt.bits === 24) value = data.readIntLE(at, 3) / 8388608;
      else value = data.readInt32LE(at) / 2147483648;
      check(
        Number.isFinite(value) && Math.abs(value) <= 100,
        'VALIDATION_ERROR',
        'WAV contains invalid or excessive sample values.',
      );
      channels[c][n] = value;
    }
  return {
    sampleRate: fmt.sampleRate,
    channels,
    frames,
    originSample:
      origin !== null && origin <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(origin) : null,
    originalTimeReference: origin === null ? null : String(origin),
  };
}
export function peaksOf(audio, count = 512) {
  const out = [];
  const span = Math.max(1, Math.ceil(audio.frames / count));
  for (let a = 0; a < audio.frames; a += span) {
    let peak = 0;
    for (let n = a; n < Math.min(audio.frames, a + span); n++)
      for (const c of audio.channels) peak = Math.max(peak, Math.abs(c[n]));
    out.push(peak);
  }
  return out;
}
export function encodeWav(
  channels,
  {
    sampleRate = SAMPLE_RATE,
    float = false,
    originSample = null,
    description = 'Orama Soundr',
  } = {},
) {
  const count = channels.length,
    frames = channels[0].length,
    step = float ? 4 : 3,
    size = frames * count * step,
    pad = size % 2;
  check(
    channels.every((c) => c.length === frames),
    'VALIDATION_ERROR',
    'Output channel lengths disagree.',
  );
  const bext = originSample === null ? 0 : 610,
    body = Buffer.alloc(44 + bext + size + pad);
  body.write('RIFF', 0);
  body.writeUInt32LE(body.length - 8, 4);
  body.write('WAVE', 8);
  let at = 12;
  if (bext) {
    body.write('bext', at);
    body.writeUInt32LE(602, at + 4);
    body.write(description.slice(0, 250), at + 8, 'utf8');
    body.write('Orama Soundr', at + 8 + 256, 'ascii');
    body.writeBigUInt64LE(BigInt(originSample), at + 8 + 338);
    body.writeUInt16LE(1, at + 8 + 346);
    at += 610;
  }
  body.write('fmt ', at);
  body.writeUInt32LE(16, at + 4);
  body.writeUInt16LE(float ? 3 : 1, at + 8);
  body.writeUInt16LE(count, at + 10);
  body.writeUInt32LE(sampleRate, at + 12);
  body.writeUInt32LE(sampleRate * count * step, at + 16);
  body.writeUInt16LE(count * step, at + 20);
  body.writeUInt16LE(step * 8, at + 22);
  at += 24;
  body.write('data', at);
  body.writeUInt32LE(size, at + 4);
  at += 8;
  for (let n = 0; n < frames; n++)
    for (let c = 0; c < count; c++) {
      const value = channels[c][n];
      check(Number.isFinite(value), 'RENDER_ERROR', 'Nonfinite output sample.');
      if (float) body.writeFloatLE(value, at);
      else
        body.writeIntLE(
          Math.round(Math.min(1 - 1 / 8388608, Math.max(-1, value)) * 8388608),
          at,
          3,
        );
      at += step;
    }
  return body;
}
