import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { selectedClips, validateProject } from '../core/model.mjs';
import { verifiedAsset } from '../core/media.mjs';
import { decodeWav, encodeWav } from '../core/wav.mjs';
import { renderMix, metrics, ENGINE_VERSION } from '../core/dsp.mjs';
import { check, hash, id, errorResult } from '../core/util.mjs';
async function run() {
  const { root, project: raw, outputDir, mode, range } = workerData,
    p = validateProject(raw),
    started = performance.now(),
    sourceMap = new Map(),
    active = selectedClips(p).filter((c) => !p.tracks.find((t) => t.id === c.trackId).muted),
    required = [...new Set(active.map((c) => c.sourceId))];
  const estimatedBytes =
    p.durationSamples * (p.tracks.length + p.buses.length + 2) * 2 * 4 +
    required.reduce((bytes, key) => {
      const source = p.sources.find((s) => s.id === key);
      return bytes + source.frames * source.channels * 4 * 2;
    }, 0);
  check(
    estimatedBytes <= 1024 ** 3,
    'RESOURCE_LIMIT',
    'This scene exceeds the M1 render memory budget. Reduce active media or bus count.',
    { estimatedBytes, budgetBytes: 1024 ** 3 },
  );
  check(
    active.length > 0 || (mode === 'preview' && p.activePictureId),
    'MEDIA_UNAVAILABLE',
    'Add a sound or picture before playback; add an enabled sound before export.',
  );
  for (const sourceId of required) {
    const source = p.sources.find((s) => s.id === sourceId);
    let media;
    try {
      media = await verifiedAsset(root, source);
    } catch (error) {
      if (!error.code || error.code === 'ENOENT')
        check(false, 'MEDIA_UNAVAILABLE', 'A required recording is missing.', { sourceId });
      throw error;
    }
    sourceMap.set(sourceId, decodeWav(media.bytes));
  }
  const picture = p.pictures.find((x) => x.id === p.activePictureId);
  if (picture) {
    try {
      await verifiedAsset(root, picture);
    } catch (error) {
      if (error.code === 'ENOENT')
        check(false, 'MEDIA_UNAVAILABLE', 'A referenced picture revision is missing.', {
          pictureId: picture.id,
        });
      throw error;
    }
  }
  const result = renderMix(p, sourceMap, {
    progress: (progress) => parentPort.postMessage({ type: 'progress', ...progress }),
  });
  const begin = range?.startSample || 0,
    end = range?.endSample ?? p.durationSamples;
  check(
    begin >= 0 && end > begin && end <= p.durationSamples,
    'VALIDATION_ERROR',
    'Invalid export range.',
  );
  const stage = path.join(outputDir, 'attempt-' + id('render'));
  await fs.mkdir(stage, { recursive: true });
  const outputs = [];
  const roles = mode === 'preview' ? ['master'] : ['master', 'dialogue', 'music', 'effects'];
  for (const role of roles) {
    const bus = p.buses.find((b) => b.role === role);
    check(bus, 'VALIDATION_ERROR', 'A delivery bus is missing.', { role });
    const buffer = result.get(bus.id).map((c) => c.subarray(begin, end));
    const float = mode === 'preview',
      file = role + (float ? '.float.wav' : '.wav'),
      bytes = encodeWav(buffer, {
        float,
        originSample: p.timelineOrigin.sample + begin,
        description: 'Orama Soundr / ' + hash(p),
      });
    await fs.writeFile(path.join(stage, file), bytes, { flag: 'wx' });
    outputs.push({
      role,
      busId: bus.id,
      file,
      sha256: hash(bytes),
      bytes: bytes.length,
      frames: end - begin,
      sampleRate: p.sampleRate,
      channels: 2,
      bitDepth: float ? 32 : 24,
      encoding: float ? 'float32' : 'pcm_s24le',
      originSample: p.timelineOrigin.sample + begin,
      ...metrics(buffer),
    });
  }
  const warnings = [];
  if (outputs.some((o) => o.clippedSamples))
    warnings.push({
      code: 'CLIPPING',
      message:
        'One or more outputs exceed the selected integer format. Lower clip/track/bus gain and render again.',
    });
  if (p.cues.some((q) => q.approval !== 'approved'))
    warnings.push({
      code: 'UNAPPROVED_CUES',
      message: 'This delivery contains cues that have not been approved.',
    });
  const manifest = {
    schema: 'org.icuni.soundr.delivery',
    schemaVersion: 1,
    purpose: mode,
    status: 'completed',
    projectId: p.id,
    projectRevision: p.revision,
    contentHash: hash(p),
    picture: picture
      ? {
          id: picture.id,
          cutId: picture.cutId,
          sha256: picture.assetHash,
          frameRate: picture.frameRate,
          sourceInFrame: picture.sourceInFrame,
          timelineStartSample: picture.timelineStartSample,
        }
      : null,
    timelineOrigin: p.timelineOrigin,
    range: { startSample: begin, durationSamples: end - begin, tailSamples: 0 },
    processing: {
      engine: ENGINE_VERSION,
      sampleRate: p.sampleRate,
      normalization: 'off',
      dither: 'off',
      panLaw: 'equal-power; mono centre -3 dB',
      masterProcessing: 'master output only; D/M/E tap post category bus, pre master',
      graphHash: hash({
        tracks: p.tracks,
        buses: p.buses,
        routes: p.routes,
        automation: p.automation,
      }),
    },
    requiredSources: required.map((key) => {
      const s = p.sources.find((s) => s.id === key);
      return { id: key, sha256: s.assetHash };
    }),
    includedClips: active
      .filter((c) => c.startSample < end && c.startSample + c.durationSamples > begin)
      .map((c) => c.id),
    renderedClipRanges: active
      .filter((c) => c.startSample < end && c.startSample + c.durationSamples > begin)
      .map((c) => ({
        clipId: c.id,
        startSample: Math.max(begin, c.startSample),
        endSample: Math.min(end, c.startSample + c.durationSamples),
      })),
    omissions: {
      unusedSourceIds: p.sources.filter((s) => !required.includes(s.id)).map((s) => s.id),
      outsideRequestedRangeClipIds: active
        .filter((c) => c.startSample >= end || c.startSample + c.durationSamples <= begin)
        .map((c) => c.id),
      inactiveOrDisabledClipIds: p.clips
        .filter((c) => !active.some((a) => a.id === c.id))
        .map((c) => c.id),
    },
    missingMedia: [],
    missingProcessors: [],
    warnings,
    outputs,
    elapsedMs: Math.round(performance.now() - started),
    loudnessCompliance: 'not measured',
    editorialApproval: null,
  };
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.rename(stage, path.join(outputDir, 'complete'));
  parentPort.postMessage({ type: 'completed', manifest });
}
run().catch((error) => parentPort.postMessage({ type: 'failed', ...errorResult(error) }));
