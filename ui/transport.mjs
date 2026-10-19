import { api } from './api.mjs';
export class Transport {
  constructor(video, { onPosition, onState, onLevel, onError }) {
    this.video = video;
    this.onPosition = onPosition;
    this.onState = onState;
    this.onLevel = onLevel;
    this.onError = onError;
    this.position = 0;
    this.playing = false;
    this.generation = 0;
    this.observations = [];
    this.buffers = new Map();
  }
  outputTime(displayTime = performance.now()) {
    if (!this.context) return 0;
    const stamp = this.context.getOutputTimestamp?.();
    if (stamp && stamp.performanceTime > 0)
      return stamp.contextTime + (displayTime - stamp.performanceTime) / 1000;
    return this.context.currentTime - (this.context.outputLatency || this.context.baseLatency || 0);
  }
  currentSample(displayTime = performance.now()) {
    return this.playing
      ? Math.max(
          0,
          Math.min(
            this.project.durationSamples,
            this.offset + Math.max(0, this.outputTime(displayTime) - this.startAt) * 48000,
          ),
        )
      : this.position;
  }
  async play(project, offset = this.position, prepared = null) {
    this.stop(false);
    const generation = ++this.generation;
    this.project = project;
    this.offset = Math.max(0, Math.min(offset, project.durationSamples - 1));
    this.onState('preparing');
    try {
      this.context ||= new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await this.context.resume();
      const preview =
        prepared ||
        (await api('/api/preview', { projectId: project.id, expectedRevision: project.revision }));
      if (generation !== this.generation) return;
      let buffer = this.buffers.get(preview.contentHash);
      if (!buffer) {
        const response = await fetch(preview.url);
        if (response.status !== 200)
          throw new Error(
            'Prepared playback was intercepted or is unavailable. Reload the session and retry.',
          );
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength < 44) throw new Error('Prepared playback contains no audio data.');
        buffer = await this.context.decodeAudioData(bytes);
        this.buffers.set(preview.contentHash, buffer);
        if (this.buffers.size > 3) this.buffers.delete(this.buffers.keys().next().value);
      }
      if (generation !== this.generation) return;
      this.picture = project.pictures.find((p) => p.id === project.activePictureId) || null;
      if (this.picture) {
        const uri = '/asset/' + project.id + '/' + this.picture.id;
        if (this.video.dataset.pictureId !== this.picture.id) {
          this.video.src = uri;
          this.video.dataset.pictureId = this.picture.id;
        }
        await this.ready();
        const desired = this.videoTime(this.offset);
        this.video.currentTime = Math.max(
          (this.picture.sourceInFrame * this.picture.frameRate.denominator) /
            this.picture.frameRate.numerator,
          desired,
        );
        await this.seekReady();
      }
      if (generation !== this.generation) return;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.samples = new Float32Array(256);
      this.source = this.context.createBufferSource();
      this.source.buffer = buffer;
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.startAt = this.context.currentTime + 0.15;
      this.startedWall = performance.now();
      this.playing = true;
      this.source.start(this.startAt, this.offset / 48000);
      this.source.onended = () => {
        if (generation === this.generation) {
          this.position = project.durationSamples;
          this.stop(false);
          this.onPosition(this.position);
        }
      };
      this.onState('playing');
      this.tick();
      this.frameObservation(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.stop(false);
        this.onError(error);
      }
    }
  }
  videoTime(sample) {
    return (
      (this.picture.sourceInFrame * this.picture.frameRate.denominator) /
        this.picture.frameRate.numerator +
      (sample - this.picture.timelineStartSample) / 48000
    );
  }
  ready() {
    if (this.video.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => done(new Error('The browser could not open this picture proxy.')),
        8000,
      );
      const done = (error) => {
        clearTimeout(timer);
        this.video.removeEventListener('loadedmetadata', ok);
        this.video.removeEventListener('error', bad);
        error ? reject(error) : resolve();
      };
      const ok = () => done(),
        bad = () => done(new Error('Picture codec is unavailable in this browser.'));
      this.video.addEventListener('loadedmetadata', ok, { once: true });
      this.video.addEventListener('error', bad, { once: true });
    });
  }
  seekReady() {
    if (!this.video.seeking) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      this.video.addEventListener(
        'seeked',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  tick() {
    if (!this.playing) return;
    this.position = this.currentSample();
    this.onPosition(Math.round(this.position));
    if (this.picture) {
      const target = this.videoTime(this.position),
        end =
          (this.picture.durationFrames * this.picture.frameRate.denominator) /
          this.picture.frameRate.numerator;
      this.video.style.visibility =
        this.position >= this.picture.timelineStartSample && target < end ? 'visible' : 'hidden';
      if (
        this.position >= this.picture.timelineStartSample &&
        target < end &&
        this.outputTime() >= this.startAt
      ) {
        if (this.video.paused) this.video.play().catch(this.onError);
        const gap = target - this.video.currentTime,
          frame = this.picture.frameRate.denominator / this.picture.frameRate.numerator;
        if (Math.abs(gap) > Math.max(frame * 1.25, 0.075) && !this.video.seeking) {
          this.video.currentTime = target;
          this.lastCorrection = performance.now();
        } else this.video.playbackRate = 1 + Math.max(-0.03, Math.min(0.03, gap * 0.25));
      }
    }
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      let peak = 0;
      for (const value of this.samples) peak = Math.max(peak, Math.abs(value));
      this.onLevel(peak);
    }
    this.raf = requestAnimationFrame(() => this.tick());
  }
  frameObservation(generation) {
    if (!this.video.requestVideoFrameCallback) return;
    this.video.requestVideoFrameCallback((now, metadata) => {
      if (!this.playing || generation !== this.generation) return;
      if (
        this.picture &&
        now - this.startedWall > 1500 &&
        now - (this.lastCorrection || 0) > 1000
      ) {
        const sample = this.currentSample(metadata.expectedDisplayTime),
          target = this.videoTime(sample),
          residualFrames =
            ((metadata.mediaTime - target) * this.picture.frameRate.numerator) /
            this.picture.frameRate.denominator;
        this.observations.push({
          sample: Math.round(sample),
          mediaTime: metadata.mediaTime,
          residualFrames,
          observedAt: now,
        });
        if (this.observations.length > 500) this.observations.shift();
      }
      this.frameObservation(generation);
    });
  }
  stop(keepPosition = true) {
    if (keepPosition && this.playing) this.position = Math.round(this.currentSample());
    this.generation++;
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {}
      this.source.disconnect();
      this.source = null;
    }
    this.analyser?.disconnect();
    this.video.pause();
    this.video.playbackRate = 1;
    this.video.style.visibility =
      this.picture && this.position < this.picture.timelineStartSample ? 'hidden' : 'visible';
    this.onState('stopped');
    this.onLevel(0);
  }
  seek(sample, project) {
    const wasPlaying = this.playing;
    this.stop();
    this.project = project;
    this.position = Math.max(0, Math.min(sample, project.durationSamples - 1));
    this.picture = project.pictures.find((p) => p.id === project.activePictureId) || null;
    this.onPosition(this.position);
    if (wasPlaying) this.play(project, this.position);
    else if (this.picture && this.video.readyState >= 1) {
      const start =
        (this.picture.sourceInFrame * this.picture.frameRate.denominator) /
        this.picture.frameRate.numerator;
      this.video.currentTime = Math.max(
        start,
        start + (this.position - this.picture.timelineStartSample) / 48000,
      );
      this.video.style.visibility =
        this.position >= this.picture.timelineStartSample ? 'visible' : 'hidden';
    }
  }
}
