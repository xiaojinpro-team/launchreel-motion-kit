import test from "node:test";
import assert from "node:assert/strict";
import { subframeTimes, averageFrames, accumulate, snapToDirect, FrameAccumulator } from "../dist/index.js";

test("subframe times: midpoints of equal slices of shutter/fps, centred on t by default", () => {
  assert.deepEqual(subframeTimes(1, 0, 8, 24), [1]);
  assert.deepEqual(subframeTimes(1, 0.5, 1, 24), [1]);
  const ts = subframeTimes(1, 1, 4, 24); // window = 1/24 s centred on 1
  const span = 1 / 24;
  assert.equal(ts.length, 4);
  ts.forEach((t, i) => assert.ok(Math.abs(t - (1 - span / 2 + ((i + 0.5) / 4) * span)) < 1e-12));
  assert.ok(Math.abs(ts.reduce((a, b) => a + b) / 4 - 1) < 1e-12); // centred
  const fwd = subframeTimes(1, 1, 2, 24, 0);
  assert.ok(fwd[0] > 1 && fwd[1] < 1 + span);
});
test("averageFrames: plain average, premultiplied for alpha", () => {
  const out = new Uint8ClampedArray(4);
  averageFrames([[0, 0, 0, 255], [255, 255, 255, 255]], out);
  assert.deepEqual([...out], [128, 128, 128, 255]);
  averageFrames([[200, 0, 0, 255], [0, 255, 0, 0]], out); // a fully transparent frame must not tint the colour
  assert.deepEqual([...out], [200, 0, 0, 128]);
  averageFrames([[1, 2, 3, 0], [9, 9, 9, 0]], out);
  assert.deepEqual([...out], [0, 0, 0, 0]);
});
test("accumulate renders subframes times at the right instants and averages them", async () => {
  const W = 2, H = 1, canvasData = new Uint8ClampedArray(W * H * 4);
  const ctx = { canvas: { width: W, height: H },
    getImageData: () => ({ data: Uint8ClampedArray.from(canvasData) }),
    createImageData: () => ({ data: new Uint8ClampedArray(W * H * 4) }),
    putImageData: (img) => canvasData.set(img.data) };
  const times = [];
  const frameFn = (t) => { times.push(t); const v = t < 1 ? 0 : 255; canvasData.set([v, v, v, 255, v, v, v, 255]); };
  await accumulate(frameFn, 1, 1, 2, ctx, { fps: 2 }); // window 0.5 s centred on 1: samples 0.875 and 1.125
  assert.deepEqual(times, [0.875, 1.125]);
  assert.deepEqual([...canvasData.slice(0, 4)], [128, 128, 128, 255]);
  times.length = 0;
  await accumulate(frameFn, 1, 0, 8, ctx, { fps: 2 });
  assert.deepEqual(times, [1]);
  await assert.rejects(() => accumulate(frameFn, 1, 1, 2, ctx), /fps is required/);
});

test("snapToDirect: only pixels within the sum-rounding tolerance of the direct draw are snapped", () => {
  const direct = Uint8ClampedArray.from([100, 100, 100, 255, 10, 20, 30, 255, 0, 0, 0, 0, 200, 0, 0, 255]);
  const blurred = Uint8ClampedArray.from([99, 99, 99, 255, 10, 20, 38, 255, 0, 0, 0, 2, 200, 0, 0, 128]);
  const n = snapToDirect(blurred, direct, 4);
  assert.equal(n, 2);
  assert.deepEqual([...blurred.slice(0, 4)], [100, 100, 100, 255]); // a flat pixel drifted by rounding: restored
  assert.deepEqual([...blurred.slice(4, 8)], [10, 20, 38, 255]); // 8 levels off: a real change, untouched
  assert.deepEqual([...blurred.slice(8, 12)], [0, 0, 0, 0]); // faint alpha haze: cleaned
  assert.deepEqual([...blurred.slice(12, 16)], [200, 0, 0, 128]); // alpha 128 vs 255: a real blur edge, untouched
  const same = Uint8ClampedArray.from(direct);
  assert.equal(snapToDirect(same, direct, 4), 0);
});
test("FrameAccumulator weights: a group mean of 4 frames counts 4 times", () => {
  const acc = new FrameAccumulator(1);
  acc.add([100, 0, 0, 255], 3);
  acc.add([0, 0, 0, 255], 1);
  const out = new Uint8ClampedArray(4);
  acc.into(out);
  assert.deepEqual([...out], [75, 0, 0, 255]);
  assert.equal(acc.count, 4);
});
