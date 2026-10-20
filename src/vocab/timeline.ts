/**
 * Batch 2 · family "timeline": era and milestone sweeps, ported by motion design from the 人造太阳 experiment (55_scenes p09 s0, p12 s2-3,
 * p11 s3-5; e6 s_roadmap). Built on the engine foundations: named moves (TIMELINE_MOTIONS, overridable by opts.ease), a declared space
 * (the stairs are a bottom-aligned row under one rig that drifts; the ball is its own object riding its path; glow stays in its object).
 *
 * steps    p09 s0: blocks grow up from the floor (90 ms stagger, bottom origin); a glowing ball hops from step to step on a parabola
 *          (x eased, y on real gravity; 620 ms hop, 380 ms dwell) with a short ghost trail (the same ball object, earlier); each landing
 *          squashes the ball, lights the step's top and pops its value; the last value slams. The rig drifts 40 px with the ball.
 * roadmap  p12 s2-3 / e6 s_roadmap: the road draws (900 ms); a glowing ball travels node to node (800 ms, 500 ms dwell); the walked part
 *          turns solid accent behind it; each node it reaches springs and its date and label pop (children of the node); the last node
 *          blooms (the goal: "the first light"), the bloom inside the node's own object.
 * hurdles  p11 s3-5: a lane with 3-5 hurdles (a row); the lane's centre dashes keep flowing (ambient); one by one each hurdle's bar turns
 *          accent, its label pops (the hurdle's child) and a dashed guide reaches from the ball to it; with clear: true the ball hops
 *          each hurdle as it lights (done), otherwise the ball waits at the start (to do).
 */
import { attr, clamp, css, ff, h, lerp, mix, rgba, root, seg, svg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, motions, prog, type MotionTable } from "./easing.js";
import { coreOf, stageSvg, tag } from "./parts.js";
import { glow, litSurface, scene, slamKeys, type Obj } from "./space.js";

export type TimelineVariant = "steps" | "roadmap" | "hurdles";
export interface Step { label: string; value?: string }
export interface Milestone { date: string; label: string }

export interface TimelineOpts extends CommonOpts {
  variant?: TimelineVariant;
  /** steps: 2-6 steps, low to high; value is shown on landing ("60 s", "1066 s") */
  steps?: Step[];
  /** roadmap: 3-6 milestones in order */
  milestones?: Milestone[];
  /** roadmap: the last milestone blooms (default true) */
  goal?: boolean;
  /** hurdles: 3-5 short labels, the things still to clear (or done, with clear) */
  items?: string[];
  /** hurdles: the ball hops each hurdle as it lights (default false: it waits at the start) */
  clear?: boolean;
  /** ms per step (hop + dwell, roadmap move + dwell, hurdle gap) */
  step_ms?: number;
}

/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const TIMELINE_MOTIONS: Record<TimelineVariant, MotionTable> = {
  steps: {
    "step.grow": { ease: "house", doc: "each block growing up from the floor" },
    "hop.x": { ease: "in-out-sine", doc: "the ball's sideways travel in a hop (its height follows gravity)" },
    "value.pop": { ease: "overshoot", doc: "a step's value popping when the ball lands" },
    "slam.drop": { ease: "in-quad", doc: "the last value's landing fall from 1.5x" },
    "slam.settle": { ease: "in-out-sine", doc: "the last value's settle to 1x" },
    drift: { ease: "linear", doc: "the whole staircase drifting 40 px left with the ball" },
  },
  roadmap: {
    "road.draw": { ease: "out-cubic", doc: "the road drawing" },
    "node.in": { ease: "house", doc: "each node ring fading in" },
    travel: { ease: "in-out-sine", doc: "the ball travelling from node to node along the road" },
    "node.spring": { ease: { spring: [2.2, 0.7] }, doc: "a node springing when the ball reaches it" },
    "label.in": { ease: "house", doc: "a node's date lighting and label rising in" },
    "goal.bloom": { ease: "out-expo", doc: "the last node's bloom opening" },
  },
  hurdles: {
    "hurdle.in": { ease: "house", doc: "each hurdle fading in" },
    "tag.pop": { ease: "overshoot", doc: "a hurdle's label popping as it lights" },
    "guide.reach": { ease: "out-cubic", doc: "the dashed guide reaching from the ball to the lit hurdle" },
    "hop.x": { ease: "in-out-sine", doc: "the ball's travel over a hurdle (clear: true; its height follows gravity)" },
  },
};

