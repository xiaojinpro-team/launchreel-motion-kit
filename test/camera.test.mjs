import test from "node:test";
import assert from "node:assert/strict";
import { cardAt, snapFrame, makeRig, project, focalLength, sampleCamera, sampleLayer, keysProblems, validateKeys, buildCameraPresetLibrary, placePreset, cameraPresetsProblems, lastFrame } from "../dist/index.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const W = 200, H = 100; // fov 90 degrees: f = 50 px
const rig = (cam = {}) => makeRig({ f: 0, fov: 90, ...cam }, W, H);

test("focal length and the home camera: a z = 0 card is drawn where and as big as it is", () => {
  close(focalLength(90, H), 50);
  close(focalLength(40, 1080), 540 / Math.tan((20 * Math.PI) / 180));
  const p = project(rig(), 110, 50, 0);
  close(p.x, 110); close(p.y, 50); close(p.scale, 1);
});
test("depth: z = 50 is twice as far (half the size, half the offset); a push-in doubles the plane at z = 0", () => {
  const far = project(rig(), 110, 50, 50);
  close(far.scale, 0.5); close(far.x, 105);
  const push = project(rig({ z: 25 }), 110, 50, 0);
  close(push.scale, 2); close(push.x, 120);
  const out = project(rig({ z: 100 }), 110, 50, 0);
  close(out.scale, 0.5);
});
test("pan and roll", () => {
  const pan = project(rig({ x: 10 }), 110, 50, 0);
  close(pan.x, 100); close(pan.scale, 1);
  const roll = project(rig({ roll: 90 }), 110, 50, 0); // a point right of centre goes below it: clockwise
  close(roll.x, 100); close(roll.y, 60);
  assert.equal(project(rig(), 100, 50, -100).alpha, 0); // behind the lens: clamped, invisible (no longer dropped)
});
test("look-at target: the target stays at the centre while the lens moves; deeper layers slide with parallax", () => {
  const c = project(rig({ x: 100, z: 50, tx: 0, ty: 0 }), 100, 50, 0); // canvas centre = origin
  close(c.x, 100, 1e-9); close(c.y, 50, 1e-9);
  close(c.scale, 50 / Math.hypot(100, 50)); // distance along the view axis
  const right = project(rig({ x: 100, z: 50, tx: 0, ty: 0 }), 100, 50, 100);
  const left = project(rig({ x: -100, z: 50, tx: 0, ty: 0 }), 100, 50, 100);
  assert.ok(Math.abs(right.x - 100) > 5);
  close(right.x + left.x, 2 * 100, 1e-9); // mirror image
  // tx without ty is not a target
  const noTarget = project(rig({ x: 10, tx: 0 }), 110, 50, 0);
  close(noTarget.x, 100);
});

