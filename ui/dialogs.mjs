import { api, upload, requestId, el, button, field, rateLabel } from './api.mjs';
const rates = [
  [12, 1],
  [24, 1],
  [25, 1],
  [30, 1],
  [60, 1],
  [24000, 1001],
  [30000, 1001],
];
function rateSelect(value) {
  const select = el('select');
  for (const [numerator, denominator] of rates) {
    const option = el('option', '', rateLabel({ numerator, denominator }));
    option.value = numerator + '/' + denominator;
    select.append(option);
  }
  select.value = value.numerator + '/' + value.denominator;
  return select;
}
const rateValue = (s) => {
  const [numerator, denominator] = s.value.split('/').map(Number);
  return { numerator, denominator };
};
const option = (value, text) => {
  const o = el('option', '', text);
  o.value = value;
  return o;
};
export class Dialogs {
  constructor(context) {
    this.c = context;
    this.modal = document.querySelector('#modal');
    this.body = document.querySelector('#modal-body');
    this.actions = document.querySelector('#modal-actions');
    document.querySelector('#modal-close').onclick = () => this.close();
    this.modal.addEventListener('close', () => this.exitPreview());
    this.modal.addEventListener('cancel', () => this.exitPreview());
  }
  exitPreview() {
    if (this.c.state.audition) {
      this.c.transport.stop();
      this.c.state.audition = false;
      document.querySelector('#preview-banner').hidden = true;
      this.c.render();
    }
  }
  open(title) {
    if (this.modal.open) this.modal.close();
    document.querySelector('#modal-title').textContent = title;
    this.body.replaceChildren();
    this.actions.replaceChildren();
    this.modal.showModal();
    return this.body;
  }
  close() {
    this.modal.close();
  }
  action(text, fn, primary = false) {
    const b = button(
      text,
      () =>
        this.c.run(async () => {
          b.disabled = true;
          try {
            await fn();
          } finally {
            if (b.isConnected) b.disabled = false;
          }
        }),
      primary ? 'primary' : '',
    );
    this.actions.append(b);
    return b;
  }
  newProject() {
    const body = this.open('A new sound session'),
      grid = el('div', 'modal-grid'),
      name = field('Session name', 'Untitled film', { type: 'text' }),
      length = field('Initial length (seconds)', 75, { min: 0.01 }),
      fps = rateSelect({ numerator: 24, denominator: 1 }),
      fpsLabel = el('label', '', 'Picture frame rate');
    fpsLabel.append(fps);
    grid.append(
      name.wrap,
      fpsLabel,
      length.wrap,
      el(
        'p',
        'hint',
        'The same session can begin with voices and grow with the animatic and finished picture.',
      ),
    );
    body.append(grid);
    this.action(
      'Create session',
      async () => {
        const p = (
          await api('/api/projects', {
            title: name.input.value,
            frameRate: rateValue(fps),
            requestId: requestId(),
          })
        ).project;
        if (Number(length.input.value) !== 75)
          await api('/api/commands', {
            projectId: p.id,
            expectedRevision: 0,
            requestId: requestId(),
            commands: [
              {
                type: 'project.timing.set',
                durationSamples: Math.round(Number(length.input.value) * 48000),
                frameRate: p.frameRate,
                timelineOrigin: p.timelineOrigin,
              },
            ],
          });
        this.close();
        await this.c.load(p.id);
        this.c.status('Session created. Original recordings will be preserved.');
      },
      true,
    );
  }
  addLine() {
    const p = this.c.state.project,
      body = this.open('Add a dialogue line'),
      grid = el('div', 'modal-grid'),
      character = el('select');
    character.append(option('', 'New character'));
    for (const x of p.story.characters) character.append(option(x.id, x.name));
    const charLabel = el('label', '', 'Character');
    charLabel.append(character);
    const charName = field('New character name', '', { type: 'text' }),
      scene = el('select');
    scene.append(option('', 'New scene'));
    for (const x of p.story.scenes) scene.append(option(x.id, x.name));
    const sceneLabel = el('label', '', 'Scene');
    sceneLabel.append(scene);
    const sceneName = field('New scene name', 'Scene 1', { type: 'text' }),
      text = el('textarea');
    text.setAttribute('aria-label', 'Dialogue text');
    const textLabel = el('label', 'full', 'Dialogue');
    textLabel.append(text);
    grid.append(charLabel, charName.wrap, sceneLabel, sceneName.wrap, textLabel);
    body.append(grid);
    this.action(
      'Add line',
      async () => {
        if (!text.value.trim()) throw new Error('Write the dialogue line first.');
        const story = structuredClone(p.story);
        let characterId = character.value,
          sceneId = scene.value;
        if (!characterId) {
          if (!charName.input.value.trim()) throw new Error('Name the character.');
          characterId = 'character-' + crypto.randomUUID();
          story.characters.push({
            id: characterId,
            name: charName.input.value.trim(),
            sourceRef: null,
          });
        }
        if (!sceneId) {
          sceneId = 'scene-' + crypto.randomUUID();
          story.scenes.push({
            id: sceneId,
            name: sceneName.input.value.trim() || 'Scene 1',
            sourceRef: null,
          });
        }
        const lineId = 'line-' + crypto.randomUUID();
        story.lines.push({
          id: lineId,
          sceneId,
          characterId,
          text: text.value,
          reviewRequired: false,
          sourceRef: null,
        });
        await this.c.command([{ type: 'story.set', storyProjectId: p.storyProjectId, story }]);
        this.c.state.selectedLineId = lineId;
        this.close();
        this.c.render();
      },
      true,
    );
  }
  addSound(sourceId) {
    const p = this.c.state.project,
      source = p.sources.find((s) => s.id === sourceId),
      body = this.open('Place a recording'),
      grid = el('div', 'modal-grid'),
      track = el('select');
    for (const t of p.tracks) track.append(option(t.id, t.name));
    if (this.c.state.selectedLineId) track.value = 'track-dialogue';
    const trackLabel = el('label', '', 'Track');
    trackLabel.append(track);
    const line = el('select');
    line.append(option('', 'No dialogue line'));
    for (const l of p.story.lines) {
      const name = p.story.characters.find((c) => c.id === l.characterId)?.name || 'Unassigned';
      line.append(option(l.id, name + ' · ' + l.text));
    }
    line.value = this.c.state.selectedLineId || '';
    const lineLabel = el('label', '', 'Script line');
    lineLabel.append(line);
    const shot = el('select');
    shot.append(option('', 'No shot attachment'));
    for (const s of p.story.shots.filter((s) => s.isPresent !== false))
      shot.append(option(s.id, s.name));
    const shotLabel = el('label', '', 'Shot');
    shotLabel.append(shot);
    const start = field('Start (seconds)', this.c.transport.position / 48000, { min: 0 }),
      duration = field('Length (seconds)', source.frames / 48000, { min: 1 / 48000 });
    grid.append(trackLabel, lineLabel, shotLabel, start.wrap, duration.wrap);
    body.append(
      el('p', 'source-label', source.name),
      grid,
      el(
        'p',
        'hint',
        'Keep the recording intact. Placement and length are editable references to it.',
      ),
    );
    this.action(
      'Add to timeline',
      async () => {
        const lineRecord = p.story.lines.find((l) => l.id === line.value),
          shotRecord = p.story.shots.find((s) => s.id === shot.value);
        const receipt = await this.c.command([
          {
            type: 'clip.add',
            sourceId,
            trackId: track.value,
            startSample: Math.round(Number(start.input.value) * 48000),
            sourceInSample: 0,
            durationSamples: Math.round(Number(duration.input.value) * 48000),
            lineId: line.value || null,
            sceneId: lineRecord?.sceneId || shotRecord?.sceneId || p.story.scenes[0]?.id || null,
            shotId: shot.value || null,
          },
        ]);
        this.close();
        this.c.select(receipt.detail.commands[0].clipId);
      },
      true,
    );
  }
  picture() {
    const p = this.c.state.project,
      old = p.pictures.find((x) => x.id === p.activePictureId),
      body = this.open('Import a picture version'),
      grid = el('div', 'modal-grid'),
      file = el('input');
    file.type = 'file';
    file.accept = '.mp4,.webm';
    file.setAttribute('aria-label', 'Picture file');
    const fileLabel = el('label', 'full', 'CFR MP4 or WebM');
    fileLabel.append(file);
    const fps = rateSelect(p.frameRate),
      fpsLabel = el('label', '', 'Exact frame rate');
    fpsLabel.append(fps);
    const mode = el('select');
    if (!old) mode.append(option('initial', 'Initial animatic / picture'));
    else {
      mode.append(option('new-cut', 'Changed cut — review before applying'));
      mode.append(option('same-cut', 'Same cut — improved picture only'));
    }
    const modeLabel = el('label', '', 'Timing relationship');
    modeLabel.append(mode);
    const sourceIn = field('First source frame', 0, { step: 1, min: 0 }),
      timeline = field('Timeline offset (samples)', 0, { step: 1, min: 0 });
    grid.append(fileLabel, fpsLabel, modeLabel, sourceIn.wrap, timeline.wrap);
    body.append(
      grid,
      el(
        'p',
        'hint',
        'A new file never silently replaces the current mix’s picture. Exact frame timing is checked on import.',
      ),
    );
    this.action(
      'Import version',
      async () => {
        if (!file.files[0]) throw new Error('Choose a picture file.');
        const result = await upload(p, file.files[0], 'picture', {
          frameRate: rateValue(fps),
          cutId: mode.value === 'same-cut' ? old.cutId : 'cut-' + crypto.randomUUID(),
          sourceInFrame: Number(sourceIn.input.value),
          timelineStartSample: Number(timeline.input.value),
        });
        await this.c.refresh();
        if (mode.value !== 'new-cut')
          await this.c.command([
            { type: 'picture.use', pictureId: result.detail.assetId, mode: mode.value },
          ]);
        this.close();
        if (mode.value === 'new-cut') this.cut(result.detail.assetId);
        else this.c.status('Picture version attached. Existing sound edits are preserved.');
      },
      true,
    );
  }
  versions() {
    const s = this.c.state,
      body = this.open('Saved versions');
    for (const v of [...s.record.versions].reverse()) {
      const row = el('div', 'version-row'),
        copy = el('div');
      copy.append(
        el('strong', '', v.label),
        el('small', '', 'Revision ' + v.revision + ' · ' + (v.pictureId || 'audio before picture')),
      );
      row.append(
        copy,
        button('Restore as new version', () =>
          this.c.run(async () => {
            await api('/api/restore', {
              projectId: s.project.id,
              expectedRevision: s.project.revision,
              requestId: requestId(),
              revision: v.revision,
            });
            this.close();
            await this.c.refresh();
            this.c.status('Earlier picture and sound edits restored as a new, undoable revision.');
          }),
        ),
      );
      body.append(row);
    }
    body.append(
      el(
        'p',
        'hint',
        'Restoring retains the current version in history. Original media is never overwritten.',
      ),
    );
  }
  automation() {
    const p = this.c.state.project,
      body = this.open('Edit automation'),
      target = el('select'),
      targets = [];
    for (const owner of [...p.tracks, ...p.buses]) {
      const kind = p.tracks.includes(owner) ? 'track' : 'bus';
      targets.push({
        kind,
        id: owner.id,
        parameter: 'gainDb',
        label: owner.name + (owner.kind ? ' track' : ' bus') + ' · volume (dB)',
      });
      for (const proc of owner.processors)
        for (const parameter of proc.type === 'gain' ? ['gainDb'] : ['cutoffHz', 'q'])
          targets.push({
            kind: 'processor',
            id: proc.id,
            parameter,
            label: owner.name + (owner.kind ? ' track' : ' bus') + ' · ' + parameter,
          });
    }
    targets.forEach((t, i) => target.append(option(String(i), t.label)));
    const existing = p.automation.find(
      (a) => a.target.kind === 'track' && a.target.id === 'track-music',
    );
    target.value = String(
      Math.max(
        0,
        targets.findIndex((t) => t.kind === 'track' && t.id === 'track-music'),
      ),
    );
    const label = el('label', 'wide-field', 'Parameter');
    label.append(target);
    const text = el('textarea', 'code-input');
    text.setAttribute('aria-label', 'Automation points');
    text.value = existing
      ? existing.points.map((pt) => pt.sample / 48000 + ',' + pt.value).join('\n')
      : '0,-6\n12,-18\n16,-18\n17,-6';
    const follow = el('input');
    follow.type = 'checkbox';
    follow.checked = existing?.anchor.type === 'cue';
    const followLabel = el('label', 'wide-field', '');
    followLabel.append(
      follow,
      el('span', '', 'Follow the selected dialogue cue (times become relative to that cue)'),
    );
    const interpolation = el('select');
    interpolation.append(
      option('linear', 'Linear in parameter units'),
      option('step', 'Step / hold'),
    );
    body.append(
      label,
      el('p', 'hint', 'One point per line: seconds,value. Volume uses dB; filter cutoff uses Hz.'),
      text,
      followLabel,
      interpolation,
    );
    this.action(
      'Apply automation',
      async () => {
        const chosen = targets[Number(target.value)],
          old = p.automation.find(
            (a) =>
              a.target.kind === chosen.kind &&
              a.target.id === chosen.id &&
              a.target.parameter === chosen.parameter,
          );
        const points = text.value
          .split('\n')
          .filter((x) => x.trim())
          .map((row) => {
            const [seconds, value] = row.split(',').map(Number);
            if (!Number.isFinite(seconds) || !Number.isFinite(value))
              throw new Error('Each automation row needs seconds,value.');
            return { sample: Math.sign(seconds) * Math.round(Math.abs(seconds) * 48000), value };
          });
        const clip = p.clips.find((c) => c.id === this.c.state.selectedClipId),
          cueId = clip?.anchor.type === 'cue' ? clip.anchor.cueId : null;
        if (follow.checked && !cueId)
          throw new Error('Select a dialogue clip to anchor this envelope.');
        await this.c.command([
          {
            type: 'automation.set',
            automation: {
              id: old?.id || 'automation-' + crypto.randomUUID(),
              target: { kind: chosen.kind, id: chosen.id, parameter: chosen.parameter },
              anchor: follow.checked ? { type: 'cue', cueId } : { type: 'timeline' },
              interpolation: interpolation.value,
              points,
            },
          },
        ]);
        this.close();
      },
      true,
    );
  }
  cut(preferredId = null) {
    const c = this.c,
      p = c.state.project,
      body = this.open('Review a picture change'),
      select = el('select');
    select.setAttribute('aria-label', 'New picture revision');
    select.append(option('', 'Choose an imported picture version'));
    for (const pic of p.pictures.filter((x) => x.id !== p.activePictureId))
      select.append(option(pic.id, pic.name + ' · ' + pic.cutId));
    select.value =
      preferredId || (c.state.demo?.projectId === p.id && c.state.demo.newPictureId) || '';
    const pictureLabel = el('label', 'wide-field', 'New picture version');
    pictureLabel.append(select);
    body.append(
      pictureLabel,
      el(
        'p',
        'hint',
        'Shot positions are frames from this session’s timeline origin. Same IDs preserve shot identity; a duplicated shot needs a new ID.',
      ),
    );
    const old = p.story.shots.filter((s) => s.isPresent !== false),
      preset = c.state.demo?.projectId === p.id ? c.state.demo.newShots : old;
    let rows = structuredClone(preset);
    const table = el('table', 'cut-table'),
      thead = el('thead'),
      head = el('tr');
    for (const text of ['Keep', 'Shot', 'Old start', 'New start', 'Length'])
      head.append(el('th', '', text));
    thead.append(head);
    const tbody = el('tbody');
    table.append(thead, tbody);
    const draw = () => {
      tbody.replaceChildren();
      for (const row of rows) {
        const tr = el('tr'),
          included = el('input');
        included.type = 'checkbox';
        included.checked = true;
        included.setAttribute('aria-label', 'Include ' + row.name);
        const includeCell = el('td');
        includeCell.append(included);
        const start = el('input');
        start.type = 'number';
        start.min = 0;
        start.step = 1;
        start.value = row.startFrame;
        start.setAttribute('aria-label', row.name + ' new start frame');
        const duration = el('input');
        duration.type = 'number';
        duration.min = 1;
        duration.step = 1;
        duration.value = row.durationFrames;
        duration.setAttribute('aria-label', row.name + ' duration frames');
        const startCell = el('td'),
          durationCell = el('td');
        startCell.append(start);
        durationCell.append(duration);
        tr.append(
          includeCell,
          el('td', '', row.name),
          el('td', '', String(old.find((s) => s.id === row.id)?.startFrame ?? 'new')),
          startCell,
          durationCell,
        );
        row._inputs = { included, start, duration };
        tbody.append(tr);
      }
    };
    draw();
    body.append(
      table,
      button('Add a shot', () => {
        const scene = p.story.scenes[0];
        if (!scene) {
          c.status('Add a scene or import Storytellr before defining shots.', true);
          return;
        }
        rows.push({
          id: 'shot-' + crypto.randomUUID(),
          sceneId: scene.id,
          name: 'New shot',
          startFrame: 0,
          durationFrames: 24,
          isPresent: true,
          sourceRef: null,
        });
        draw();
      }),
    );
    const results = el('div');
    body.append(results);
    let plan = null;
    const resolutions = {};
    const preview = this.action('Preview changes', async () => {
      this.exitPreview();
      if (!select.value) throw new Error('Choose a new picture revision.');
      const shots = rows
        .filter((s) => s._inputs.included.checked)
        .map((s) => {
          const { _inputs, ...shot } = s;
          return {
            ...shot,
            startFrame: Number(_inputs.start.value),
            durationFrames: Number(_inputs.duration.value),
          };
        });
      plan = await api('/api/reconform-preview', {
        projectId: p.id,
        expectedRevision: p.revision,
        pictureId: select.value,
        shots,
      });
      results.replaceChildren();
      for (const key of Object.keys(resolutions)) delete resolutions[key];
      const changes = el('div', 'change-list');
      changes.append(
        el('h3', '', plan.changes.length + ' safe changes · ' + plan.conflicts.length + ' choices'),
      );
      for (const change of plan.changes)
        if (change.kind === 'clip')
          changes.append(
            el(
              'p',
              '',
              change.name +
                ': ' +
                (change.before.startSample / 48000).toFixed(3) +
                ' s → ' +
                (change.after.startSample / 48000).toFixed(3) +
                ' s',
            ),
          );
      results.append(changes);
      const labels = {
        'keep-absolute': 'Keep at its current position',
        'extend-to-picture': 'Extend using existing source handles',
        park: 'Park this sound (keep the original)',
        trim: 'Trim to the new shot end',
        'follow-with-tail': 'Move with the shot; retain the tail',
        'follow-shots': 'Move points with their shots',
      };
      for (const conflict of plan.conflicts) {
        const row = el('div', 'conflict'),
          text = el('div');
        text.append(
          el('small', '', conflict.kind.replaceAll('-', ' ')),
          el('p', '', conflict.label),
        );
        const choice = el('select');
        choice.setAttribute('aria-label', conflict.label);
        choice.append(option('', 'Choose a resolution'));
        for (const value of conflict.options) choice.append(option(value, labels[value] || value));
        choice.onchange = () => {
          if (choice.value) resolutions[conflict.id] = choice.value;
          else delete resolutions[conflict.id];
          const ready = plan.conflicts.every((x) => resolutions[x.id]);
          apply.disabled = !ready;
          audition.disabled = !ready;
        };
        row.append(text, choice);
        results.append(row);
      }
      apply.disabled = plan.conflicts.length > 0;
      audition.disabled = plan.conflicts.length > 0;
      c.status('Read-only change plan ready. The saved mix has not changed.');
    });
    const audition = this.action('Audition proposed cut', async () => {
      if (!plan) return;
      const data = await api('/api/reconform-audition', {
        projectId: p.id,
        expectedRevision: p.revision,
        planId: plan.planId,
        resolutions,
      });
      c.state.audition = true;
      document.querySelector('#preview-banner').hidden = false;
      await c.transport.play(data.candidateProject, 0, data);
      c.status('Auditioning the proposal. Close this dialog to return to the saved cut.');
    });
    audition.disabled = true;
    const apply = this.action(
      'Apply reviewed changes',
      async () => {
        if (!plan) return;
        this.exitPreview();
        await api('/api/reconform-apply', {
          projectId: p.id,
          expectedRevision: p.revision,
          requestId: requestId(),
          planId: plan.planId,
          resolutions,
        });
        this.close();
        await c.refresh();
        c.status('Reviewed picture change applied. Undo restores the earlier cut and sound.');
      },
      true,
    );
    apply.disabled = true;
    select.onchange = () => {
      plan = null;
      results.replaceChildren();
      apply.disabled = true;
      audition.disabled = true;
    };
    table.addEventListener('input', () => {
      plan = null;
      apply.disabled = true;
      audition.disabled = true;
    });
  }
}
