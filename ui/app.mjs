import { connect, api, upload, requestId, el, button, field, rateLabel, timecode } from './api.mjs';
import { Timeline } from './timeline.mjs';
import { Transport } from './transport.mjs';
import { Dialogs } from './dialogs.mjs';
const $ = (selector) => document.querySelector(selector);
const state = {
  project: null,
  record: null,
  selectedId: null,
  selectedLineId: null,
  tab: 'clip',
  browser: 'cues',
  busy: false,
  dragging: false,
  audition: false,
  job: null,
  demo: null,
};
function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
async function run(fn) {
  try {
    return await fn();
  } catch (error) {
    status(error.message, true);
    if (['REVISION_CONFLICT', 'PLAN_STALE'].includes(error.code)) $('#reload').hidden = false;
    console.error(error.code || 'SOUNDR', error.message);
  }
}
const transport = new Transport($('#picture'), {
  onPosition: (sample) => {
    timeline.position(sample);
    const p = transport.project || state.project;
    if (p) $('#timecode').textContent = timecode(sample, p.frameRate, p.timelineOrigin.timecode);
  },
  onState: (phase) => {
    $('#play').textContent = phase === 'playing' ? 'Ⅱ' : phase === 'preparing' ? '…' : '▶';
    $('#play').setAttribute('aria-label', phase === 'playing' ? 'Pause' : 'Play');
    $('#play').disabled = !state.project || phase === 'preparing';
    if (phase === 'preparing') status('Preparing the current mix for picture playback…');
    if (phase === 'playing')
      status(
        state.audition
          ? 'Auditioning the proposed cut.'
          : 'Playing the current mix against picture.',
      );
  },
  onLevel: (peak) => {
    $('#master-meter').value = Math.min(1, peak);
  },
  onError: (error) => status(error.message, true),
});
const timeline = new Timeline($('#timeline'), {
  onSelect: (id) => select(id),
  onCommit: (c) => run(() => command([c])),
  onSeek: (s) => state.project && !state.audition && transport.seek(s, state.project),
  onDrag: (v) => {
    state.dragging = v;
  },
  onMute: (t) => run(() => command([{ type: 'track.set', trackId: t.id, muted: !t.muted }])),
  onGain: (t, gainDb) => run(() => command([{ type: 'track.set', trackId: t.id, gainDb }])),
});
const dialogs = new Dialogs({
  state,
  transport,
  status,
  run,
  load,
  refresh,
  command,
  select,
  render,
});
async function projects() {
  const data = await api('/api/projects'),
    list = Array.isArray(data) ? data : data.projects;
  const menu = $('#project-select');
  menu.replaceChildren();
  const first = el('option', '', 'Open a session');
  first.value = '';
  menu.append(first);
  for (const item of list || []) {
    if (item.error) continue;
    const o = el('option', '', item.title);
    o.value = item.id;
    menu.append(o);
  }
  if (state.project) menu.value = state.project.id;
  return list || [];
}
async function load(id) {
  transport.stop();
  transport.position = 0;
  transport.project = null;
  state.record = await api('/api/project/' + id);
  state.project = state.record.project;
  state.selectedId = null;
  state.selectedLineId = null;
  state.job = null;
  localStorage.setItem('soundr-project', id);
  await projects();
  render();
  status('Session reopened from its local checkpoint.');
}
async function refresh() {
  if (!state.project) return;
  state.record = await api('/api/project/' + state.project.id);
  state.project = state.record.project;
  if (!state.project.clips.some((c) => c.id === state.selectedId)) state.selectedId = null;
  $('#reload').hidden = true;
  render();
}
async function command(commands) {
  if (!state.project) throw new Error('Open a session first.');
  if (state.audition)
    throw new Error('Close the proposed-cut audition before editing the saved session.');
  transport.stop();
  const result = await api('/api/commands', {
    projectId: state.project.id,
    expectedRevision: state.project.revision,
    requestId: requestId(),
    commands,
  });
  await refresh();
  status('Edit saved locally · revision ' + state.project.revision);
  return result;
}
function select(id) {
  state.selectedId = id;
  const c = state.project.clips.find((x) => x.id === id);
  if (c?.story.lineId) state.selectedLineId = c.story.lineId;
  state.tab = 'clip';
  timeline.select(id);
  renderInspector();
  renderBrowser();
  renderRibbon();
}
function labeledSelect(label, items, value, onChange) {
  const wrap = el('label', 'wide-field', label),
    s = el('select');
  for (const [id, text] of items) {
    const o = el('option', '', text);
    o.value = id;
    s.append(o);
  }
  s.value = value || '';
  s.onchange = () => run(() => onChange(s.value));
  wrap.append(s);
  return wrap;
}
function numeric(label, value, onChange, options = {}) {
  const f = field(label, value, options);
  f.input.addEventListener('change', () => run(() => onChange(Number(f.input.value))));
  return f.wrap;
}
function renderBrowser() {
  const box = $('#browser-content');
  box.replaceChildren();
  if (!state.project) {
    box.append(el('p', 'hint', 'Script lines and original recordings live here.'));
    return;
  }
  const p = state.project;
  $('#show-cues').setAttribute('aria-pressed', String(state.browser === 'cues'));
  $('#show-library').setAttribute('aria-pressed', String(state.browser === 'library'));
  if (state.demo?.projectId === p.id)
    box.append(
      el(
        'p',
        'sample-warning',
        state.demo.voiceMode === 'Generated tone placeholders'
          ? 'Generated test material · voice takes are tone placeholders.'
          : 'Generated test material · synthetic test voices.',
      ),
    );
  if (state.browser === 'cues') {
    for (const scene of p.story.scenes) {
      const lines = p.story.lines.filter((l) => l.sceneId === scene.id);
      if (!lines.length) continue;
      box.append(el('p', 'scene-label', scene.name));
      for (const line of lines) {
        const name =
            p.story.characters.find((c) => c.id === line.characterId)?.name ||
            'Speaker needs review',
          cues = p.cues.filter((q) => q.lineId === line.id),
          takeCount = p.takeGroups
            .filter((g) => cues.some((q) => q.id === g.cueId))
            .reduce((n, g) => n + g.takes.length, 0);
        const b = button(
          '',
          () => {
            state.selectedLineId = line.id;
            const clip = p.clips.find((c) => c.story.lineId === line.id);
            if (clip) {
              select(clip.id);
              transport.seek(clip.startSample, p);
            } else {
              state.selectedId = null;
              render();
            }
          },
          'browser-item' + (state.selectedLineId === line.id ? ' active' : ''),
        );
        b.append(
          el('strong', '', name),
          el('span', '', line.text),
          el(
            'span',
            'asset-type',
            takeCount +
              ' TAKES · ' +
              (cues.some((q) => q.approval !== 'approved')
                ? 'NEEDS REVIEW'
                : cues.length
                  ? 'APPROVED'
                  : 'UNRECORDED'),
          ),
        );
        box.append(b);
      }
    }
    if (!p.story.lines.length)
      box.append(
        el('p', 'hint', 'Import a Screenwritr story snapshot or add your first dialogue line.'),
      );
  } else {
    for (const source of p.sources) {
      const b = button('', () => dialogs.addSound(source.id), 'browser-item');
      b.append(
        el('span', 'asset-type', 'WAV · ' + (source.frames / 48000).toFixed(2) + ' s'),
        el('strong', '', source.name),
        el('span', '', source.channels + ' channel · source preserved'),
      );
      box.append(b);
    }
    if (!p.sources.length)
      box.append(el('p', 'hint', 'Import a 48 kHz WAV recording to place it on the timeline.'));
  }
}
function renderRibbon() {
  const p = state.project,
    c = p?.clips.find((x) => x.id === state.selectedId),
    line = p?.story.lines.find((l) => l.id === (c?.story.lineId || state.selectedLineId)),
    cue = p?.cues.find((q) => q.lineId === line?.id);
  $('#cue-character').textContent = line
    ? p.story.characters.find((x) => x.id === line.characterId)?.name || 'UNASSIGNED'
    : 'PERFORMANCE';
  $('#cue-text').textContent =
    line?.text || 'Select a dialogue clip to reveal its line and every take.';
  $('#cue-approval').textContent = cue?.approval.replaceAll('-', ' ') || '';
}
function renderInspector() {
  for (const [key, id] of [
    ['clip', 'clip-tab'],
    ['mix', 'mix-tab'],
    ['delivery', 'delivery-tab'],
  ])
    $('#' + id).setAttribute('aria-pressed', String(state.tab === key));
  const box = $('#inspector');
  box.replaceChildren();
  const p = state.project;
  if (!p) {
    box.append(el('div', 'empty-panel', 'Create a session to edit sound against picture.'));
    return;
  }
  if (state.tab === 'mix') return renderMix(box, p);
  if (state.tab === 'delivery') return renderDelivery(box, p);
  const clip = p.clips.find((c) => c.id === state.selectedId);
  if (!clip) {
    const empty = el('div', 'empty-panel');
    empty.append(
      el('h3', '', 'Every performance stays editable.'),
      el(
        'p',
        '',
        'Select a clip to adjust its placement, source offset, gain and fades. Drag clip edges to trim. Shift-drag works at sample precision.',
      ),
    );
    box.append(empty);
    return;
  }
  const source = p.sources.find((s) => s.id === clip.sourceId),
    heading = el('div', 'selection-heading');
  heading.append(el('h3', '', clip.name));
  box.append(
    heading,
    el('p', 'source-label', source.name + ' · original recording'),
    el('p', 'hint', 'Stable clip ID: ' + clip.id),
  );
  const fields = el('div', 'field-grid');
  fields.append(
    numeric(
      'Start · seconds',
      clip.startSample / 48000,
      (v) =>
        command([
          {
            type: 'clip.move',
            clipIds: [clip.id],
            deltaSamples: Math.round(v * 48000) - clip.startSample,
          },
        ]),
      { min: 0 },
    ),
    numeric(
      'Length · seconds',
      clip.durationSamples / 48000,
      (v) =>
        command([
          {
            type: 'clip.trim',
            clipId: clip.id,
            side: 'right',
            amountSamples: clip.durationSamples - Math.round(v * 48000),
          },
        ]),
      { min: 1 / 48000 },
    ),
    numeric(
      'Source in · seconds',
      clip.sourceInSample / 48000,
      (v) =>
        command([
          {
            type: 'clip.slip',
            clipId: clip.id,
            deltaSamples: Math.round(v * 48000) - clip.sourceInSample,
          },
        ]),
      { min: 0 },
    ),
    numeric(
      'Clip gain · dB',
      clip.gainDb,
      (v) => command([{ type: 'clip.set', clipId: clip.id, gainDb: v }]),
      { step: 0.1 },
    ),
    numeric(
      'Fade in · ms',
      clip.fadeIn.samples / 48,
      (v) => command([{ type: 'clip.set', clipId: clip.id, fadeIn: Math.round(v * 48) }]),
      { min: 0 },
    ),
    numeric(
      'Fade out · ms',
      clip.fadeOut.samples / 48,
      (v) => command([{ type: 'clip.set', clipId: clip.id, fadeOut: Math.round(v * 48) }]),
      { min: 0 },
    ),
  );
  box.append(fields);
  const actions = el('div', 'inspector-actions');
  actions.append(
    button('Split at playhead', () =>
      run(() =>
        command([
          { type: 'clip.split', clipId: clip.id, atSample: Math.round(transport.position) },
        ]),
      ),
    ),
    button(clip.enabled ? 'Park clip' : 'Enable clip', () =>
      run(() => command([{ type: 'clip.set', clipId: clip.id, enabled: !clip.enabled }])),
    ),
  );
  if (!clip.takeId)
    actions.append(
      button('Duplicate', () =>
        run(async () => {
          const r = await command([
            { type: 'clip.duplicate', clipId: clip.id, deltaSamples: clip.durationSamples },
          ]);
          select(r.detail.commands[0].clipId);
        }),
      ),
    );
  box.append(actions);
  box.append(
    labeledSelect(
      'Script line',
      [
        ['', 'No dialogue line'],
        ...p.story.lines.map((l) => [
          l.id,
          (p.story.characters.find((c) => c.id === l.characterId)?.name || 'Unassigned') +
            ' · ' +
            l.text,
        ]),
      ],
      clip.story.lineId,
      (v) =>
        command([
          {
            type: 'clip.link',
            clipId: clip.id,
            lineId: v || null,
            sceneId: clip.story.sceneId,
            shotId: clip.story.shotId,
          },
        ]),
    ),
  );
  box.append(
    labeledSelect(
      'Shot attachment',
      [
        ['', 'Absolute placement'],
        ...p.story.shots.filter((s) => s.isPresent !== false).map((s) => [s.id, s.name]),
      ],
      clip.story.shotId,
      (v) =>
        command([
          {
            type: 'clip.link',
            clipId: clip.id,
            lineId: clip.story.lineId,
            sceneId: p.story.shots.find((s) => s.id === v)?.sceneId || clip.story.sceneId,
            shotId: v || null,
          },
        ]),
    ),
  );
  const group = p.takeGroups.find((g) => g.takes.some((t) => t.id === clip.takeId));
  if (group) {
    const takes = el('div', 'take-list');
    for (const [index, take] of group.takes.entries()) {
      const selected = group.selectedTakeId === take.id;
      const b = button(
        '',
        () =>
          run(async () => {
            await command([{ type: 'take.select', groupId: group.id, takeId: take.id }]);
            select(state.project.clips.find((c) => c.takeId === take.id).id);
          }),
        'take-choice' + (selected ? ' selected' : ''),
      );
      b.append(
        el('span', '', selected ? '●' : '○'),
        el('span', '', String(index + 1)),
        document.createTextNode(take.label),
      );
      takes.append(b);
    }
    box.append(el('h3', '', 'Performance takes'), takes);
    const sourceSelect = labeledSelect(
      'Add an imported recording as another take',
      [
        ['', 'Choose a source…'],
        ...p.sources
          .filter((s) => !group.takes.some((t) => t.sourceId === s.id))
          .map((s) => [s.id, s.name]),
      ],
      '',
      (v) =>
        v &&
        command([
          {
            type: 'take.add',
            groupId: group.id,
            sourceId: v,
            label: p.sources.find((s) => s.id === v).name,
          },
        ]),
    );
    box.append(sourceSelect);
    const cue = p.cues.find((q) => q.id === group.cueId);
    box.append(
      labeledSelect(
        'Director review',
        [
          ['draft', 'Draft'],
          ['needs-review', 'Needs review'],
          ['approved', 'Approved'],
          ['rejected', 'Rejected'],
        ],
        cue.approval,
        (v) =>
          command([{ type: 'cue.approve', cueId: cue.id, status: v, reviewer: 'Local director' }]),
      ),
    );
  }
}
function renderMix(box, p) {
  box.append(
    el(
      'p',
      'hint',
      'Ambience has its own track and controls. It joins effects for delivery. Bus automation and processing are included in the master.',
    ),
  );
  for (const owner of [...p.tracks, ...p.buses]) {
    const section = el('section', 'mix-section');
    section.append(el('h3', '', owner.name + (owner.kind ? ' · track' : ' · bus')));
    const row = el('div', 'field-grid'),
      type = owner.kind ? 'track.set' : 'bus.set',
      key = owner.kind ? 'trackId' : 'busId';
    row.append(
      numeric(
        'Volume · dB',
        owner.gainDb,
        (gainDb) => command([{ type, [key]: owner.id, gainDb }]),
        { step: 0.1 },
      ),
      button(owner.muted ? 'Unmute' : 'Mute', () =>
        run(() => command([{ type, [key]: owner.id, muted: !owner.muted }])),
      ),
    );
    if (owner.kind)
      row.append(
        numeric('Pan · −1 to 1', owner.pan, (pan) => command([{ type, [key]: owner.id, pan }]), {
          step: 0.05,
        }),
      );
    section.append(row);
    const route = p.routes.find((r) => r.fromId === owner.id);
    if (route)
      section.append(
        labeledSelect(
          'Route to',
          p.buses.filter((b) => b.id !== owner.id).map((b) => [b.id, b.name]),
          route.toBusId,
          (toBusId) => command([{ type: 'route.set', route: { ...route, toBusId } }]),
        ),
      );
    const hp = owner.processors.find((x) => x.type === 'highpass'),
      hpId = hp?.id || 'hp-' + owner.id;
    section.append(
      numeric(
        'High-pass cutoff · Hz (0 bypasses)',
        hp?.enabled ? hp.cutoffHz : 0,
        (cutoffHz) =>
          command([
            {
              type: 'processor.set',
              ownerId: owner.id,
              processor: {
                id: hpId,
                type: 'highpass',
                cutoffHz: Math.max(20, cutoffHz),
                q: hp?.q || 0.707,
                enabled: cutoffHz > 0,
              },
            },
          ]),
        { min: 0 },
      ),
    );
    box.append(section);
  }
}
function renderDelivery(box, p) {
  box.append(
    el('h3', '', 'A synchronized delivery'),
    el(
      'p',
      'hint',
      'Master + dialogue, music and effects. Stereo 48 kHz, 24-bit WAV with a shared BWF timeline origin. The receipt records picture, sources, settings and omissions.',
    ),
  );
  const job = state.job;
  if (job) {
    box.append(el('p', 'sample-warning', 'Delivery ' + job.status));
    if (job.status === 'completed') {
      const result = job.result || job;
      for (const name of [
        'master.wav',
        'dialogue.wav',
        'music.wav',
        'effects.wav',
        'manifest.json',
      ]) {
        const row = el('div', 'delivery-file'),
          link = el('a', '', name);
        link.href = '/download/' + job.jobId + '/' + name;
        link.download = name;
        row.append(link);
        box.append(row);
      }
      const manifest = result.manifest || job.manifest;
      if (manifest) {
        box.append(
          el(
            'p',
            'hint',
            manifest.picture ? 'Picture cut: ' + manifest.picture.cutId : 'Audio-only session',
          ),
        );
        if (
          manifest.projectRevision !== p.revision ||
          (manifest.picture?.id !== p.activePictureId && p.activePictureId !== null)
        )
          box.append(
            el(
              'p',
              'sample-warning',
              'This delivery uses an earlier saved revision. Export again to include current edits.',
            ),
          );

        box.append(
          el(
            'p',
            'hint',
            'Frozen revision ' +
              manifest.projectRevision +
              ' · ' +
              manifest.range?.durationSamples / 48000 +
              ' seconds',
          ),
        );
        for (const warning of manifest.warnings || [])
          box.append(
            el(
              'p',
              'sample-warning',
              typeof warning === 'string'
                ? warning
                : warning.message || warning.code || 'Delivery review needed.',
            ),
          );
      }
    }
    if (job.error) box.append(el('p', 'sample-warning', job.error.message || String(job.error)));
  }
  box.append(button('Export current mix & stems', () => run(exportMix), 'primary'));
  const prior = state.record?.jobs || [];
  if (prior.length)
    box.append(
      button('Load latest delivery', () =>
        run(async () => {
          const jobId = prior.at(-1);
          state.job = { ...(await api('/api/jobs/' + jobId)), jobId };
          renderInspector();
        }),
      ),
      el('p', 'hint', prior.length + ' delivery jobs recorded with this session.'),
    );
}
async function exportMix() {
  transport.stop();
  state.tab = 'delivery';
  const receipt = await api('/api/render', {
    projectId: state.project.id,
    expectedRevision: state.project.revision,
    requestId: requestId(),
  });
  const jobId = receipt.detail.jobId;
  state.job = { jobId, status: 'queued' };
  renderInspector();
  status('Rendering the frozen session to master and stems…');
  for (let i = 0; i < 240; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const data = await api('/api/jobs/' + jobId);
    state.job = { ...data, jobId };
    if (state.tab === 'delivery') renderInspector();
    if (['completed', 'failed'].includes(data.status)) {
      status(
        data.status === 'completed'
          ? 'Master and synchronized stems are ready. Delivery receipt included.'
          : data.error?.message || 'Delivery failed.',
        data.status === 'failed',
      );
      await refresh();
      return;
    }
  }
  throw new Error('The render is still running. Load the latest delivery to check its result.');
}
function render() {
  const p = state.project;
  for (const id of [
    'save-project',
    'versions',
    'export',
    'import-story',
    'add-line',
    'picture-import',
    'review-cut',
    'to-start',
    'play',
    'undo',
    'redo',
    'import-audio',
    'automation',
  ])
    $('#' + id).disabled = !p;
  $('#undo').disabled = !state.record?.undoAvailable;
  $('#redo').disabled = !state.record?.redoAvailable;
  $('#saved-state').textContent = p
    ? 'Saved locally · revision ' +
      p.revision +
      ' · ' +
      (state.record?.versions?.length || 0) +
      ' versions'
    : 'Your sound, from first performance to final picture.';
  if (p) {
    $('#clock-label').textContent = rateLabel(p.frameRate) + ' · 48 kHz';
    $('#timecode').textContent = timecode(
      transport.position,
      p.frameRate,
      p.timelineOrigin.timecode,
    );
    const pic = p.pictures.find((x) => x.id === p.activePictureId);
    $('#picture-empty').hidden = !!pic;
    $('#picture-label').textContent = pic ? pic.name + ' · ' + pic.cutId : 'No picture attached';
    if (!state.audition) {
      if (pic && $('#picture').dataset.pictureId !== pic.id) {
        $('#picture').onloadedmetadata = () => {
          if (!transport.playing && !state.audition && state.project?.activePictureId === pic.id) {
            const sample = Math.min(transport.position, p.durationSamples - 1),
              start = (pic.sourceInFrame * pic.frameRate.denominator) / pic.frameRate.numerator;
            $('#picture').currentTime = Math.max(
              start,
              start + (sample - pic.timelineStartSample) / 48000,
            );
            $('#picture').style.visibility =
              sample >= pic.timelineStartSample ? 'visible' : 'hidden';
          }
        };
        $('#picture').src = '/asset/' + p.id + '/' + pic.id;
        $('#picture').dataset.pictureId = pic.id;
      }
      if (!pic) {
        $('#picture').removeAttribute('src');
        delete $('#picture').dataset.pictureId;
      }
    }
    $('#review-cut').disabled = !p.activePictureId;
    $('#timeline-hint').textContent =
      (p.durationSamples / 48000).toFixed(2) +
      ' seconds · ' +
      p.clips.length +
      ' editable clips · ' +
      p.sources.length +
      ' preserved sources';
  }
  timeline.render(p, state.selectedId);
  renderBrowser();
  renderInspector();
  renderRibbon();
}
async function openDemo() {
  status('Preparing the generated 75-second demo. This can take a moment…');
  $('#open-demo').disabled = true;
  $('#empty-demo').disabled = true;
  try {
    state.demo = await api('/api/demo/create', {});
    await load(state.demo.projectId);
    select(state.project.clips.find((c) => c.story.lineId)?.id);
    status('Generated demo ready. Synthetic voices and picture are test material.');
  } finally {
    $('#open-demo').disabled = false;
    $('#empty-demo').disabled = false;
  }
}
$('#project-select').onchange = () =>
  run(() => $('#project-select').value && load($('#project-select').value));
