import test from "node:test";
import assert from "node:assert/strict";
import { installCompat } from "../dist/compat.js";

const fakeWin = (extra = {}) => {
  const calls = [];
  const win = { innerWidth: 800, innerHeight: 600, document: { getElementById: () => ({ width: 160, height: 90 }) }, renderAt: (f) => { calls.push(f); }, __ready: true, ...extra };
  return { win, calls };
};

test("legacy page gets __frame (round t*fps) and a default __meta", async () => {
  const { win, calls } = fakeWin();
  assert.equal(installCompat(win, { fps: 24, duration_s: 2 }), true);
  assert.deepEqual(win.__meta, { fps: 24, width: 160, height: 90, duration_s: 2, shutter: 0, subframes: 1 });
  await win.__frame(5 / 24); await win.__frame(0); await win.__frame(0.5);
  assert.deepEqual(calls, [5, 0, 12]);
});
test("t = f / fps lands on f for awkward fps", async () => {
  const { win, calls } = fakeWin();
  installCompat(win, { fps: 29.97 });
  for (const f of [0, 1, 7, 29, 1000]) await win.__frame(f / 29.97);
  assert.deepEqual(calls, [0, 1, 7, 29, 1000]);
});
test("an existing __meta is kept; width/height args win over the canvas", () => {
  const { win } = fakeWin({ __meta: { fps: 30, width: 1, height: 1, duration_s: 1, shutter: 0, subframes: 1 } });
  installCompat(win, { fps: 24 });
  assert.equal(win.__meta.fps, 30);
  const b = fakeWin();
  installCompat(b.win, { fps: 24, width: 1920, height: 1080 });
  assert.equal(b.win.__meta.width, 1920);
});
test("does nothing for protocol pages or pages without renderAt", () => {
  const frame = () => {};
  const p = fakeWin({ __frame: frame });
  assert.equal(installCompat(p.win, { fps: 24 }), false);
  assert.equal(p.win.__frame, frame);
  const n = fakeWin({ renderAt: undefined });
  assert.equal(installCompat(n.win, { fps: 24 }), false);
  assert.equal(n.win.__frame, undefined);
});
test("installCompat is self-contained (survives toString round trip, as motion-render evaluates it in the page)", async () => {
  const { win, calls } = fakeWin();
  const fn = new Function(`return (${installCompat.toString()})`)();
  assert.equal(fn(win, { fps: 10 }), true);
  await win.__frame(0.3);
  assert.deepEqual(calls, [3]);
});