export function timeline(host: HTMLElement, o: TimelineOpts): Component {
  const v: TimelineVariant = o.variant ?? "steps";
  const th = theme(o);
  const M = motions(TIMELINE_MOTIONS[v] ?? TIMELINE_MOTIONS.steps, o.ease, `timeline.${v}`);
  const el = root(host, th, o, `timeline-${v}`);
  const start = o.start_ms ?? 300;
  if (v === "roadmap") return roadmap(el, th, o, start, M);
  if (v === "hurdles") return hurdles(el, th, o, start, M);
  return steps(el, th, o, start, M);
}
type Moves = ReturnType<typeof motions>;

/** the glowing ball (the film's through-object: the energy that moves); its glow is its own shadow, inside its object */
function ball(th: Theme, d: number): HTMLElement {
  const core = coreOf(th);
  return h("div", { position: "absolute", left: 0, top: 0, width: d, height: d, borderRadius: "50%", background: `radial-gradient(circle at 38% 34%, #FFFFFF 0%, ${core} 30%, ${th.accent} 78%)`, boxShadow: `0 0 ${d * 0.6}px ${rgba(th.accent, 0.75)}, 0 0 ${d * 1.6}px ${rgba(th.accent, 0.35)}` });
}

// ---------------------------------------------------------------- steps
function steps(el: HTMLElement, th: Theme, o: TimelineOpts, start: number, M: Moves): Component {
  const S = (o.steps ?? [{ label: "Day 1", value: "60" }, { label: "Week 1", value: "100" }, { label: "Month 1", value: "400" }, { label: "Today", value: "1066" }]).slice(0, 6);
  const n = S.length, SW = Math.min(300, 1440 / n), base = 900, hMin = 120, hMax = 500;
  const x0 = 960 - (n * SW) / 2;
  const hop = Math.round((o.step_ms ?? 1000) * 0.62), dwell = (o.step_ms ?? 1000) - hop;
  const D = 56;
  const H = S.map((_, i) => (n === 1 ? hMax : lerp(hMin, hMax, i / (n - 1))));
  const at = (i: number) => start + 700 + i * (hop + dwell);
  const land = (i: number) => at(i) + hop;
  const end = land(n - 1);
  const restX = (i: number) => (i < 0 ? x0 - 90 : x0 + i * SW + SW / 2);
  const restY = (i: number) => (i < 0 ? base - D / 2 : base - H[i] - D / 2);
  // the ball's path in rig coordinates: x on the hop ease, y on real gravity (a parabola in time)
  const pos = (ms: number): [number, number] => {
    let k = -1;
    for (let i = 0; i < n; i++) if (ms >= at(i)) k = i;
    if (k < 0) return [restX(-1), restY(-1)];
    const p = seg(ms, at(k), land(k));
    const xa = restX(k - 1), ya = restY(k - 1), xb = restX(k), yb = restY(k);
    const arcH = 150 + Math.abs(yb - ya) * 0.3;
    return [lerp(xa, xb, prog(M["hop.x"], p, hop)), lerp(ya, yb, p) - arcH * 4 * p * (1 - p)];
  };
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "stairs", kind: "row", at: [960, base - hMax / 2], gap: 12, align: "end" }],
    objects: [
      // the rig: everything rides it, so the drift moves the whole staircase as one
      { id: "rig", w: 1, h: 1, at: [0, 0], motion: { x: [[start + 700, 0], [end, -40, M.drift]] } },
      { id: "floor", w: n * SW + 400, h: 4, parent: "rig", at: [960, base + 2] },
      ...S.map((_, i): Obj => ({ id: `blk${i}`, w: SW - 12, h: H[i], group: "stairs", parent: "rig" })),
      ...S.map((st, i): Obj => ({ id: `val${i}`, w: 400, h: 90, parent: "rig", at: [restX(i), base - H[i] - 130], z: 2, motion: { opacity: [[land(i), 0], [land(i) + 1, 1, "linear"]], scale: i === n - 1 ? slamKeys(land(i), M["slam.drop"], M["slam.settle"]) : [[land(i), 0], [land(i) + 360, 1, M["value.pop"]]] } })),
      ...Array.from({ length: 5 }, (_, j): Obj => ({ id: `ghost${j}`, w: D * 0.7, h: D * 0.7, parent: "rig", at: [0, 0], z: 5, follow: (ms) => pos(ms - (j + 1) * 40) })),
      { id: "ball", w: D, h: D, parent: "rig", at: [0, 0], z: 6, follow: pos, motion: { opacity: [[start, 0], [start + 300, 1, "linear"]] } },
    ],
  });
  sc.n.floor.body.append(h("div", { position: "absolute", inset: 0, background: rgba(th.ink, 0.18), borderRadius: 2 }));
  const B = S.map((st, i) => {
    const L = sc.sp.slots[`blk${i}`].light;
    const block = h("div", { position: "absolute", inset: 0, ...litSurface(th, L, th.surface, { radius: 10, rim: 1.5 }), borderRadius: "10px 10px 0 0", transformOrigin: "50% 100%" });
    const top = h("div", { position: "absolute", left: 0, right: 0, top: 0, height: 12, borderRadius: "10px 10px 0 0", background: rgba(th.ink, 0.1) });
    const lab = h("div", { position: "absolute", left: 0, right: 0, bottom: 26, textAlign: "center", fontFamily: ff(th.body), fontSize: Math.min(30, SW * 0.13), color: th.muted, whiteSpace: "nowrap" }, st.label);
    block.append(top, lab);
    sc.n[`blk${i}`].body.append(block);
    const val = st.value ? h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.display), fontSize: Math.min(64, SW * 0.24), color: i === n - 1 ? th.accent : th.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, st.value) : null;
    if (val) sc.n[`val${i}`].body.append(val);
    return { block, top, lab };
  });
  const b = ball(th, D);
  sc.n.ball.body.append(b);
  const ghosts = Array.from({ length: 5 }, (_, j) => { const g = ball(th, D * 0.7); css(g, { boxShadow: "none" }); sc.n[`ghost${j}`].body.append(g); return g; });
  return {
    el, duration_ms: end + 1500,
    seek(ms) {
      sc.seek(ms);
      B.forEach((q, i) => {
        const g = along(M["step.grow"], ms, start + i * 90, start + i * 90 + 520);
        css(q.block, { transform: `scaleY(${g.toFixed(4)})`, opacity: g > 0 ? 1 : 0 });
        const lit = ms >= land(i);
        css(q.top, { background: lit ? th.accent : rgba(th.ink, 0.1), boxShadow: lit ? `0 0 30px ${rgba(th.accent, 0.7)}` : "none" });
        css(q.lab, { color: lit ? th.ink : th.muted });
      });
      // the landing squash: the ball's own body, about its bottom
      let k = -1;
      for (let i = 0; i < n; i++) if (ms >= land(i)) k = i;
      const landT = k >= 0 ? ms - land(k) : 1e9;
      const sq = landT >= 0 && landT < 260 ? Math.sin((landT / 260) * Math.PI) * (1 - landT / 260) * 0.3 : 0;
      css(b, { transformOrigin: "50% 100%", transform: `scale(${(1 + sq).toFixed(3)}, ${(1 - sq).toFixed(3)})` });
      const [bx, by] = pos(ms);
      ghosts.forEach((g, j) => { const [tx, ty] = pos(ms - (j + 1) * 40); const moving = Math.hypot(tx - bx, ty - by) > 4; css(g, { opacity: moving ? (0.35 * (1 - j / ghosts.length)).toFixed(3) : 0 }); });
    },
  };
}