const keysDoc = (camera, layers = []) => ({ schema: "xjp.motion-keys.v1", fps: 24, size: [W, H], layers: [{ id: "a", texture: "t", anchor: [0.5, 0.5], frames: [{ f: 0, x: 100, y: 50, sx: 1, sy: 1, rot: 0, opacity: 1 }], ...layers[0] }], camera });
test("camera channels in keys: frames with optional x/y/roll/target, segments, log-space z and fov by default, validation", () => {
  const k = keysDoc({ frames: [{ f: 0, z: 100, fov: 40, x: 0, roll: 0, tx: 1, ty: 2 }, { f: 10, z: 50, fov: 40, x: 10, roll: 5, tx: 1, ty: 2, tz: 3 }] });
  assert.deepEqual(keysProblems(k), []);
  const s = sampleCamera(k, 5);
  assert.deepEqual([s.z, s.x, s.roll, s.tx, s.fov], [75, 5, 2.5, 1, 40]);
  const seg = keysDoc({ segments: { z: [{ f0: 0, f1: 10, from: 100, to: 25, ease: "linear" }], fov: [{ f0: 0, f1: 10, from: 20, to: 80, ease: "linear" }], x: [{ f0: 0, f1: 10, from: -10, to: 10, ease: "linear" }] } });
  assert.deepEqual(keysProblems(seg), []);
  const m = sampleCamera(seg, 5);
  close(m.z, 50); close(m.fov, 40); close(m.x, 0); // geometric means for z and fov, linear for x
  const lin = sampleCamera(keysDoc({ segments: { z: [{ f0: 0, f1: 10, from: 100, to: 25, ease: "linear", space: "linear" }] } }), 5);
  close(lin.z, 62.5); // an explicit space wins
  const crossZero = sampleCamera(keysDoc({ segments: { z: [{ f0: 0, f1: 10, from: 0, to: 10, ease: "linear" }] } }), 5);
  close(crossZero.z, 5); // from <= 0: falls back to linear instead of throwing
  assert.deepEqual(sampleCamera(keysDoc({ segments: { x: [{ f0: 0, f1: 10, from: 0, to: 1, ease: "linear" }] } }), 5), { f: 5, fov: 40, x: 0.5 });
  assert.ok(keysProblems(keysDoc({ frames: [{ f: 0, z: 1, fov: 40, roll: "a" }] })).some((p) => p.includes("roll")));
  assert.ok(keysProblems(keysDoc({ segments: { w: [{ f0: 0, f1: 1, from: 0, to: 1, ease: "linear" }] } })).some((p) => p.includes("unknown channel")));
});
test("layer z channel: frames, segments, default 0", () => {
  const l = keysDoc(undefined, [{ frames: [{ f: 0, x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 1, z: 0 }, { f: 10, x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 1, z: 100 }] }]).layers[0];
  assert.equal(sampleLayer(l, 5).z, 50);
  assert.equal(sampleLayer(keysDoc().layers[0], 5).z, undefined); // no z keyed: the player treats it as 0
  const sg = keysDoc(undefined, [{ frames: [], segments: { z: [{ f0: 0, f1: 4, from: 0, to: 8, ease: "linear" }] } }]).layers[0];
  assert.equal(sampleLayer(sg, 2, undefined, 24).z, 4);
  assert.deepEqual(keysProblems(keysDoc(undefined, [{ frames: l.frames }])), []);
});

// ------------------------------------------------------------------------------------------------ presets
const lib = buildCameraPresetLibrary({ size: [1920, 1080], fov: 40 });
const preset = (id) => lib.presets.find((p) => p.id === id);
const docWith = (segments) => ({ schema: "xjp.motion-keys.v1", fps: 24, size: [1920, 1080], layers: [{ id: "a", texture: "t", anchor: [0.5, 0.5], frames: [{ f: 0, x: 960, y: 540, sx: 1, sy: 1, rot: 0, opacity: 1 }] }], camera: { segments } });

