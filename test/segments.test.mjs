import test from "node:test";
import assert from "node:assert/strict";
import { keysProblems, validateKeys, sampleLayer, sampleCamera, lastFrame, KeysError } from "../dist/index.js";

const doc = (layer, extra = {}) => ({ schema: "xjp.motion-keys.v1", fps: 24, size: [100, 100], layers: [{ id: "L", texture: "t", anchor: [0.5, 0.5], frames: [], ...layer }], ...extra });
const lin = (f0, f1, from, to, extra = {}) => ({ f0, f1, from, to, ease: "linear", ...extra });
const keyed = (v) => [0, 20, 40].map((f, i) => ({ f, x: v[i], y: 0, sx: 1, sy: 1, rot: 0, opacity: 1 }));

test("a covering segment wins; intervals are half-open, the last segment includes f1", () => {
  const L = { segments: { x: [lin(0, 10, 0, 100), lin(10, 20, 100, 50)] } };
  const l = doc(L).layers[0];
  assert.equal(sampleLayer(l, 5, undefined, 24).x, 50);
  assert.equal(sampleLayer(l, 10, undefined, 24).x, 100); // f = 10 belongs to the second segment (its from)
  assert.equal(sampleLayer(l, 15, undefined, 24).x, 75);
  assert.equal(sampleLayer(l, 20, undefined, 24).x, 50); // last segment includes f1
  assert.equal(sampleLayer(l, 20.5, undefined, 24).x, 50); // hold after
});
test("holes hold the previous `to`; before the first segment, the next `from`", () => {
  const l = doc({ segments: { x: [lin(10, 20, 5, 100), lin(40, 50, 100, 300)] } }).layers[0];
  assert.equal(sampleLayer(l, 0, undefined, 24).x, 5);
  assert.equal(sampleLayer(l, 30, undefined, 24).x, 100);
  assert.equal(sampleLayer(l, 45, undefined, 24).x, 200);
  assert.equal(sampleLayer(l, 99, undefined, 24).x, 300);
});
test("a channel with segments uses ONLY its segments (no fallback to keyed frames); other channels follow the frames", () => {
  const l = doc({ frames: keyed([0, 400, 800]), segments: { x: [lin(10, 15, 1000, 2000)] } }).layers[0];
  assert.equal(sampleLayer(l, 12.5, undefined, 24).x, 1500); // segment
  assert.equal(sampleLayer(l, 5, undefined, 24).x, 1000); // before the first segment: its from, NOT the keyed 100
  assert.equal(sampleLayer(l, 30, undefined, 24).x, 2000); // after: its to, NOT the keyed 600
  assert.equal(sampleLayer(l, 30, undefined, 24).opacity, 1); // another channel: still the frames
  assert.equal(sampleLayer(l, 5, undefined, 24).sx, 1);
  // gap between two segments holds the previous segment's `to`
  const g = doc({ frames: keyed([0, 400, 800]), segments: { x: [lin(0, 10, 0, 100), lin(20, 30, 500, 600)] } }).layers[0];
  assert.equal(sampleLayer(g, 15, undefined, 24).x, 100);
  assert.equal(sampleLayer(g, 10, undefined, 24).x, 100); // f1 of a non-last segment is already in the gap
  assert.equal(sampleLayer(g, 20, undefined, 24).x, 500);
  // a channel with segments but without keyed frames: segments, defaults elsewhere
  const noFrames = doc({ frames: [], segments: { sx: [lin(0, 10, 1, 3)] } }).layers[0];
  const s = sampleLayer(noFrames, 5, undefined, 24);
  assert.equal(s.sx, 2); assert.equal(s.sy, 1); assert.equal(s.x, 0); assert.equal(s.opacity, 1); assert.equal(s.z, 0); assert.equal(s.blur, undefined);
});
test("segment blur on a layer whose keys carry no blur", () => {
  const l = doc({ frames: keyed([0, 0, 0]), segments: { blur: [lin(0, 10, 0, 8)] } }).layers[0];
  assert.equal(sampleLayer(l, 5, undefined, 24).blur, 4);
  assert.equal(sampleLayer(l, 30, undefined, 24).blur, 8); // after the segment: its to
});
test("log space and eased segments through sampleLayer; interp does not touch segment channels", () => {
  const l = doc({ interp: "catmull", segments: { sx: [lin(0, 10, 1, 4, { space: "log" })], rot: [{ f0: 0, f1: 10, from: 0, to: 90, ease: { trapezoid: [0.2, 0.2] } }] } }).layers[0];
  assert.ok(Math.abs(sampleLayer(l, 5, undefined, 24).sx - 2) < 1e-9);
  assert.ok(Math.abs(sampleLayer(l, 5, undefined, 24).rot - 45) < 1e-9);
});
test("segments need fps", () => {
  const l = doc({ segments: { x: [lin(0, 10, 0, 1)] } }).layers[0];
  assert.throws(() => sampleLayer(l, 5), /fps is required/);
  assert.equal(sampleLayer(doc({ frames: keyed([0, 1, 2]) }).layers[0], 10).x, 0.5); // no segments: fps not needed
});
test("camera segments and lastFrame counts segment ends", () => {
  const k = doc({ frames: keyed([0, 1, 2]), segments: { x: [lin(0, 60, 0, 1)] } }, { camera: { segments: { z: [lin(0, 100, 0, 5)], fov: [lin(10, 20, 40, 60)] } } });
  assert.deepEqual(keysProblems(k), []);
  assert.deepEqual(sampleCamera(k, 50), { f: 50, z: 2.5, fov: 60 });
  assert.deepEqual(sampleCamera(k, 0), { f: 0, z: 0, fov: 40 });
  assert.equal(lastFrame(k), 100);
  assert.equal(lastFrame(doc({ frames: keyed([0, 1, 2]), segments: { x: [lin(0, 60, 0, 1)] } })), 60);
});
test("validation: overlap, order, unknown channel, bad ease, log, empty frames without segments", () => {
  const p = (seg, extra) => keysProblems(doc({ segments: seg, ...extra }));
  assert.deepEqual(p({ x: [lin(0, 10, 0, 1), lin(10, 20, 1, 2)] }), []); // touching is fine
  assert.deepEqual(p({ x: [lin(10, 20, 1, 2), lin(0, 10, 0, 1)] }), []); // order in the file does not matter
  assert.ok(p({ x: [lin(0, 10, 0, 1), lin(9, 20, 1, 2)] }).some((m) => m.includes("overlap")));
  assert.ok(p({ x: [lin(5, 5, 0, 1)] }).some((m) => m.includes("f1")));
  assert.ok(p({ q: [lin(0, 1, 0, 1)] }).some((m) => m.includes("unknown channel")));
  assert.ok(p({ x: [{ f0: 0, f1: 1, from: 0, to: 1, ease: "cubic" }] }).some((m) => m.includes("ease")));
  assert.ok(p({ x: [lin(0, 1, 0, 1, { space: "exp" })] }).some((m) => m.includes("space")));
  assert.ok(p({ x: [lin(0, 1, 0, 1, { space: "log" })] }).some((m) => m.includes("log space")));
  assert.ok(p({ x: [{ f0: "a", f1: 1, from: 0, to: 1, ease: "linear" }] }).some((m) => m.includes("f0")));
  assert.ok(keysProblems(doc({ segments: undefined })).some((m) => m.includes("frames must be a non-empty")));
  assert.ok(keysProblems(doc({ segments: {} })).some((m) => m.includes("frames must be a non-empty")));
  assert.ok(keysProblems({ ...doc({ frames: keyed([0, 1, 2]) }), camera: { frames: [] } }).some((m) => m.includes("camera.frames")));
  assert.ok(keysProblems(doc({ segments: { roll: [lin(0, 1, 0, 1)] } })).some((m) => m.includes("unknown channel")), "roll is a camera channel");
  assert.deepEqual(keysProblems(doc({ segments: { z: [lin(0, 1, 0, 1)] } })), []);
  assert.throws(() => validateKeys(doc({ segments: { x: [lin(0, 10, 0, 1), lin(5, 20, 1, 2)] } })), KeysError);
});