// ---------------------------------------------------------------- roadmap
function roadmap(el: HTMLElement, th: Theme, o: TimelineOpts, start: number, M: Moves): Component {
  const MS = (o.milestones ?? [{ date: "2025", label: "First release" }, { date: "2026", label: "Teams" }, { date: "2027", label: "Every language" }]).slice(0, 6);
  const n = MS.length, goal = o.goal !== false;
  const X0 = 200, X1 = 1720, Y = 560, A = 70;
  const N = 160;
  const pts = Array.from({ length: N + 1 }, (_, i) => { const u = i / N; return [lerp(X0, X1, u), Y + Math.sin(u * Math.PI * 1.5 + 0.4) * A] as [number, number]; });
  const d = "M " + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ");
  const len: number[] = [0];
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[N];
  const atU = (u: number): [number, number] => { const f = clamp(u) * N, i = Math.min(N - 1, Math.floor(f)), k = f - i; return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)]; };
  const nodeU = (i: number) => (n === 1 ? 0.5 : 0.04 + (0.92 * i) / (n - 1));
  const drawEnd = start + 900;
  const move = Math.round((o.step_ms ?? 1300) * 0.62), dwell = (o.step_ms ?? 1300) - move;
  const arrive = (i: number) => drawEnd + 200 + i * (move + dwell);
  const uAt = (ms: number): number => {
    if (ms < arrive(0)) return nodeU(0) * along(M.travel, ms, drawEnd - 300, arrive(0));
    for (let i = 1; i < n; i++) { const a = arrive(i) - move; if (ms < arrive(i)) return ms < a ? nodeU(i - 1) : lerp(nodeU(i - 1), nodeU(i), along(M.travel, ms, a, arrive(i))); }
    return nodeU(n - 1);
  };
  const end = arrive(n - 1);
  const NP = MS.map((_, i) => atU(nodeU(i)));
  const sc = scene(el, {
    camera: o.camera,
    objects: [
      { id: "road", w: 1920, h: 1080, at: [960, 540] },
      ...MS.flatMap((m, i): Obj[] => {
        const up = i % 2 === 0;
        return [
          { id: `node${i}`, w: 80, h: 80, at: NP[i], z: 1, motion: { opacity: [[start + 200 + i * 120, 0], [start + 600 + i * 120, 1, M["node.in"]]] } },
          { id: `date${i}`, w: 500, h: 64, parent: `node${i}`, at: [0, up ? -82 : 76] },
          { id: `lab${i}`, w: 640, h: 56, parent: `node${i}`, at: [0, up ? -146 : 138], motion: { opacity: [[arrive(i), 0], [arrive(i) + 420, 1, M["label.in"]]], y: [[arrive(i), up ? 14 : -14], [arrive(i) + 420, 0, M["label.in"]]] } },
        ];
      }),
      { id: "ball", w: 46, h: 46, at: [0, 0], z: 3, follow: (ms) => atU(uAt(ms)), motion: { opacity: [[drawEnd - 400, 0], [drawEnd, 1, "linear"]] } },
    ],
  });
  const s = stageSvg();
  sc.n.road.body.append(s);
  const band = svg("path", { d, fill: "none", stroke: rgba(th.ink, th.stage === "dark" ? 0.08 : 0.07), "stroke-width": 54, "stroke-linecap": "round" });
  const dash = svg("path", { d, fill: "none", stroke: rgba(th.ink, 0.32), "stroke-width": 6, "stroke-dasharray": "18 18", "stroke-linecap": "round" });
  const walked = svg("path", { d, fill: "none", stroke: th.accent, "stroke-width": 8, "stroke-linecap": "round" });
  s.append(band, dash, walked);
  // the goal's bloom belongs to the last node: occluded with it, never laid over what is in front
  const goalGlow = goal ? glow(sc.n[`node${n - 1}`], { color: th.accent, radius: 220, spread: 0.6 }) : null;
  const Nn = MS.map((m, i) => {
    const body = sc.n[`node${i}`].body;
    const ring = h("div", { position: "absolute", left: "50%", top: "50%", width: 44, height: 44, borderRadius: "50%", background: th.bg, border: `5px solid ${rgba(th.ink, 0.4)}`, boxSizing: "border-box", transform: "translate(-50%, -50%)" });
    const dot = h("div", { position: "absolute", left: "50%", top: "50%", width: 26, height: 26, borderRadius: "50%", background: th.accent, transform: "translate(-50%, -50%) scale(0)" });
    body.append(ring, dot);
    const date = h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.display), fontSize: 50, color: th.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, m.date);
    sc.n[`date${i}`].body.append(date);
    sc.n[`lab${i}`].body.append(h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.body), fontSize: 38, color: th.ink, whiteSpace: "nowrap" }, m.label));
    return { ring, dot, date };
  });
  sc.n.ball.body.append(ball(th, 46));
  return {
    el, duration_ms: end + 1600,
    seek(ms) {
      sc.seek(ms);
      const r = along(M["road.draw"], ms, start, drawEnd);
      attr(band, { opacity: r > 0 ? 1 : 0, "stroke-dasharray": `${total} ${total}`, "stroke-dashoffset": (total * (1 - r)).toFixed(1) });
      attr(dash, { opacity: r.toFixed(3), "stroke-dashoffset": (-ms * 0.02).toFixed(1) });
      const u = uAt(ms);
      const f = clamp(u) * N, fi = Math.min(N - 1, Math.floor(f)), wl = lerp(len[fi], len[fi + 1], f - fi);
      attr(walked, { "stroke-dasharray": `${total} ${total}`, "stroke-dashoffset": (total - wl).toFixed(1), opacity: u > 0.001 ? 1 : 0 });
      Nn.forEach((q, i) => {
        const lit = ms >= arrive(i);
        const k = lit ? along(M["node.spring"], ms, arrive(i), arrive(i) + 450) : 0;
        css(q.ring, { borderColor: lit ? th.accent : rgba(th.ink, 0.4), transform: `translate(-50%, -50%) scale(${(1 + (lit ? (8 / 22) * (1 - k) : 0)).toFixed(3)})` });
        css(q.dot, { transform: `translate(-50%, -50%) scale(${(lit ? lerp(1.6, 1, k) : 0).toFixed(3)})` });
        const tp = lit ? along(M["label.in"], ms, arrive(i), arrive(i) + 420) : 0;
        css(q.date, { opacity: lerp(0.5, 1, tp).toFixed(3), color: lit ? th.accent : th.muted });
      });
      if (goalGlow) {
        const gb = seg(ms, end, end + 700);
        goalGlow.set(gb * (0.75 + 0.15 * Math.sin(ms / 300)), lerp(0.3, 1, prog(M["goal.bloom"], gb, 700)));
      }
    },
  };
}

