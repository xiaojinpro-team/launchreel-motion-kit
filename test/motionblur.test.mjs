import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planMotionBlur, planSamples, blurBounds, cardAt, layerShutter, SHUTTER_EPS, cardCorners, keysProblems, validateKeys, sampleShutter, fitShutter, toPoints, mergeSegments } from "../dist/index.js";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lin = (f0, f1, from, to, extra = {}) => ({ f0, f1, from, to, ease: "linear", ...extra });
const doc = (motionBlur, o = {}) => ({
  schema: "xjp.motion-keys.v1", fps: 24, size: [200, 100],
  layers: [{ id: "a", texture: "t", anchor: [0.5, 0.5], frames: [], segments: { x: [lin(0, 10, 0, 200)], y: [lin(0, 10, 50, 50)] }, ...(motionBlur === undefined ? {} : { motionBlur }), ...o }],
});
const plan = (mb, f = 5, extra = {}) => { const k = doc(mb, extra.layer); if (extra.camera) k.camera = extra.camera; return planMotionBlur(k, k.layers[0], f, [20, 20]); };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("off by default: false, absent, shutter 0 and a static layer all give no plan", () => {
  assert.equal(plan(undefined), null);
  assert.equal(plan(false), null);
  assert.equal(plan({ shutter: 0 }), null);
  assert.equal(plan(true, 5, { layer: { segments: { x: [lin(0, 10, 100, 100)], y: [lin(0, 10, 50, 50)] } } }), null);
});
test("accumulate: sub-frame times centred on f over shutter * strength; true means accumulate at shutter 0.5", () => {
  const p = plan(true);
  assert.equal(p.method, "accumulate");
  assert.equal(p.times.length, 7); // 10 px of travel at ~1.5 px per sample
  close(p.times.reduce((a, b) => a + b) / p.times.length, 5);
  close(p.times[0], 5 - 0.25 + 0.25 / 7); close(p.times.at(-1), 5 + 0.25 - 0.25 / 7);
  assert.deepEqual(plan({ method: "accumulate", shutter: 0.5 }), p);
  const strong = plan({ shutter: 0.5, strength: 2 });
  assert.equal(strong.times.length, 14);
  close(strong.times.at(-1) - strong.times[0], 1 - 1 / 14);
  assert.equal(plan({ shutter: 1, layer: undefined }).times.length, 14);
});
test("accumulate also blurs a static layer under a moving camera", () => {
  const camera = { segments: { x: [lin(0, 10, 0, 100)] } };
  const k = doc(true, { segments: { x: [lin(0, 10, 100, 100)], y: [lin(0, 10, 50, 50)] } }); k.camera = camera;
  const p = planMotionBlur(k, k.layers[0], 5, [20, 20]);
  assert.ok(p && p.method === "accumulate" && p.times.length > 2);
});
test("directional: streak = screen velocity * shutter * strength, sampled symmetrically about the card", () => {
  const p = plan({ method: "directional", shutter: 0.5 });
  assert.equal(p.method, "directional");
  assert.equal(p.offsets.length, 8); // 10 px streak
  close(p.offsets[0][0], -5); close(p.offsets.at(-1)[0], 5);
  assert.ok(p.offsets.every(([, y]) => y === 0));
  const strong = plan({ method: "directional", shutter: 0.5, strength: 2 });
  close(strong.offsets.at(-1)[0], 10); assert.equal(strong.offsets.length, 15);
  // y motion gives a vertical streak
  const v = plan({ method: "directional", shutter: 1 }, 5, { layer: { segments: { x: [lin(0, 10, 100, 100)], y: [lin(0, 10, 0, 50)] } } });
  close(v.offsets.at(-1)[1], 2.5); close(v.offsets.at(-1)[0], 0);
  // caps
  assert.equal(plan({ method: "directional", shutter: 1, strength: 40 }).offsets.length, 48);
  assert.equal(plan({ method: "accumulate", shutter: 1, strength: 40 }).times.length, 32);
});
test("radial: scales about the centre over 0.2 * shutter * strength; a static layer still gets it", () => {
  const still = { segments: { x: [lin(0, 10, 190, 190)], y: [lin(0, 10, 90, 90)] } }; // a card in the corner: its farthest corner is 111.8 px from the centre
  const p = plan({ method: "radial", shutter: 0.5 }, 5, { layer: still });
  assert.equal(p.method, "radial");
  assert.equal(p.scales.length, 9);
  close(p.scales[0], 0.95); close(p.scales.at(-1), 1.05);
  assert.deepEqual(p.center, [100, 50]);
  assert.deepEqual(plan({ method: "radial", shutter: 0.5, center: [20, 30] }, 5, { layer: still }).center, [20, 30]);
  assert.equal(plan({ method: "radial", shutter: 0.001 }, 5, { layer: still }), null); // too small to see
});
test("shutter as a segment list is sampled at f (clamped 0..1, default 0.5 outside)", () => {
  const mb = { method: "directional", shutter: [lin(0, 10, 0, 1)] };
  const a = plan(mb, 5), b = plan({ method: "directional", shutter: 0.5 }, 5);
  assert.deepEqual(a, b);
  assert.equal(plan(mb, 0), null); // shutter 0 at f = 0
  const over = plan({ method: "directional", shutter: [{ f0: 0, f1: 10, from: 2, to: 2, ease: "linear" }] }, 5);
  close(over.offsets.at(-1)[0], 10); // clamped to 1: streak 20 px
});
test("cardCorners honours anchor, scale and rotation", () => {
  const c = cardCorners({ x: 100, y: 50, sx: 2, sy: 1, rot: 90 }, [0.5, 0.5], 20, 20);
  const want = [[110, 30], [110, 70], [90, 70], [90, 30]]; // 90 degrees clockwise on a y-down canvas
  c.forEach((p, i) => { close(p[0], want[i][0], 1e-9); close(p[1], want[i][1], 1e-9); });
});

