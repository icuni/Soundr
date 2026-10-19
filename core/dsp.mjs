import { dbToGain, check } from './util.mjs';
import { selectedClips } from './model.mjs';
export const ENGINE_VERSION = 'soundr-dsp-0.2.0';
const stereo = (n) => [new Float32Array(n), new Float32Array(n)];
function envelope(p, kind, ownerId, parameter, base) {
  const a = p.automation.find(
    (a) => a.target.kind === kind && a.target.id === ownerId && a.target.parameter === parameter,
  );
  if (!a || !a.points.length) return () => base;
  const origin =
      a.anchor.type === 'cue' ? p.cues.find((q) => q.id === a.anchor.cueId).startSample : 0,
    points = a.points.map((pt) => ({ sample: pt.sample + origin, value: pt.value }));
  let cursor = 0;
  return (sample) => {
    while (cursor < points.length - 1 && points[cursor + 1].sample <= sample) cursor++;
    if (sample <= points[0].sample) return points[0].value;
    const start = points[cursor],
      end = points[cursor + 1];
    if (!end || a.interpolation === 'step') return start.value;
    return (
      start.value +
      ((end.value - start.value) * (sample - start.sample)) / (end.sample - start.sample)
    );
  };
}
function gainBuffer(buffer, valueAt, pan = 0, muted = false) {
  const left = Math.sqrt(1 - pan),
    right = Math.sqrt(1 + pan);
  let previous = null,
    gain = 0;
  for (let n = 0; n < buffer[0].length; n++) {
    const db = valueAt(n);
    if (db !== previous) {
      gain = muted ? 0 : dbToGain(db);
      previous = db;
    }
    buffer[0][n] *= gain * left;
    buffer[1][n] *= gain * right;
  }
}
function processors(p, owner, buffer) {
  for (const proc of owner.processors) {
    if (!proc.enabled) continue;
    if (proc.type === 'gain') {
      gainBuffer(buffer, envelope(p, 'processor', proc.id, 'gainDb', proc.gainDb));
      continue;
    }
    const freqAt = envelope(p, 'processor', proc.id, 'cutoffHz', proc.cutoffHz),
      qAt = envelope(p, 'processor', proc.id, 'q', proc.q),
      state = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
    let lastF = null,
      lastQ = null,
      b0,
      b1,
      b2,
      a1,
      a2;
    for (let n = 0; n < buffer[0].length; n++) {
      const f = freqAt(n),
        q = qAt(n);
      if (f !== lastF || q !== lastQ) {
        const w = (2 * Math.PI * f) / p.sampleRate,
          cos = Math.cos(w),
          alpha = Math.sin(w) / (2 * q),
          a0 = 1 + alpha;
        b0 = (1 + cos) / 2 / a0;
        b1 = -(1 + cos) / a0;
        b2 = b0;
        a1 = (-2 * cos) / a0;
        a2 = (1 - alpha) / a0;
        lastF = f;
        lastQ = q;
      }
      for (let c = 0; c < 2; c++) {
        const x = buffer[c][n],
          s = state[c],
          y = b0 * x + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3];
        s[1] = s[0];
        s[0] = x;
        s[3] = s[2];
        s[2] = y;
        buffer[c][n] = y;
      }
    }
  }
}
function fadeValue(c, local) {
  const position = local + c.fadeOffsetSamples,
    span = c.fadeSpanSamples;
  let result = 1;
  if (c.fadeIn.samples && position < c.fadeIn.samples) {
    const x = c.fadeIn.samples === 1 ? 0 : position / (c.fadeIn.samples - 1);
    result *= c.fadeIn.curve === 'equal-power' ? Math.sin((x * Math.PI) / 2) : x;
  }
  if (c.fadeOut.samples && position >= span - c.fadeOut.samples) {
    const x = c.fadeOut.samples === 1 ? 0 : (span - 1 - position) / (c.fadeOut.samples - 1);
    result *= c.fadeOut.curve === 'equal-power' ? Math.sin((x * Math.PI) / 2) : x;
  }
  return result;
}
export function renderMix(p, sourceMap, { progress = () => {} } = {}) {
  const n = p.durationSamples,
    allNodes = [...p.tracks, ...p.buses],
    nodes = new Map(allNodes.map((x) => [x.id, x])),
    incoming = new Map(allNodes.map((x) => [x.id, 0])),
    outgoing = new Map(allNodes.map((x) => [x.id, []]));
  for (const r of p.routes) {
    incoming.set(r.toBusId, incoming.get(r.toBusId) + 1);
    outgoing.get(r.fromId).push(r);
  }
  const queue = [...incoming]
      .filter(([, count]) => count === 0)
      .map(([key]) => key)
      .sort(),
    order = [];
  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const r of outgoing.get(node)) {
      incoming.set(r.toBusId, incoming.get(r.toBusId) - 1);
      if (incoming.get(r.toBusId) === 0) {
        queue.push(r.toBusId);
        queue.sort();
      }
    }
  }
  check(order.length === allNodes.length, 'ROUTING_CYCLE', 'Cannot render cyclic routing.');
  const buses = new Map(p.buses.map((b) => [b.id, stereo(n)])),
    clips = selectedClips(p),
    outputs = new Map();
  const route = (owner, buffer, tap) => {
    for (const r of outgoing.get(owner.id)) {
      if (r.tap !== tap) continue;
      const destination = buses.get(r.toBusId),
        g = dbToGain(r.gainDb);
      for (let c = 0; c < 2; c++) for (let s = 0; s < n; s++) destination[c][s] += buffer[c][s] * g;
    }
  };
  for (let at = 0; at < order.length; at++) {
    const owner = nodes.get(order[at]),
      isTrack = p.tracks.some((t) => t.id === owner.id);
    let buffer = isTrack ? stereo(n) : buses.get(owner.id);
    if (isTrack && !owner.muted)
      for (const clip of clips
        .filter((c) => c.trackId === owner.id)
        .sort((a, b) => a.startSample - b.startSample || a.id.localeCompare(b.id))) {
        const source = sourceMap.get(clip.sourceId);
        check(source, 'MEDIA_UNAVAILABLE', 'A required recording is unavailable.', {
          sourceId: clip.sourceId,
        });
        const length = Math.max(0, Math.min(clip.durationSamples, n - clip.startSample)),
          gain = dbToGain(clip.gainDb);
        for (let local = 0; local < length; local++) {
          const sourceAt = clip.sourceInSample + local,
            destination = clip.startSample + local,
            g = gain * fadeValue(clip, local);
          if (source.channels.length === 1) {
            const value = source.channels[0][sourceAt] * g * Math.SQRT1_2;
            buffer[0][destination] += value;
            buffer[1][destination] += value;
          } else {
            buffer[0][destination] += source.channels[0][sourceAt] * g;
            buffer[1][destination] += source.channels[1][sourceAt] * g;
          }
        }
      }
    if (owner.muted) {
      buffer[0].fill(0);
      buffer[1].fill(0);
    }
    processors(p, owner, buffer);
    route(owner, buffer, 'pre-fader');
    gainBuffer(
      buffer,
      envelope(p, isTrack ? 'track' : 'bus', owner.id, 'gainDb', owner.gainDb),
      isTrack ? owner.pan : 0,
      owner.muted,
    );
    route(owner, buffer, 'post-fader');
    if (!isTrack) outputs.set(owner.id, buffer);
    progress({ phase: 'mixing', fraction: (at + 1) / order.length });
  }
  return outputs;
}
export function metrics(channels) {
  let peak = 0,
    square = 0,
    clipped = 0;
  for (const channel of channels)
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      square += value * value;
      if (value < -1 || value > 1 - 1 / 8388608) clipped++;
    }
  const rms = Math.sqrt(square / (channels.length * channels[0].length));
  return {
    peakDbfs: peak ? 20 * Math.log10(peak) : null,
    rmsDbfs: rms ? 20 * Math.log10(rms) : null,
    clippedSamples: clipped,
    integratedLufs: null,
    truePeakDbtp: null,
  };
}