$('#new-project').onclick = () => dialogs.newProject();
$('#open-demo').onclick = $('#empty-demo').onclick = () => run(openDemo);
$('#save-project').onclick = () =>
  run(async () => {
    await command([{ type: 'project.save', label: 'Director checkpoint' }]);
    status('A versioned checkpoint is ready to reopen.');
  });
$('#versions').onclick = () => dialogs.versions();
$('#export').onclick = () => run(exportMix);
$('#show-cues').onclick = () => {
  state.browser = 'cues';
  renderBrowser();
};
$('#show-library').onclick = () => {
  state.browser = 'library';
  renderBrowser();
};
$('#add-line').onclick = () => dialogs.addLine();
$('#picture-import').onclick = () => dialogs.picture();
$('#review-cut').onclick = () => dialogs.cut();
$('#automation').onclick = () => dialogs.automation();
for (const [tab, id] of [
  ['clip', 'clip-tab'],
  ['mix', 'mix-tab'],
  ['delivery', 'delivery-tab'],
])
  $('#' + id).onclick = () => {
    state.tab = tab;
    renderInspector();
  };
$('#import-audio').onclick = () => $('#audio-file').click();
$('#audio-file').onchange = () =>
  run(async () => {
    const file = $('#audio-file').files[0];
    if (!file) return;
    status('Importing and validating the original recording…');
    const receipt = await upload(state.project, file, 'audio');
    await refresh();
    state.browser = 'library';
    renderBrowser();
    dialogs.addSound(receipt.detail.assetId);
    $('#audio-file').value = '';
  });
