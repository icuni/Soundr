import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from '../ui/transport.mjs';
test('picture source-in stays excluded before its timeline start in seek and transport', () => {
  let played = 0,
    position = 0;
  const video = {
    readyState: 4,
    currentTime: 0,
    paused: true,
    style: {},
    pause() {
      this.paused = true;
    },
    play() {
      played++;
      this.paused = false;
      return Promise.resolve();
    },
  };
  const t = new Transport(video, {
    onPosition() {},
    onState() {},
    onLevel() {},
    onError(e) {
      throw e;
    },
  });
  const picture = {
    id: 'picture-offset',
    sourceInFrame: 1,
    timelineStartSample: 4800,
    durationFrames: 120,
    frameRate: { numerator: 30000, denominator: 1001 },
  };
  const p = { durationSamples: 195390, activePictureId: picture.id, pictures: [picture] };
  t.seek(0, p);
  assert.equal(video.style.visibility, 'hidden');
  assert.equal(video.currentTime, 1001 / 30000);
  t.stop();
  assert.equal(video.style.visibility, 'hidden');
  t.seek(4800, p);
  assert.equal(video.style.visibility, 'visible');
  assert.equal(video.currentTime, 1001 / 30000);
  const previousRAF = globalThis.requestAnimationFrame,
    previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    t.playing = true;
    t.startAt = 0;
    t.currentSample = () => position;
    t.outputTime = () => 1;
    video.paused = true;
    t.tick();
    assert.equal(video.style.visibility, 'hidden');
    assert.equal(played, 0);
    position = 4800;
    t.tick();
    assert.equal(video.style.visibility, 'visible');
    assert.equal(played, 1);
  } finally {
    t.stop();
    if (previousRAF) globalThis.requestAnimationFrame = previousRAF;
    else delete globalThis.requestAnimationFrame;
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel;
    else delete globalThis.cancelAnimationFrame;
  }
});