test("validation: motionBlur options and timeline.shutter forms", () => {
  assert.deepEqual(keysProblems(doc(true)), []);
  assert.deepEqual(keysProblems(doc({ shutter: [lin(0, 10, 0, 1)], method: "radial", strength: 2, center: [1, 2] })), []);
  const bad = (mb) => keysProblems(doc(mb)).join("|");
  assert.match(bad("yes"), /motionBlur must be/);
  assert.match(bad({ method: "gaussian" }), /method must be/);
  assert.match(bad({ strength: 0 }), /strength/);
  assert.match(bad({ center: [1] }), /center/);
  assert.match(bad({ shutter: 2 }), /shutter must be in 0..1/);
  assert.match(bad({ shutter: [lin(0, 10, 0, 1), lin(5, 20, 0, 1)] }), /overlap/);
  assert.match(bad({ bogus: 1 }), /unknown option/);
  const t = (shutter) => keysProblems({ ...doc(false), timeline: { shutter } }).join("|");
  assert.equal(t([{ f: 0, value: 0 }, { f: 1, value: 1 }]), "");
  assert.equal(t({ segments: [lin(0, 10, 0, 1)] }), "");
  assert.match(t({ segments: [lin(0, 10, 0, 2)] }), /to must be in 0..1/);
  assert.match(t({ segments: [lin(0, 10, 0, 1), lin(5, 8, 0, 1)] }), /overlap/);
  assert.match(t({ segments: [], other: 1 }), /may only have segments/);
});
test("timeline.shutter { segments }: 0 up to frame 48, then 1; eased overshoot is clamped; points still work", () => {
  const k = { ...doc(false), timeline: { shutter: { segments: [lin(0, 48, 0, 0), lin(48, 49, 0, 1)] } } };
  assert.deepEqual(keysProblems(k), []);
  assert.equal(sampleShutter(k, 47, 0.3), 0);
  assert.equal(sampleShutter(k, 48, 0.3), 0);
  assert.equal(sampleShutter(k, 49, 0.3), 1);
  assert.equal(sampleShutter(k, 99, 0.3), 1); // held after the last segment
  const spring = { ...doc(false), timeline: { shutter: { segments: [{ f0: 0, f1: 12, from: 0, to: 0.9, ease: { spring: [2, 0.3] } }] } } };
  for (let f = 0; f <= 12; f += 0.5) { const v = sampleShutter(spring, f, 0); assert.ok(v >= 0 && v <= 1); }
  assert.equal(sampleShutter({ ...doc(false), timeline: { shutter: [{ f: 0, value: 0.2 }] } }, 3, 0.9), 0.2);
  assert.equal(sampleShutter(doc(false), 3, 0.9), 0.9);
});