$('#import-story').onclick = () => $('#story-file').click();
$('#story-file').onchange = () =>
  run(async () => {
    const file = $('#story-file').files[0];
    if (!file) return;
    const data = JSON.parse(await file.text()),
      format =
        data.schema === 'org.icuni.story-graph' || data.storyId ? 'screenwritr' : 'storytellr';
    await api('/api/import-story', {
      projectId: state.project.id,
      expectedRevision: state.project.revision,
      requestId: requestId(),
      format,
      data,
      revision: data.updatedAt || 'snapshot',
    });
    await refresh();
    status('Story IDs imported. Existing dialogue links were validated.');
    $('#story-file').value = '';
  });
const play = () => {
  if (!state.project || state.audition) return;
  if (transport.playing) transport.stop();
  else
    transport.play(
      state.project,
      transport.position >= state.project.durationSamples - 1 ? 0 : transport.position,
    );
};
$('#play').onclick = play;
$('#to-start').onclick = () => transport.seek(0, state.project);
$('#undo').onclick = () => run(() => command([{ type: 'history.undo' }]));
$('#redo').onclick = () => run(() => command([{ type: 'history.redo' }]));
$('#reload').onclick = () => run(refresh);
$('#zoom').oninput = () => {
  timeline.scale = Number($('#zoom').value);
  timeline.render(state.project, state.selectedId);
};
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select') || $('#modal').open) return;
  if (e.code === 'Space') {
    e.preventDefault();
    play();
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    run(() => command([{ type: e.shiftKey ? 'history.redo' : 'history.undo' }]));
  }
  if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && state.selectedId)
    run(() =>
      command([
        { type: 'clip.split', clipId: state.selectedId, atSample: Math.round(transport.position) },
      ]),
    );
});
window.soundr = {
  inspect: () => structuredClone(state.project),
  diagnostics: () => ({
    playing: transport.playing,
    position: transport.position,
    observations: structuredClone(transport.observations),
  }),
  seek: (sample) => transport.seek(sample, state.project),
};
await run(async () => {
  await connect();
  try {
    state.demo = (await api('/api/demo')).demo;
  } catch {}
  const list = await projects(),
    last = localStorage.getItem('soundr-project');
  if (list.some((p) => p.id === last)) await load(last);
  else if (list.length) await load(list[0].id);
  else {
    render();
    status('Local workstation ready. Create a session or explore the generated demo.');
  }
});
setInterval(() => {
  if (!state.project || state.dragging || $('#modal').open) return;
  run(async () => {
    const projectId = state.project.id,
      latest = await api('/api/project/' + projectId);
    if (state.project?.id === projectId && latest.project.revision > state.project.revision) {
      if (transport.playing || document.activeElement?.closest('input,textarea,select')) {
        $('#reload').hidden = false;
        status('The session changed through another interface. Reload before the next edit.');
      } else {
        state.record = latest;
        state.project = latest.project;
        render();
        status('Session updated from a shared command · revision ' + state.project.revision);
      }
    }
  });
}, 4000);