// ---------------------------------------------------------------- hurdles
function hurdles(el: HTMLElement, th: Theme, o: TimelineOpts, start: number, M: Moves): Component {
  const items = (o.items ?? ["Speed", "Quality", "Scale"]).slice(0, 5);
  const n = items.length, clearAll = o.clear === true;
  const FY = 780, X0 = 170, X1 = 1760, HX0 = 560, HX1 = 1560, HH = 190, HW = 140;
  const gap = o.step_ms ?? 1000;
  const D = 52;
  const at = (i: number) => start + 700 + i * gap;
  const hx = (i: number) => (n === 1 ? (HX0 + HX1) / 2 : lerp(HX0, HX1, i / (n - 1)));
  const restX = (i: number) => (i < 0 ? X0 + 80 : hx(i) + 110);
  const pos = (ms: number): [number, number] => {
    if (!clearAll) return [restX(-1), FY - D / 2 + Math.sin(ms / 260) * 3];
    let k = -1;
    for (let i = 0; i < n; i++) if (ms >= at(i) + 380) k = i;
    if (k < 0) return [restX(-1), FY - D / 2];
    const a = at(k) + 380, p = seg(ms, a, a + 560);
    const xa = k === 0 ? restX(-1) : restX(k - 1), xb = restX(k);
    return [lerp(xa, xb, prog(M["hop.x"], p, 560)), FY - D / 2 - (HH + 90) * 4 * p * (1 - p)];
  };
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "hurdles", kind: "row", at: [(HX0 + HX1) / 2, FY - HH / 2 - 3], gap: n === 1 ? 0 : (HX1 - HX0) / (n - 1) - HW }],
    objects: [
      { id: "lane", w: 1920, h: 1080, at: [960, 540] },
      ...items.flatMap((_, i): Obj[] => [
        { id: `hd${i}`, w: HW, h: HH + 6, group: "hurdles", z: 1, motion: { opacity: [[start + i * 100, 0], [start + i * 100 + 450, 1, M["hurdle.in"]]] } },
        { id: `tag${i}`, w: 10, h: 10, parent: `hd${i}`, at: [0, -HH / 2 - 87], z: 2 },
      ]),
      { id: "ball", w: D, h: D, at: [0, 0], z: 3, follow: pos, motion: { opacity: [[start, 0], [start + 300, 1, "linear"]] } },
    ],
  });
  const s = stageSvg();
  sc.n.lane.body.append(s);
  s.append(svg("line", { x1: X0, y1: FY, x2: X1, y2: FY, stroke: rgba(th.ink, 0.25), "stroke-width": 5, "stroke-linecap": "round" }));
  const lane = svg("line", { x1: X0, y1: FY + 46, x2: X1, y2: FY + 46, stroke: rgba(th.ink, 0.16), "stroke-width": 6, "stroke-dasharray": "30 26" });
  s.append(lane);
  const guide = svg("line", { stroke: th.accent, "stroke-width": 4, "stroke-dasharray": "10 12", "stroke-linecap": "round" });
  s.append(guide);
  const Hs = items.map((txt, i) => {
    const body = sc.n[`hd${i}`].body;
    const post = (left: number) => h("div", { position: "absolute", left, top: 6, width: 10, height: HH, borderRadius: 4, background: rgba(th.ink, 0.45) });
    const bar = h("div", { position: "absolute", left: 0, top: 0, width: HW, height: 24, borderRadius: 6, background: rgba(th.ink, 0.3) });
    body.append(post(HW / 2 - 56), post(HW / 2 + 46), bar);
    const t = tag(th, txt, { size: 40, dot: th.accent, ease: M["tag.pop"] });
    css(t.el, { left: 5, top: 5 });
    sc.n[`tag${i}`].body.append(t.el);
    return { bar, t };
  });
  sc.n.ball.body.append(ball(th, D));
  const end = at(n - 1) + (clearAll ? 940 : 500);
  return {
    el, duration_ms: end + 1400,
    seek(ms) {
      sc.seek(ms);
      attr(lane, { "stroke-dashoffset": (ms * 0.09).toFixed(1) });
      let cur = -1;
      Hs.forEach((q, i) => {
        const lit = seg(ms, at(i), at(i) + 300);
        if (ms >= at(i)) cur = i;
        css(q.bar, { background: lit > 0 ? mix(th.ink, th.accent, lit) : rgba(th.ink, 0.3) });
        q.t.set(seg(ms, at(i), at(i) + 450));
      });
      const [x, y] = pos(ms);
      if (cur >= 0 && !(clearAll && ms > at(cur) + 380)) {
        const g = along(M["guide.reach"], ms, at(cur), at(cur) + 400);
        attr(guide, { x1: x, y1: y - D / 2 - 6, x2: lerp(x, hx(cur), g).toFixed(1), y2: lerp(y - D / 2 - 6, FY - HH - 12, g).toFixed(1), opacity: 1 });
      } else attr(guide, { opacity: 0 });
    },
  };
}

