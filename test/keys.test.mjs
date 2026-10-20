import test from "node:test";
import assert from "node:assert/strict";
import { keysProblems, validateKeys, sampleLayer, sampleCamera, lastFrame, KeysError } from "../dist/index.js";

const layer = { id: "a", texture: "t", anchor: [0.5, 0.5], frames: [
  { f: 2, x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 0 },
  { f: 6, x: 100, y: 40, sx: 3, sy: 1, rot: 90, opacity: 1, blur: 8 },
  { f: 10, x: 100, y: 40, sx: 3, sy: 1, rot: 90, opacity: 1 } ] };
const doc = { schema: "xjp.motion-keys.v1", fps: 24, size: [320, 180], layers: [layer], camera: { frames: [{ f: 0, z: 0, fov: 40 }, { f: 4, z: 2, fov: 60 }] } };

test("linear interpolation between keyed frames", () => {
  const s = sampleLayer(layer, 4);
  assert.equal(s.x, 50); assert.equal(s.y, 20); assert.equal(s.sx, 2); assert.equal(s.rot, 45); assert.equal(s.opacity, 0.5); assert.equal(s.f, 4);
});
test("holds before the first and after the last key", () => {
  assert.equal(sampleLayer(layer, -5).x, 0);
  assert.equal(sampleLayer(layer, 99).x, 100);
  assert.equal(sampleLayer(layer, 2).opacity, 0);
  assert.equal(sampleLayer(layer, 10).opacity, 1);
});
test("optional blur interpolates against a missing key by holding the other value", () => {
  assert.equal(sampleLayer(layer, 4).blur, 8); // first key has no blur: takes 8 from the next
  assert.equal(sampleLayer(layer, 8).blur, 8);
  assert.equal(sampleLayer(layer, 0).blur, undefined);
});
test("camera sampling and lastFrame", () => {
  assert.deepEqual(sampleCamera(doc, 2), { f: 2, z: 1, fov: 50 });
  assert.equal(sampleCamera({ ...doc, camera: undefined }, 2), null);
  assert.equal(lastFrame(doc), 10);
});
test("validation accepts the fixture and names every problem", () => {
  assert.deepEqual(keysProblems(doc), []);
  assert.equal(validateKeys(doc), doc);
  const bad = { schema: "x", fps: 0, size: [1], layers: [{ id: "", texture: 1, anchor: [1], frames: [{ f: 1, x: "a" }, { f: 1 }] }, { id: "a", texture: "t", anchor: [0, 0], frames: [] }] };
  const p = keysProblems(bad);
  for (const needle of ["schema must be", "fps must be", "size must be", "id must be", "texture must be", "anchor must be", "x must be a finite number", "strictly greater", "frames must be a non-empty"]) {
    assert.ok(p.some((s) => s.includes(needle)), `missing problem: ${needle}\n${p.join("\n")}`);
  }
  assert.throws(() => validateKeys(bad), KeysError);
});

import { catmullRom, sampleShutter } from "../dist/index.js";
const L = (vals, extra = {}) => ({ id: "c", texture: "t", anchor: [0, 0], ...extra,
  frames: vals.map((v, i) => ({ f: i * 10, x: v, y: -v, sx: 1 + v, sy: 1, rot: v * 2, opacity: 0.5 })) });

test("catmull: midpoint of four known keys is (-p0 + 9 p1 + 9 p2 - p3) / 16", () => {
  const l = L([0, 10, 30, 40], { interp: "catmull" });
  const exp = (-0 + 9 * 10 + 9 * 30 - 40) / 16; // = 20
  assert.equal(sampleLayer(l, 15).x, exp);
  const l2 = L([0, 0, 10, 0], { interp: "catmull" });
  assert.equal(sampleLayer(l2, 15).x, (0 + 0 + 90 - 0) / 16);
  assert.equal(sampleLayer(l2, 15).y, -(90 / 16));
  assert.equal(sampleLayer(l2, 15).rot, (2 * 90) / 16); // rot is a plain channel, no wrap
  assert.equal(sampleLayer(l2, 15).opacity, 0.5);
  assert.equal(catmullRom(0, 0, 10, 0, 0.5), 90 / 16);
});
test("catmull passes through the keys and clamps the end segments", () => {
  const l = L([0, 10, 30, 40], { interp: "catmull" });
  for (const [f, v] of [[0, 0], [10, 10], [20, 30], [30, 40]]) assert.equal(sampleLayer(l, f).x, v);
  assert.equal(sampleLayer(l, 5).x, catmullRom(0, 0, 10, 30, 0.5)); // p0 clamped to the first key
  assert.equal(sampleLayer(l, 25).x, catmullRom(10, 30, 40, 40, 0.5)); // p3 clamped to the last key
  assert.equal(sampleLayer(l, 99).x, 40);
});
test("interp precedence: layer over document over linear; blur stays linear", () => {
  const plain = L([0, 0, 10, 0]);
  assert.equal(sampleLayer(plain, 15).x, 5); // default linear
  assert.equal(sampleLayer(plain, 15, "catmull").x, 90 / 16); // document level
  assert.equal(sampleLayer({ ...plain, interp: "linear" }, 15, "catmull").x, 5); // layer wins
  assert.equal(sampleLayer({ ...plain, interp: "catmull" }, 15, "linear").x, 90 / 16);
  const b = L([0, 0, 10, 0], { interp: "catmull" });
  b.frames.forEach((fr, i) => { fr.blur = [0, 0, 10, 0][i]; });
  assert.equal(sampleLayer(b, 15).blur, 5);
});
test("interp validation", () => {
  const ok = { ...doc, interp: "catmull", layers: [{ ...layer, interp: "linear" }] };
  assert.deepEqual(keysProblems(ok), []);
  const p = keysProblems({ ...doc, interp: "cubic", layers: [{ ...layer, interp: 1 }] });
  assert.equal(p.filter((s) => s.includes("interp must be")).length, 2);
});
test("timeline.shutter: 0 up to frame 48, 1 from 49, fallback without a timeline", () => {
  const k = { ...doc, timeline: { shutter: [{ f: 48, value: 0 }, { f: 49, value: 1 }] } };
  assert.deepEqual(keysProblems(k), []);
  assert.equal(sampleShutter(k, 0, 0.3), 0);
  assert.equal(sampleShutter(k, 48, 0.3), 0);
  assert.equal(sampleShutter(k, 48.5, 0.3), 0.5);
  assert.equal(sampleShutter(k, 49, 0.3), 1);
  assert.equal(sampleShutter(k, 200, 0.3), 1);
  assert.equal(sampleShutter(doc, 10, 0.3), 0.3);
  assert.equal(sampleShutter({ ...doc, timeline: {} }, 10, 0.3), 0.3);
});
test("timeline validation", () => {
  assert.ok(keysProblems({ ...doc, timeline: { shutter: [{ f: 0, value: 2 }] } }).some((s) => s.includes("0..1")));
  assert.ok(keysProblems({ ...doc, timeline: { shutter: [{ f: 5, value: 0 }, { f: 5, value: 1 }] } }).some((s) => s.includes("strictly greater")));
  assert.ok(keysProblems({ ...doc, timeline: [] }).some((s) => s.includes("timeline must be")));
});