test("preset library: seven presets, valid, JSON friendly", () => {
  assert.deepEqual(lib.presets.map((p) => p.id), ["push-in", "pull-out", "dolly-zoom", "orbit", "crash-zoom", "whip-pan", "handheld"]);
  assert.deepEqual(cameraPresetsProblems(JSON.parse(JSON.stringify(lib))), []);
  assert.ok(cameraPresetsProblems({ schema: "x", presets: [{ id: "a", duration_frames: 0, segments: {} }] }).length >= 2);
  for (const p of lib.presets) assert.deepEqual(keysProblems(docWith(placePreset(p))), [], p.id);
});
test("push-in / pull-out / crash-zoom change the plane scale in the right direction", () => {
  const scaleAt = (id, f) => { const k = docWith(placePreset(preset(id))); return project(makeRig(sampleCamera(k, f), 1920, 1080), 960 + 100, 540, 0).scale; };
  close(scaleAt("push-in", 0), 1, 1e-6);
  assert.ok(scaleAt("push-in", 24) > 1.4 && scaleAt("push-in", 12) > 1 && scaleAt("push-in", 12) < scaleAt("push-in", 24));
  assert.ok(scaleAt("pull-out", 24) < 0.7);
  assert.ok(scaleAt("crash-zoom", 10) > 3);
});
test("dolly-zoom: the z = 0 subject keeps its size (<= 0.5%) while a deep background stretches", () => {
  const k = docWith(placePreset(preset("dolly-zoom")));
  const n = preset("dolly-zoom").duration_frames;
  const at = (f, z) => project(makeRig(sampleCamera(k, f), 1920, 1080), 960 + 200, 540, z).scale;
  for (let f = 0; f <= n; f++) close(at(f, 0) / at(0, 0), 1, 0.005);
  const bg0 = at(0, 2000), bg1 = at(n, 2000);
  assert.ok(Math.abs(bg1 / bg0 - 1) > 0.3, `background ${bg0} -> ${bg1}`);
  assert.ok(sampleCamera(k, n).fov > sampleCamera(k, 0).fov && sampleCamera(k, n).z < sampleCamera(k, 0).z, "fov widens while the lens moves in");
});
test("orbit: the centre point stays put (target), deeper layers slide, the arc is symmetric", () => {
  const k = docWith(placePreset(preset("orbit")));
  const n = preset("orbit").duration_frames;
  for (const f of [0, 10, 24, 40, n]) {
    const cam = sampleCamera(k, f), rg = makeRig(cam, 1920, 1080);
    const c = project(rg, 960, 540, 0);
    close(c.x, 960, 1e-6); close(c.y, 540, 1e-6);
  }
  const deep = (f) => project(makeRig(sampleCamera(k, f), 1920, 1080), 960, 540, 600).x;
  assert.ok(Math.abs(deep(0) - 960) > 20);
  close(deep(0) + deep(n), 2 * 960, 1e-3);
  close(deep(n / 2), 960, 1e-3);
});
test("whip-pan moves 1.5 screen widths; handheld is deterministic per seed and bounded", () => {
  const k = docWith(placePreset(preset("whip-pan")));
  close(sampleCamera(k, 12).x, 1920 * 1.5, 1e-3);
  const h1 = buildCameraPresetLibrary({ size: [1920, 1080], seed: 7 }), h2 = buildCameraPresetLibrary({ size: [1920, 1080], seed: 7 }), h3 = buildCameraPresetLibrary({ size: [1920, 1080], seed: 8 });
  const hh = (l) => l.presets.find((p) => p.id === "handheld").segments;
  assert.deepEqual(hh(h1), hh(h2));
  assert.notDeepEqual(hh(h1), hh(h3));
  for (const sg of hh(h1).x) assert.ok(Math.abs(sg.to) <= 3 + 1e-9 && Math.abs(sg.from) <= 3 + 1e-9);
  for (const sg of hh(h1).roll) assert.ok(Math.abs(sg.to) <= 0.25 + 1e-9);
  assert.equal(hh(h1).x[0].from, 0);
});
test("placePreset moves and stretches (spring/bezier eases are untouched); lastFrame counts it", () => {
  const p = preset("push-in");
  const placed = placePreset(p, { f0: 100, duration_frames: 48 });
  assert.deepEqual([placed.z[0].f0, placed.z[0].f1], [100, 148]);
  assert.deepEqual(placed.z[0].ease, p.segments.z[0].ease);
  assert.equal(lastFrame(docWith(placed)), 148);
  const h = placePreset(preset("handheld"), { duration_frames: 144 });
  assert.equal(h.x.at(-1).f1, 144);
  assert.throws(() => placePreset(p, { duration_frames: 0 }), RangeError);
  assert.equal(JSON.stringify(placePreset(p)), JSON.stringify(p.segments)); // identity placement
});

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
test("CLI: motion-presets prints the library and a placed preset", () => {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "../bin/motion-presets.mjs");
  const run = (...a) => spawnSync(process.execPath, [bin, ...a], { encoding: "utf8" });
  const all = run("--size", "1920x1080");
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(cameraPresetsProblems(JSON.parse(all.stdout)), []);
  const one = JSON.parse(run("--size", "1920x1080", "--place", "push-in", "--f0", "120", "--frames", "36").stdout);
  assert.deepEqual([one.camera.segments.z[0].f0, one.camera.segments.z[0].f1], [120, 156]);
  assert.equal(run("--size", "1920x1080", "--place", "nope").status, 2);
  assert.equal(run("--size", "big").status, 2);
});

