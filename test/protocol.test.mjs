import test from "node:test";
import assert from "node:assert/strict";
import { metaProblems, validateMeta, normalizeMeta, frameCount, definePage, ProtocolError } from "../dist/index.js";

const meta = { fps: 24, width: 320, height: 180, duration_s: 0.5, shutter: 0, subframes: 1 };

test("meta validation", () => {
  assert.deepEqual(metaProblems(meta), []);
  assert.equal(validateMeta(meta), meta);
  const p = metaProblems({ fps: 0, width: 1.5, height: 0, duration_s: -1, shutter: 2, subframes: 0 });
  assert.equal(p.length, 6);
  assert.throws(() => validateMeta(null), ProtocolError);
  assert.deepEqual(normalizeMeta({ fps: 24, width: 2, height: 2, duration_s: 1 }), { fps: 24, width: 2, height: 2, duration_s: 1, shutter: 0, subframes: 1 });
});
test("frameCount", () => {
  assert.equal(frameCount({ fps: 24, duration_s: 0.5 }), 12);
  assert.equal(frameCount({ fps: 24, duration_s: 0 }), 1);
  assert.equal(frameCount({ fps: 30, duration_s: 1.001 }), 31);
});
test("definePage installs the three globals; __ready flips after load; errors propagate", async () => {
  const win = { document: { getElementById: () => null } };
  const seen = [];
  definePage({ meta, load: async (s) => { seen.push(["load", s]); }, frame: (t) => { seen.push(["frame", t]); } }, {}, win);
  assert.deepEqual(win.__meta, meta);
  assert.equal(win.__ready, false);
  await win.__load({ a: 1 });
  assert.equal(win.__ready, true);
  await win.__frame(0.25);
  assert.deepEqual(seen, [["load", { a: 1 }], ["frame", 0.25]]);
  await assert.rejects(() => win.__frame(NaN), ProtocolError);
  const w2 = { document: { getElementById: () => null } };
  definePage({ meta, load: async () => { throw new Error("boom"); }, frame() {} }, {}, w2);
  await assert.rejects(() => w2.__load(), /boom/);
  assert.equal(w2.__ready, false);
});
test("blur without a 2D stage canvas is a loud error, not a silent unblurred frame", async () => {
  const win = { document: { getElementById: () => null } };
  definePage({ meta: { ...meta, shutter: 0.5, subframes: 4 }, frame() {} }, {}, win);
  await assert.rejects(() => win.__frame(0), /needs a 2D/);
});

test("shutterAt overrides __meta.shutter per frame and falls back when it returns undefined", async () => {
  const widths = [];
  const mk = () => {
    const data = new Uint8ClampedArray(4);
    return { canvas: { width: 1, height: 1 }, getImageData: () => ({ data: Uint8ClampedArray.from(data) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {} };
  };
  const ctx = mk();
  const win = { document: { getElementById: () => ({ getContext: () => ctx }) } };
  const times = [];
  definePage({ meta: { ...meta, shutter: 1, subframes: 2 }, shutterAt: (t) => (t < 1 ? 0 : undefined), frame: (t) => { times.push(t); } }, {}, win);
  await win.__frame(0.5); // shutterAt -> 0: one plain call
  assert.deepEqual(times, [0.5]);
  times.length = 0;
  await win.__frame(2); // undefined -> meta.shutter 1: two subframes
  assert.equal(times.length, 2);
  await assert.rejects(async () => { const w = { document: win.document }; definePage({ meta, shutterAt: () => 3, frame() {} }, {}, w); await w.__frame(0); }, /0\.\.1/);
});
