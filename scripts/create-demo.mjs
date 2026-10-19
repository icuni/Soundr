import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encodeWav } from '../core/wav.mjs';
import { id } from '../core/util.mjs';
const APP = fileURLToPath(new URL('../', import.meta.url)),
  root = path.resolve(process.env.SOUNDR_DATA_ROOT || path.join(APP, '.soundr-data')),
  exec = promisify(execFile);
async function main() {
  const runtime = JSON.parse(await fs.readFile(path.join(root, 'runtime.json'), 'utf8')),
    url = 'http://127.0.0.1:' + runtime.port,
    headers = { 'Content-Type': 'application/json', 'x-soundr-session': runtime.token };
  async function api(route, data) {
    const r = await fetch(url + route, {
        method: data === undefined ? 'GET' : 'POST',
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      v = await r.json();
    if (!r.ok || v.ok === false) throw new Error(v.error?.message || 'Demo request failed.');
    return v;
  }
  try {
    const existing = JSON.parse(await fs.readFile(path.join(root, 'demo.json'), 'utf8'));
    await api('/api/project/' + existing.projectId);
    console.log('Generated demo is ready.');
    return;
  } catch {}
  const media = path.join(root, 'demo-media');
  await fs.mkdir(media, { recursive: true });
  await exec(
    process.env.SOUNDR_PYTHON || 'python',
    [path.join(APP, 'scripts', 'demo-frames.py'), media],
    { windowsHide: true, timeout: 30000 },
  );
  let voiceMode = 'Windows text-to-speech';
  try {
    await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(APP, 'scripts', 'demo-voices.ps1'),
        '-OutputRoot',
        media,
      ],
      { windowsHide: true, timeout: 30000 },
    );
  } catch {
    voiceMode = 'Generated tone placeholders';
    for (const take of ['a', 'b']) {
      const c = new Float32Array(48000 * 4);
      for (let n = 0; n < c.length; n++) {
        const t = n / 48000,
          envelope = Math.pow(Math.sin((Math.PI * (t % 0.5)) / 0.5), 2);
        c[n] = 0.15 * envelope * Math.sin(2 * Math.PI * (take === 'a' ? 180 : 205) * t);
      }
      await fs.writeFile(path.join(media, 'voice-' + take + '.wav'), encodeWav([c]));
    }
  }
  let seed = 421;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const frames = 48000 * 90,
    room = [new Float32Array(frames), new Float32Array(frames)],
    music = [new Float32Array(frames), new Float32Array(frames)];
  for (let n = 0; n < frames; n++) {
    const t = n / 48000;
    room[0][n] = random() * 0.015;
    room[1][n] = random() * 0.015;
    const tone =
      0.06 *
      (Math.sin(2 * Math.PI * 110 * t) +
        0.5 * Math.sin(2 * Math.PI * 164.8138 * t) +
        0.4 * Math.sin(2 * Math.PI * 220 * t));
    music[0][n] = tone;
    music[1][n] = tone * 0.96;
  }
  await fs.writeFile(path.join(media, 'room-tone.wav'), encodeWav(room));
  await fs.writeFile(path.join(media, 'music.wav'), encodeWav(music));
  const step = new Float32Array(48000);
  step[0] = 0.75;
  for (let n = 1; n < step.length; n++) step[n] = random() * 0.25 * Math.exp(-n / 2400);
  await fs.writeFile(path.join(media, 'footstep.wav'), encodeWav([step]));
  const sync = new Float32Array(4800);
  sync[0] = 0.8;
  await fs.writeFile(path.join(media, 'sync-marker.wav'), encodeWav([sync]));
  async function movie(file, sequence, duration, markers) {
    const entries =
      sequence
        .map(
          ([number, seconds]) =>
            "file '" +
            path
              .join(media, 'frame-' + number + '.png')
              .replaceAll('\\', '/')
              .replaceAll("'", "'\\''") +
            "'\nduration " +
            seconds +
            '\n',
        )
        .join('') +
      "file '" +
      path.join(media, 'frame-' + sequence.at(-1)[0] + '.png').replaceAll('\\', '/') +
      "'\n";
    const list = path.join(media, file + '.txt');
    await fs.writeFile(list, entries);
    const enable = markers.map((second) => 'eq(n,' + second * 24 + ')').join('+');
    await exec(
      process.env.SOUNDR_FFMPEG || 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-vf',
        "fps=24,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='" + enable + "'",
        '-t',
        String(duration),
        '-r',
        '24',
        '-fps_mode',
        'cfr',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '2',
        '-an',
        '-movflags',
        '+faststart',
        path.join(media, file),
      ],
      { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
  }
  await movie(
    'picture-v001.mp4',
    [
      [1, 20],
      [2, 10],
      [3, 20],
      [4, 25],
    ],
    75,
    [0, 28, 50, 70],
  );
  await movie(
    'picture-v002.mp4',
    [
      [1, 20],
      [5, 5],
      [2, 10],
      [3, 20],
      [4, 25],
    ],
    80,
    [0, 33, 55, 75],
  );
  let project = (
    await api('/api/projects', {
      title: 'The Quiet Return · generated demo',
      frameRate: { numerator: 24, denominator: 1 },
      requestId: id('demo-create'),
    })
  ).project;
  const refresh = async () => (project = (await api('/api/project/' + project.id)).project);
  async function commands(list) {
    const r = await api('/api/commands', {
      projectId: project.id,
      expectedRevision: project.revision,
      requestId: id('demo-edit'),
      commands: list,
    });
    await refresh();
    return r;
  }
  const story = {
    characters: [{ id: 'character-amenewa', name: 'Amenewa', sourceRef: null }],
    scenes: [{ id: 'scene-room', name: 'INT. WAITING ROOM — DAWN', sourceRef: null }],
    lines: [
      {
        id: 'line-wait',
        sceneId: 'scene-room',
        characterId: 'character-amenewa',
        text: "Wait here. I'll return before sunrise.",
        reviewRequired: false,
        sourceRef: null,
      },
    ],
    shots: [
      {
        id: 'shot-room',
        sceneId: 'scene-room',
        name: 'The waiting room',
        startFrame: 0,
        durationFrames: 480,
        isPresent: true,
        sourceRef: null,
      },
      {
        id: 'shot-door',
        sceneId: 'scene-room',
        name: 'Doorway',
        startFrame: 480,
        durationFrames: 240,
        isPresent: true,
        sourceRef: null,
      },
      {
        id: 'shot-hall',
        sceneId: 'scene-room',
        name: 'Empty hall',
        startFrame: 720,
        durationFrames: 480,
        isPresent: true,
        sourceRef: null,
      },
      {
        id: 'shot-dawn',
        sceneId: 'scene-room',
        name: 'Before sunrise',
        startFrame: 1200,
        durationFrames: 600,
        isPresent: true,
        sourceRef: null,
      },
    ],
    imports: [],
  };
  await commands([{ type: 'story.set', storyProjectId: 'film-quiet-return-demo', story }]);
  const sourceIds = {};
  let oldPictureId, newPictureId;
  async function upload(file, kind, cutId) {
    const bytes = await fs.readFile(path.join(media, file)),
      meta = {
        kind,
        name: file,
        frameRate: { numerator: 24, denominator: 1 },
        cutId: cutId || 'cut-v001',
        expectedRevision: project.revision,
        requestId: id('demo-import'),
      };
    const r = await fetch(url + '/api/import/' + project.id, {
      method: 'POST',
      headers: {
        'x-soundr-session': runtime.token,
        'Content-Type': 'application/octet-stream',
        'x-upload-meta': encodeURIComponent(JSON.stringify(meta)),
      },
      body: bytes,
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error?.message || 'Demo media import failed.');
    await refresh();
    return result.detail.assetId;
  }
  for (const file of [
    'voice-a.wav',
    'voice-b.wav',
    'room-tone.wav',
    'music.wav',
    'footstep.wav',
    'sync-marker.wav',
  ])
    sourceIds[file] = await upload(file, 'audio');
  oldPictureId = await upload('picture-v001.mp4', 'picture', 'cut-v001');
  newPictureId = await upload('picture-v002.mp4', 'picture', 'cut-v002');
  const add = (
    sourceId,
    trackId,
    startSample,
    durationSamples,
    name,
    shotId = null,
    lineId = null,
  ) => ({
    type: 'clip.add',
    sourceId,
    trackId,
    startSample,
    sourceInSample: 0,
    durationSamples,
    name,
    sceneId: 'scene-room',
    shotId,
    lineId,
  });
  const voiceSource = project.sources.find((s) => s.id === sourceIds['voice-a.wav']);
  await commands([
    { type: 'picture.use', pictureId: oldPictureId, mode: 'initial' },
    add(
      voiceSource.id,
      'track-dialogue',
      576000,
      voiceSource.frames,
      'Amenewa · take 1 (synthetic)',
      'shot-room',
      'line-wait',
    ),
    add(sourceIds['room-tone.wav'], 'track-ambience', 0, 3600000, 'Waiting room · room tone'),
    add(sourceIds['music.wav'], 'track-music', 0, 3600000, 'Before sunrise · music'),
    add(sourceIds['footstep.wav'], 'track-effects', 1344000, 48000, 'Footstep', 'shot-door'),
    add(sourceIds['sync-marker.wav'], 'track-effects', 0, 4800, 'Sync marker 1', 'shot-room'),
    add(sourceIds['sync-marker.wav'], 'track-effects', 2400000, 4800, 'Sync marker 2', 'shot-dawn'),
    add(sourceIds['sync-marker.wav'], 'track-effects', 3360000, 4800, 'Sync marker 3', 'shot-dawn'),
  ]);
  const group = project.takeGroups[0],
    cue = project.cues[0],
    voiceClip = project.clips.find((c) => c.takeId === group.selectedTakeId),
    musicClip = project.clips.find((c) => c.trackId === 'track-music');
  await commands(
    [
      {
        type: 'take.add',
        groupId: group.id,
        sourceId: sourceIds['voice-b.wav'],
        label: 'Amenewa · take 2 (synthetic)',
      },
      { type: 'clip.set', clipId: voiceClip.id, fadeIn: 240, fadeOut: 960, gainDb: 0 },
      { type: 'clip.set', clipId: musicClip.id, fadeIn: 48000, fadeOut: 96000 },
      {
        type: 'processor.set',
        ownerId: 'bus-dialogue',
        processor: {
          id: 'processor-dialogue-highpass',
          type: 'highpass',
          cutoffHz: 80,
          q: 0.707,
          enabled: true,
        },
      },
      {
        type: 'automation.set',
        automation: {
          id: 'automation-music-duck',
          target: { kind: 'track', id: 'track-music', parameter: 'gainDb' },
          anchor: { type: 'cue', cueId: cue.id },
          interpolation: 'linear',
          points: [
            { sample: -24000, value: -6 },
            { sample: 0, value: -18 },
            { sample: cue.durationSamples, value: -18 },
            { sample: cue.durationSamples + 24000, value: -6 },
          ],
        },
      },
      { type: 'project.save', label: 'Generated demo' },
    ].filter((c) => c.type !== 'project.save'),
  );
  await commands([{ type: 'project.save', label: 'Saved generated demo' }]);
  const newShots = [
    copyShot(story.shots[0]),
    {
      id: 'shot-pause',
      sceneId: 'scene-room',
      name: 'A moment longer',
      startFrame: 480,
      durationFrames: 120,
      isPresent: true,
      sourceRef: null,
    },
    ...story.shots.slice(1).map((s) => ({ ...s, startFrame: s.startFrame + 120 })),
  ];
  const demo = {
    projectId: project.id,
    oldPictureId,
    newPictureId,
    newShots,
    voiceMode,
    generated: true,
    description: 'Original generated test media; not a production film or human voice acceptance.',
    sourceIds,
  };
  await fs.writeFile(path.join(root, 'demo.json'), JSON.stringify(demo, null, 2));
  console.log('Generated 75-second scene and 80-second revised cut are ready.');
}
const copyShot = (shot) => structuredClone(shot);
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