test("fitShutter: per-frame samples become hold / move / hold segments within 0.01 of the samples", () => {
  const v = Array.from({ length: 80 }, (_, f) => (f < 48 ? 0 : f >= 54 ? 1 : (f - 48) / 6));
  const r = fitShutter(toPoints(v), { fps: 24 });
  assert.deepEqual(r.segments.map((g) => [g.f0, g.f1, g.from, g.to]), [[0, 48, 0, 0], [48, 54, 0, 1], [54, 79, 1, 1]]);
  assert.ok(r.fit.max_abs <= 0.01 && r.fit.target_abs === 0.01);
  const k = mergeSegments(doc(false), "timeline.shutter", r.segments);
  validateKeys(k);
  assert.equal(sampleShutter(k, 47, 0.3), 0);
  assert.equal(sampleShutter(k, 60, 0.3), 1);
  assert.throws(() => fitShutter(toPoints([0, 0.5, 1.5]), { fps: 24 }), /0\.\.1/);
});
test("CLI: motion-fit --channel shutter --emit-keys timeline.shutter", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-shutter-"));
  try {
    const curve = path.join(dir, "shutter.json"), keys = path.join(dir, "keys.json"), out = path.join(dir, "out.json");
    fs.writeFileSync(curve, JSON.stringify(Array.from({ length: 60 }, (_, f) => (f < 20 ? 0 : 0.5))));
    fs.writeFileSync(keys, JSON.stringify(doc(false)));
    const r = spawnSync(process.execPath, [path.join(PKG, "bin/motion-fit.mjs"), curve, "--fps", "24", "--channel", "shutter", "--emit-keys", "timeline.shutter", "--keys", keys, "--out", out], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const merged = JSON.parse(fs.readFileSync(out, "utf8"));
    validateKeys(merged);
    assert.equal(sampleShutter(merged, 10, 0.9), 0);
    assert.equal(sampleShutter(merged, 40, 0.9), 0.5);
    assert.match(r.stderr, /note: rms and max are shares/);
    const bad = spawnSync(process.execPath, [path.join(PKG, "bin/motion-fit.mjs"), curve, "--fps", "24", "--channel", "zoom"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const withTimeline = (mb, shutter, extra = {}) => { const k = doc(mb, extra.layer); k.timeline = { shutter }; return k; };
test('shutter: "timeline" uses timeline.shutter as the envelope (times strength); <= 0.01 means no blur; validation', () => {
  const k = withTimeline({ method: "directional", shutter: "timeline" }, { segments: [lin(0, 8, 0, 0), { f0: 8, f1: 10, from: 0, to: 0.8, ease: "linear" }] });
  assert.deepEqual(keysProblems(k), []);
  assert.equal(planMotionBlur(k, k.layers[0], 4, [20, 20]), null); // envelope 0: no blur
  assert.equal(planMotionBlur(k, k.layers[0], 8, [20, 20]), null); // exactly 0
  const half = planMotionBlur(k, k.layers[0], 9, [20, 20]); // envelope 0.4: streak 20 px/frame * 0.4 = 8
  close(half.offsets.at(-1)[0], 4);
  const full = planMotionBlur(k, k.layers[0], 9.5, [20, 20]); // envelope 0.6
  close(full.offsets.at(-1)[0], 6);
  const ks = withTimeline({ method: "directional", shutter: "timeline", strength: 0.5 }, [{ f: 0, value: 0.8 }]);
  close(planMotionBlur(ks, ks.layers[0], 5, [20, 20]).offsets.at(-1)[0], 4); // 20 px/frame * (0.8 * 0.5) / 2
  assert.equal(layerShutter(doc(true), { shutter: "timeline" }, 3), 0.5); // no timeline: the default
  assert.equal(layerShutter(k, { shutter: "timeline" }, 9), 0.4);
  const tiny = withTimeline({ method: "radial", shutter: "timeline" }, [{ f: 0, value: SHUTTER_EPS }]);
  assert.equal(planMotionBlur(tiny, tiny.layers[0], 5, [20, 20]), null);
  assert.deepEqual(keysProblems(doc({ shutter: "timeline" })), []);
  assert.match(keysProblems(doc({ shutter: "always" })).join("|"), /number, a segment list or "timeline"/);
  // the same envelope drives radial strength: a stronger frame has a longer streak
  const kr = withTimeline({ method: "radial", shutter: "timeline" }, { segments: [lin(0, 10, 0.1, 0.8)] }, { layer: { segments: { x: [lin(0, 10, 190, 190)], y: [lin(0, 10, 90, 90)] } } });
  const lo = planMotionBlur(kr, kr.layers[0], 1, [20, 20]), hi = planMotionBlur(kr, kr.layers[0], 9, [20, 20]);
  assert.ok(hi.scales.at(-1) - 1 > lo.scales.at(-1) - 1);
});
test("blurBounds: the card's box plus the streak, clipped to the canvas; off-canvas layers have none", () => {
  const k = doc({ method: "directional", shutter: 1 });
  const layer = k.layers[0], card = cardAt(k, layer, 5), p = planMotionBlur(k, layer, 5, [20, 20]);
  const r = blurBounds(k, layer, 5, card, [20, 20], p); // card 90..110 x 40..60 at x = 100, streak +-10, pad 2
  assert.deepEqual(r, { x: 78, y: 38, w: 44, h: 24 });
  const edge = doc({ method: "directional", shutter: 1 }, { segments: { x: [lin(0, 10, -100, 0)], y: [lin(0, 10, 50, 50)] } }); // at f = 5 the card centre is at -50: fully off the left
  const e = edge.layers[0];
  assert.equal(blurBounds(edge, e, 5, cardAt(edge, e, 5), [20, 20], planMotionBlur(edge, e, 5, [20, 20])), null);
  const clipped = doc({ method: "directional", shutter: 1 }, { segments: { x: [lin(0, 10, -5, 0)], y: [lin(0, 10, 50, 50)] } });
  const c = clipped.layers[0], cr = blurBounds(clipped, c, 5, cardAt(clipped, c, 5), [20, 20], planMotionBlur(clipped, c, 5, [20, 20]));
  assert.equal(cr.x, 0);
  const rad = doc({ method: "radial", shutter: 1, center: [100, 50] }, { segments: { x: [lin(0, 10, 150, 150)], y: [lin(0, 10, 50, 50)] } });
  const rl = rad.layers[0], rp = planMotionBlur(rad, rl, 5, [20, 20]), rr = blurBounds(rad, rl, 5, cardAt(rad, rl, 5), [20, 20], rp);
  assert.ok(rr.x < 140 - 4 && rr.x + rr.w > 160 + 4 && rr.h < 60, JSON.stringify(rr)); // card 140..160 stretched about x = 100
  const acc = doc(true);
  const al = acc.layers[0], ap = planMotionBlur(acc, al, 5, [20, 20]), ar = blurBounds(acc, al, 5, cardAt(acc, al, 5), [20, 20], ap);
  assert.ok(ar.w >= 20 + 10 && ar.w < 20 + 10 + 8); // card + travel over the window + pad
});
test("sample scale thins every plan proportionally, never below 2 samples", () => {
  const k = doc({ method: "directional", shutter: 1, strength: 4 });
  const l = k.layers[0];
  const full = planMotionBlur(k, l, 5, [20, 20]), half = planMotionBlur(k, l, 5, [20, 20], 0.5), tiny = planMotionBlur(k, l, 5, [20, 20], 0.001);
  assert.equal(planSamples(full), 48);
  assert.equal(planSamples(half), 24);
  assert.equal(planSamples(tiny), 2);
  assert.equal(planSamples(null), 0);
  close(half.offsets.at(-1)[0], full.offsets.at(-1)[0]); // same streak, fewer samples
  const acc = planMotionBlur(doc({ shutter: 1, strength: 4 }), doc(true).layers[0], 5, [20, 20], 0.25);
  assert.ok(acc === null || planSamples(acc) >= 2);
});