test("near plane: clamped to near (default 0.02 * f), alpha ramps 0 -> 1 over [near, 2 * near], nothing is dropped", () => {
  const f = 50, near = 1; // fov 90 on H = 100
  const at = (zc, cam = {}, opt) => project(makeRig({ f: 0, fov: 90, ...cam }, W, H, opt), 100, 50, zc - f); // home camera: depth = z + f
  close(makeRig({ f: 0, fov: 90 }, W, H).near, near);
  const full = at(2);
  close(full.alpha, 1); close(full.scale, f / 2);
  const half = at(1.5);
  close(half.alpha, 0.5); close(half.scale, f / 1.5); // inside the ramp the true scale is used
  const edge = at(1);
  close(edge.alpha, 0); close(edge.scale, f / near);
  const inside = at(0.4); // clamped: same scale as at near, invisible
  close(inside.alpha, 0); close(inside.scale, f / near);
  const behind = at(-30);
  close(behind.alpha, 0); close(behind.scale, f / near); assert.ok(Number.isFinite(behind.x) && Number.isFinite(behind.y));
  close(at(100).alpha, 1);
  // configurable near and the fade switch
  close(at(7.5, {}, { near: 5 }).alpha, 0.5);
  close(at(7.5, {}, { near: 5 }).scale, f / 7.5);
  const noFade = at(0.4, {}, { nearFade: false });
  close(noFade.alpha, 1); close(noFade.scale, f / near); // drawn at full alpha, clamped
  close(at(1.5, {}, { nearFade: false }).alpha, 1);
});
test("near plane through the player: opacity is multiplied by the fade; camera.near / nearFade are read from the document", () => {
  const mk = (z, camera) => ({ schema: "xjp.motion-keys.v1", fps: 24, size: [W, H], layers: [{ id: "a", texture: "t", anchor: [0.5, 0.5], frames: [{ f: 0, x: 100, y: 50, sx: 1, sy: 1, rot: 0, opacity: 0.8, z }] }], camera });
  const cam = { frames: [{ f: 0, z: 50, fov: 90 }] };
  close(cardAt(mk(-48.5, cam), mk(-48.5, cam).layers[0], 0).s.opacity, 0.4); // zc = 1.5: half faded
  close(cardAt(mk(0, cam), mk(0, cam).layers[0], 0).s.opacity, 0.8); // far enough: untouched
  const c2 = { ...cam, near: 5 };
  close(cardAt(mk(-42.5, c2), mk(-42.5, c2).layers[0], 0).s.opacity, 0.4); // zc = 7.5 with near 5
  const c3 = { ...cam, nearFade: false };
  const k3 = mk(-49.6, c3), card = cardAt(k3, k3.layers[0], 0);
  close(card.s.opacity, 0.8); close(card.xf.sx, 50 / 1); // clamped to near = 1
  assert.deepEqual(keysProblems(mk(0, c2)), []);
  assert.ok(keysProblems(mk(0, { ...cam, near: 0 })).some((p) => p.includes("camera.near")));
  assert.ok(keysProblems(mk(0, { ...cam, nearFade: "no" })).some((p) => p.includes("camera.nearFade")));
});
test("integer frames are evaluated at the frame start: a segment gives exactly `from` at f0, and t = f / fps never lands before f0", () => {
  const seg = (f0, f1, v) => ({ f0, f1, from: v, to: v, ease: "linear" });
  const layer = { id: "a", texture: "t", anchor: [0, 0], frames: [], segments: { opacity: [seg(0, 30, 0), { f0: 30, f1: 40, from: 1, to: 0.5, ease: "linear" }] } };
  assert.equal(sampleLayer(layer, 30, undefined, 24).opacity, 1); // f0: from
  assert.equal(sampleLayer(layer, 29.999999, undefined, 24).opacity, 0); // the frame before never sees it
  assert.equal(sampleLayer(layer, 40, undefined, 24).opacity, 0.5); // the last segment still includes f1
  for (const fps of [24, 25, 29.97, 23.976, 30, 59.94]) {
    for (let f = 0; f <= 3000; f++) assert.equal(snapFrame((f / fps) * fps), f, `fps ${fps} frame ${f}`);
  }
  assert.equal(snapFrame(10.5), 10.5);
  assert.equal(snapFrame(10.001), 10.001);
  // a frame time exactly on the boundary of a segment, through the same path as the renderer
  const fps = 29.97, t = 30 / fps;
  assert.equal(sampleLayer(layer, snapFrame(t * fps), undefined, fps).opacity, 1);
});
