import test from "node:test";
import assert from "node:assert/strict";
import { linear, bezier, trapezoid, spring, easeFromSpec, easeProblems, evaluateSegment } from "../dist/index.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("linear", () => { const e = linear(); assert.equal(e(0), 0); assert.equal(e(0.3), 0.3); assert.equal(e(1), 1); assert.equal(e(2), 1); assert.equal(e(-1), 0); });

test("bezier matches CSS keyword curves", () => {
  const inOut = bezier(0.42, 0, 0.58, 1); // ease-in-out
  close(inOut(0.5), 0.5);
  close(inOut(0.25) + inOut(0.75), 1); // symmetric
  const ease = bezier(0.25, 0.1, 0.25, 1); // CSS "ease"
  close(ease(0.5), 0.8024, 1e-3);
  const lin = bezier(0, 0, 1, 1);
  for (const u of [0, 0.1, 0.5, 0.9, 1]) close(lin(u), u, 1e-6);
  const ci = bezier(0.42, 0, 1, 1); // ease-in: slow start
  assert.ok(ci(0.25) < 0.25 && ci(0.75) < 0.75);
  assert.equal(inOut(0), 0); assert.equal(inOut(1), 1);
  assert.throws(() => bezier(1.2, 0, 0.5, 1), RangeError);
});
test("bezier with a steep x curve still solves (bisection fallback) and is monotone for monotone y", () => {
  const e = bezier(1, 0, 0, 1);
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const v = e(i / 100); assert.ok(v >= prev - 1e-9); prev = v; }
});

test("trapezoid: end points, constant-speed middle, symmetric ramps", () => {
  const t = trapezoid(0.2, 0.2);
  assert.equal(t(0), 0); assert.equal(t(1), 1);
  close(t(0.2), 0.125); close(t(0.5), 0.5); close(t(0.8), 0.875);
  const slope = (u) => (t(u + 0.001) - t(u - 0.001)) / 0.002;
  close(slope(0.4), 1.25, 1e-6); close(slope(0.6), 1.25, 1e-6); // vmax = 1 / (1 - (a+d)/2)
  assert.ok(slope(0.05) < slope(0.15)); // accelerating
  assert.ok(slope(0.85) > slope(0.95)); // decelerating
  close(slope(0.2 - 0.0011), 1.25 * (0.2 - 0.0011) / 0.2, 1e-3); // linear ramp of speed
  for (const u of [0.1, 0.35, 0.9]) close(t(u) + t(1 - u), 1); // point symmetry for equal ramps
});
test("trapezoid degenerate cases", () => {
  const l = trapezoid(0, 0);
  for (const u of [0, 0.25, 0.5, 1]) close(l(u), u);
  const a = trapezoid(1, 0); // accelerate the whole way: u^2
  close(a(0.5), 0.25);
  const d = trapezoid(0, 1); // decelerate the whole way: 1 - (1-u)^2
  close(d(0.5), 0.75);
  assert.throws(() => trapezoid(0.7, 0.5), RangeError);
});

test("spring: under-damped overshoots and settles, critical and over-damped do not overshoot", () => {
  const s = spring(2, 0.5);
  assert.equal(s(0, 2), 0);
  const peak = Math.max(...Array.from({ length: 200 }, (_, i) => s(i / 199, 2)));
  assert.ok(peak > 1.1 && peak < 1.25, `peak ${peak}`); // exp(-pi z / sqrt(1-z^2)) = 0.163 for z = .5
  close(s(1, 2), 1, 1e-3); // 2 s is long enough to settle; the end is not forced
  for (const z of [1, 2]) {
    const e = spring(2, z);
    for (let i = 0; i <= 100; i++) assert.ok(e(i / 100, 2) <= 1 + 1e-9);
    close(e(1, 2), 1, 2e-3);
  }
  const short = spring(2, 0.5)(1, 0.1);
  assert.ok(short < 0.9, "a spring cut short is not settled"); // allowed: the caller decides
});
test("spring uses the real segment length", () => {
  const s = spring(2, 0.4);
  assert.notEqual(s(0.5, 1), s(0.5, 2));
  close(s(0.25, 2), s(0.5, 1)); // same real time 0.5 s
});

test("spec round trip and validation", () => {
  assert.equal(easeFromSpec("linear")(0.4), 0.4);
  close(easeFromSpec({ bezier: [0.42, 0, 0.58, 1] })(0.5), 0.5);
  close(easeFromSpec({ trapezoid: [0.2, 0.2] })(0.5), 0.5);
  close(easeFromSpec({ spring: [2, 1] })(1, 2), spring(2, 1)(1, 2));
  for (const bad of ["ease", { bezier: [1, 2, 3] }, { bezier: [2, 0, 0, 1] }, { trapezoid: [0.8, 0.8] }, { spring: [0, 0.5] }, { a: 1, b: 2 }, null, 3])
    assert.ok(easeProblems(bad).length > 0, JSON.stringify(bad));
  assert.deepEqual(easeProblems({ spring: [3, 0.4] }), []);
});

test("evaluateSegment: linear and log space", () => {
  const lin = { f0: 10, f1: 20, from: 100, to: 200, ease: "linear" };
  assert.equal(evaluateSegment(lin, 15, 24), 150);
  assert.equal(evaluateSegment(lin, 0, 24), 100); // clamped
  assert.equal(evaluateSegment(lin, 99, 24), 200);
  const log = { f0: 0, f1: 10, from: 1, to: 4, ease: "linear", space: "log" };
  close(evaluateSegment(log, 5, 24), 2); // geometric midpoint
  close(evaluateSegment(log, 2.5, 24), Math.pow(4, 0.25));
  assert.throws(() => evaluateSegment({ ...log, from: 0 }, 5, 24), RangeError);
  const sp = { f0: 0, f1: 48, from: 0, to: 10, ease: { spring: [2, 0.4] } }; // 2 s at 24 fps
  close(evaluateSegment(sp, 24, 24), 10 * spring(2, 0.4)(0.5, 2));
});
