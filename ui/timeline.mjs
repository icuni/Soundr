import { el, button, frameToSample, sampleToFrame, timecode } from './api.mjs';
const COLORS = { dialogue: '#84b8b3', ambience: '#a3ad88', effects: '#cf9383', music: '#aaa4c8' },
  HEADER = 150;
export class Timeline {
  constructor(container, { onSelect, onCommit, onSeek, onDrag, onMute, onGain }) {
    Object.assign(this, { container, onSelect, onCommit, onSeek, onDrag, onMute, onGain });
    this.scale = 12;
    this.sample = 0;
  }
  render(project, selectedId) {
    this.project = project;
    this.selectedId = selectedId;
    this.container.replaceChildren();
    if (!project) return;
    const width = HEADER + (project.durationSamples / 48000) * this.scale + 40;
    this.container.style.width = width + 'px';
    const ruler = el('div', 'ruler');
    ruler.append(el('div', 'lane-spacer'));
    const interval = this.scale > 30 ? 1 : this.scale > 12 ? 5 : 10;
    for (let s = 0; s <= project.durationSamples / 48000; s += interval) {
      const text = el(
        'span',
        'ruler-label',
        timecode(Math.round(s * 48000), project.frameRate, project.timelineOrigin.timecode),
      );
      text.style.left = HEADER + s * this.scale + 'px';
      ruler.append(text);
    }
    ruler.addEventListener('click', (e) => {
      const x = e.clientX - ruler.getBoundingClientRect().left - HEADER;
      if (x >= 0) this.onSeek(Math.round((x / this.scale) * 48000));
    });
    this.container.append(ruler);
    const shots = el('div', 'shot-strip');
    shots.append(el('div', 'lane-spacer', 'PICTURE CUT'));
    for (const shot of project.story.shots.filter((s) => s.isPresent !== false)) {
      const node = el('div', 'shot', shot.name);
      node.style.left =
        HEADER +
        ((shot.startFrame * project.frameRate.denominator) / project.frameRate.numerator) *
          this.scale +
        'px';
      node.style.width =
        ((shot.durationFrames * project.frameRate.denominator) / project.frameRate.numerator) *
          this.scale +
        'px';
      shots.append(node);
    }
    this.container.append(shots);
    const activeTakes = new Set(project.takeGroups.map((g) => g.selectedTakeId));
    for (const track of project.tracks) {
      const row = el('div', 'track-row'),
        heading = el('div', 'track-heading');
      heading.append(el('strong', '', track.name));
      heading.style.borderLeft = '3px solid ' + COLORS[track.kind];
      const tools = el('div', 'track-tools'),
        mute = button('M', () => this.onMute(track), track.muted ? 'muted' : '');
      mute.setAttribute('aria-label', (track.muted ? 'Unmute ' : 'Mute ') + track.name);
      const gain = el('input');
      gain.type = 'range';
      gain.min = -60;
      gain.max = 12;
      gain.step = 1;
      gain.value = track.gainDb;
      gain.setAttribute('aria-label', track.name + ' volume');
      gain.addEventListener('change', () => this.onGain(track, Number(gain.value)));
      tools.append(mute, gain);
      heading.append(tools);
      row.append(heading);
      row.style.backgroundSize = this.scale * 10 + 'px 100%';
      const items = project.clips.filter((c) => c.trackId === track.id);
      let maxLane = 0;
      for (const clip of items) {
        const group = project.takeGroups.find((g) => g.takes.some((t) => t.id === clip.takeId)),
          lane = group ? group.takes.findIndex((t) => t.id === clip.takeId) : 0;
        maxLane = Math.max(maxLane, lane);
        const isInactive = clip.takeId && !activeTakes.has(clip.takeId),
          node = button(
            '',
            () => this.onSelect(clip.id),
            'clip' +
              (selectedId === clip.id ? ' selected' : '') +
              (isInactive ? ' inactive' : '') +
              (!clip.enabled ? ' disabled' : ''),
          );
        node.setAttribute('aria-label', clip.name + (isInactive ? ' — alternate take' : ''));
        node.setAttribute('aria-pressed', String(selectedId === clip.id));
        node.dataset.clipId = clip.id;
        node.style.setProperty('--clip-color', COLORS[track.kind]);
        node.style.left = HEADER + (clip.startSample / 48000) * this.scale + 'px';
        node.style.width = Math.max(4, (clip.durationSamples / 48000) * this.scale) + 'px';
        if (group && group.takes.length > 1) {
          node.style.height = '29px';
          node.style.top = 9 + lane * 32 + 'px';
        }
        const canvas = el('canvas');
        this.waveform(
          canvas,
          project.sources.find((s) => s.id === clip.sourceId),
          clip,
          COLORS[track.kind],
        );
        node.append(canvas, el('span', 'clip-name', clip.name));
        const left = el('span', 'trim-handle left'),
          right = el('span', 'trim-handle right');
        left.dataset.side = 'left';
        right.dataset.side = 'right';
        left.style.width = right.style.width =
          Math.min(7, Math.max(1, (clip.durationSamples / 48000) * this.scale * 0.2)) + 'px';
        node.append(left, right);
        node.addEventListener('dblclick', () => this.onSeek(clip.startSample));
        node.addEventListener('pointerdown', (event) => this.drag(event, node, clip));
        row.append(node);
      }
      if (maxLane) row.style.height = Math.max(77, 18 + (maxLane + 1) * 32) + 'px';
      this.container.append(row);
    }
    this.playhead = el('div', 'playhead');
    this.container.append(this.playhead);
    this.position(this.sample);
  }
  waveform(canvas, source, clip, color) {
    const width = Math.max(
      8,
      Math.min(4096, Math.ceil((clip.durationSamples / 48000) * this.scale)),
    );
    canvas.width = width;
    canvas.height = 54;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    if (!source) return;
    const peak = source.peaks;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const sample = clip.sourceInSample + (x / width) * clip.durationSamples,
        index = Math.min(peak.length - 1, Math.floor((sample / source.frames) * peak.length)),
        v = Math.min(1, (peak[index] || 0) * Math.pow(10, clip.gainDb / 20)),
        height = Math.max(1, v * 18);
      ctx.moveTo(x, 31 - height);
      ctx.lineTo(x, 31 + height);
    }
    ctx.stroke();
  }
  position(sample) {
    this.sample = sample;
    if (this.playhead) this.playhead.style.left = HEADER + (sample / 48000) * this.scale + 'px';
  }
  select(id) {
    this.selectedId = id;
    for (const node of this.container.querySelectorAll('.clip')) {
      const active = node.dataset.clipId === id;
      node.classList.toggle('selected', active);
      node.setAttribute('aria-pressed', String(active));
    }
  }
  drag(event, node, clip) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.onSelect(clip.id);
    this.onDrag(true);
    const start = event.clientX,
      side = event.target.dataset.side,
      p = this.project,
      source = p.sources.find((s) => s.id === clip.sourceId);
    let delta = 0;
    node.setPointerCapture(event.pointerId);
    const move = (e) => {
      const seconds = (e.clientX - start) / this.scale;
      delta = e.shiftKey
        ? Math.round(seconds * 48000)
        : frameToSample(
            sampleToFrame(clip.startSample, p.frameRate) +
              Math.round((seconds * p.frameRate.numerator) / p.frameRate.denominator),
            p.frameRate,
          ) - clip.startSample;
      if (side === 'left')
        delta = Math.max(
          -Math.min(clip.sourceInSample, clip.startSample),
          Math.min(clip.durationSamples - 1, delta),
        );
      else if (side === 'right')
        delta = Math.max(
          -clip.durationSamples + 1,
          Math.min(source.frames - clip.sourceInSample - clip.durationSamples, delta),
        );
      else delta = Math.max(-clip.startSample, delta);
      node.style.left =
        HEADER + ((clip.startSample + (side === 'right' ? 0 : delta)) / 48000) * this.scale + 'px';
      node.style.width =
        Math.max(
          4,
          ((clip.durationSamples + (side === 'left' ? -delta : side === 'right' ? delta : 0)) /
            48000) *
            this.scale,
        ) + 'px';
    };
    const up = async () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      this.onDrag(false);
      if (!delta) {
        this.render(p, this.selectedId);
        return;
      }
      const command = side
        ? {
            type: 'clip.trim',
            clipId: clip.id,
            side,
            amountSamples: side === 'right' ? -delta : delta,
          }
        : { type: 'clip.move', clipIds: [clip.id], deltaSamples: delta };
      await this.onCommit(command);
    };
    const cancel = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      this.onDrag(false);
      this.render(p, this.selectedId);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up, { once: true });
    node.addEventListener('pointercancel', cancel, { once: true });
  }
}
