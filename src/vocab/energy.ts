/**
 * Batch 2 · family "energy": particle and energy builds, ported by motion design from the 人造太阳 experiment (fx.js FX.plasma /
 * FX.glow / FX.add; 55_scenes p01 s1-2 the ring igniting, p03 s3 four nuclei squeezed into one, p04 s2 fire -> turbine -> wire -> bulb,
 * p12 s4-5 data packets paving a road). Built on the engine foundations: named moves (ENERGY_MOTIONS, overridable by opts.ease), a
 * declared space with depth, glow kept inside the object that emits it (no stage-wide additive layer), hierarchy with detach.
 *
 * ring      p01 s1: a 3/4-view ring waits as a faint outline; it ignites (heat 0 -> 1, 900 ms) with a core flash that decays (260 ms),
 *           then keeps flowing: 14 seeded light streaks run round it at their own speeds and the rim breathes (ambient). The ring is
 *           two objects, its far half behind the centre line and its near half in front of it, so the near arc and its glow really
 *           pass in front of the text and the far arc behind it. FX.plasma's four glow layers: wide faint -> narrow bright.
 * converge  p03 s3: 3-6 labelled orbs (children of one swirl rig, at two depths) pop in around a centre and jitter; pressure chevrons
 *           pulse inward; the rig pulls them in (900 ms, a 34° twist) while the camera pushes in a little (the near and far orbs part:
 *           parallax); each label detaches from its orb as the pull starts and fades where it was; they meet in a flash and one
 *           result orb springs out with its label, while 18 sparks fly out and slow. The flash and sparks belong to the result.
 * flow      p04 s2 / p12 s4-5: a row of 3-5 node cards pops in (120 ms stagger); the first activates (accent rim, spring); a connector
 *           draws to the next and a pulse rides it; its arrival activates the next node, and so on; behind each live connector pulses
 *           keep flowing every 450 ms (ambient, on the wire object behind the cards); the last card blooms (inside itself) and slams.
 */
import { attr, clamp, css, ff, h, lerp, mix, rgba, rng, root, seg, svg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, motions, prog, type Key, type MotionTable } from "./easing.js";
import { coreOf, ICON, stageSvg, type PictoIcon } from "./parts.js";
import { glow, scene, slamKeys, type Camera, type Obj } from "./space.js";

export type EnergyVariant = "ring" | "converge" | "flow";
export interface FlowNode { label: string; icon?: PictoIcon }

export interface EnergyOpts extends CommonOpts {
  variant?: EnergyVariant;
  /** ring: the line in the ring's centre after it lights (a product name, a number) */
  text?: string;
  /** ring: the ring's half width px (default 560) and its tilt (height / width, default 0.34) */
  radius?: number;
  tilt?: number;
  /** converge: 3-6 labels that come together; result: what they become */
  items?: string[];
  result?: string;
  /** flow: 3-5 nodes in order */
  nodes?: FlowNode[];
  /** ms between two steps (flow: node to node; converge: hold before the pull) */
  step_ms?: number;
}

/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const ENERGY_MOTIONS: Record<EnergyVariant, MotionTable> = {
  ring: {
    ignite: { ease: "out-expo", doc: "the ring heating from outline to full light" },
    "text.in": { ease: "house", doc: "the centre line rising in once the ring is lit" },
  },
  converge: {
    "orb.pop": { ease: "overshoot", doc: "each orb popping in" },
    pull: { ease: "in-cubic", doc: "the rig pulling the orbs in and twisting (accelerates into the meeting)" },
    "label.fade": { ease: "out-quad", doc: "each label fading where it detached" },
    push: { ease: "in-out-sine", doc: "the camera pushing in during the pull (parallax between near and far orbs)" },
    "result.spring": { ease: { spring: [1.67, 0.7] }, doc: "the result orb springing out of the flash" },
    "result.label": { ease: "house", doc: "the result's label fading in" },
    "spark.fly": { ease: "out-expo", doc: "the sparks flying out and slowing" },
  },
  flow: {
    "card.pop": { ease: "overshoot", doc: "each card popping in" },
    "card.activate": { ease: { spring: [2.2, 0.7] }, doc: "a card settling from 1.12x when it activates" },
    "wire.draw": { ease: "out-cubic", doc: "the live connector drawing to the next card" },
    "pulse.ride": { ease: "in-out-sine", doc: "a pulse riding a connector" },
    "slam.drop": { ease: "in-quad", doc: "the last card's landing fall from 1.5x" },
    "slam.settle": { ease: "in-out-sine", doc: "the last card's settle to 1x" },
    "goal.bloom": { ease: "out-expo", doc: "the last card's bloom opening" },
  },
};

export function energy(host: HTMLElement, o: EnergyOpts): Component {
  const v: EnergyVariant = o.variant ?? "ring";
  const th = theme(o);
  const M = motions(ENERGY_MOTIONS[v] ?? ENERGY_MOTIONS.ring, o.ease, `energy.${v}`);
  const el = root(host, th, o, `energy-${v}`);
  const start = o.start_ms ?? 300;
  if (v === "converge") return converge(el, th, o, start, M);
  if (v === "flow") return flow(el, th, o, start, M);
  return ring(el, th, o, start, M);
}
type Moves = ReturnType<typeof motions>;

/** a canvas filling an object's node (its own pixels: additive drawing inside it never reaches another object) */
function nodeCanvas(body: HTMLElement, w: number, hh: number): CanvasRenderingContext2D {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w); cv.height = Math.ceil(hh);
  cv.style.cssText = `position:absolute;left:0;top:0;width:${Math.ceil(w)}px;height:${Math.ceil(hh)}px`;
  body.append(cv);
  return cv.getContext("2d")!;
}

// ---------------------------------------------------------------- ring
function ring(el: HTMLElement, th: Theme, o: EnergyOpts, start: number, M: Moves): Component {
  const cx = 960, cy = 560, rx = o.radius ?? 560, ry = rx * (o.tilt ?? 0.34), TH = rx * 0.08;
  const pad = TH * 3.4 + 12, W = (rx + pad) * 2, H = (ry + pad) * 2 + 24;
  const core = coreOf(th), col1 = th.accent, col2 = mix(th.accent, core, 0.4);
  const ig = start + 300, light = th.stage === "light";
  // far half (above the centre line) behind the text, near half in front of it: one ring, two depths
  const sc = scene(el, {
    camera: o.camera,
    objects: [
      { id: "far", w: W, h: H, at: [cx, cy], z: -4 },
      { id: "core", w: rx * 0.9, h: ry * 1.2, at: [cx, cy], z: -2 },
      { id: "text", w: 1600, h: 160, at: [cx, cy], z: 0, motion: { opacity: [[ig + 500, 0], [ig + 1000, 1, M["text.in"]]], y: [[ig + 500, 24], [ig + 1000, 0, M["text.in"]]] } },
      { id: "near", w: W, h: H, at: [cx, cy], z: 4 },
    ],
  });
  const far = nodeCanvas(sc.n.far.body, W, H), near = nodeCanvas(sc.n.near.body, W, H);
  const flash = glow(sc.n.core, { color: core, radius: rx * 0.55, spread: 0.55 });
  const r = rng(3);
  const streaks = Array.from({ length: 14 }, () => ({ sp: 0.6 + r() * 0.9, len: 0.18 + r() * 0.3, ph: r() * 6.283, off: (r() - 0.5) * TH * 0.6, w: 3 + r() * 4 }));
  if (o.text) sc.n.text.body.append(h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.display), fontSize: 120, color: th.ink, whiteSpace: "nowrap", letterSpacing: "-0.02em", textShadow: `0 0 50px ${rgba(th.accent, 0.55)}` }, o.text));
  const ox = W / 2, oy = H / 2;
  const pt = (a: number, t: number, wob: number): [number, number] => { const w = wob * (Math.sin(a * 3 + t * 4.1) * 0.6 + Math.sin(a * 5 - t * 6.3) * 0.4); return [ox + Math.cos(a) * (rx + w), oy + Math.sin(a) * (ry + w * 0.4)]; };
  const draw = (c: CanvasRenderingContext2D, nearHalf: boolean, ms: number, heat: number, fl: number) => {
    const t = ms / 1000;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    if (nearHalf) c.rect(0, oy, W, H - oy); else c.rect(0, 0, W, oy);
    c.clip();
    c.strokeStyle = rgba(th.ink, 0.16 * (1 - heat));
    c.lineWidth = 4; c.setLineDash([14, 14]);
    c.beginPath(); c.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    if (heat > 0) {
      const breathe = 1 + 0.04 * Math.sin(t * 2.2);
      c.globalCompositeOperation = light ? "source-over" : "lighter";
      const N = 140;
      const layers: [number, string, number][] = [[TH * 3.2, col1, 0.1], [TH * 1.9, col1, 0.22], [TH * 1.05, col2, 0.55], [TH * 0.42, core, 0.85]];
      for (const [lw, col, al] of layers) {
        c.strokeStyle = rgba(col, Math.min(1, al * heat * breathe + (lw < TH ? fl * 0.4 : 0)));
        c.lineWidth = lw; c.lineCap = "round"; c.beginPath();
        for (let i = 0; i <= N; i++) { const [x, y] = pt((i / N) * Math.PI * 2, t, 6); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.closePath(); c.stroke();
      }
      for (const s of streaks) {
        const s0 = s.ph + t * s.sp;
        c.strokeStyle = rgba(light ? "#FFFFFF" : core, 0.45 * heat); c.lineWidth = s.w; c.beginPath();
        for (let i = 0; i <= 16; i++) { const a = s0 + (s.len * i) / 16; const [x, y] = pt(a, t, 6); const yy = y + s.off * 0.4, xx = x + s.off * Math.cos(a) * 0.3; i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
        c.stroke();
      }
    }
    c.restore();
  };
  return {
    el, duration_ms: ig + 3600,
    seek(ms) {
      sc.seek(ms);
      const heat = along(M.ignite, ms, ig, ig + 900);
      const fl = ms >= ig ? Math.exp(-(ms - ig) / 260) : 0;
      draw(far, false, ms, heat, fl);
      draw(near, true, ms, heat, fl);
      flash.set(heat > 0 ? Math.min(1, fl * 0.9 + 0.12 * heat) : 0, 1 + 0.25 * (1 - fl));
    },
  };
}

// ---------------------------------------------------------------- converge
function converge(el: HTMLElement, th: Theme, o: EnergyOpts, start: number, M: Moves): Component {
  const items = (o.items ?? ["Script", "Screens", "Voice", "Music"]).slice(0, 6);
  const n = items.length, cx = 960, cy = 520, R0 = 400, d = 92, D = 260;
  const hold = o.step_ms ?? 1100;
  const pull = start + 500 + n * 100 + hold, meet = pull + 900;
  const r = rng(17);
  const tones = [th.accent, mix(th.accent, th.ink, 0.35), mix(th.accent, "#FFB020", 0.45), mix(th.accent, "#20C0B0", 0.45), mix(th.accent, th.bg, 0.3), mix(th.accent, "#FF5A7A", 0.4)];
  const A = items.map((_, i) => -Math.PI / 2 + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.3);
  const PH = items.map(() => r() * 6.28);
  // the default camera: a small push through the pull, so orbs at two depths part (parallax); opts.camera replaces it
  const camera: Camera = o.camera ?? { focal: 1800, z: [[pull - 300, 0], [meet + 500, 90, M.push]] };
  const sc = scene(el, {
    camera,
    objects: [
      { id: "press", w: 1920, h: 1080, at: [960, 540], z: -60 },
      // the swirl rig: the orbs are its children, so the pull is one move (scale to 0 and a 34° twist) on one curve
      { id: "rig", w: 1, h: 1, at: [cx, cy], motion: { scale: [[pull, 1], [meet, 0, M.pull]], rot: [[pull, 0], [meet, 34, M.pull]] } },
      ...items.flatMap((_, i): Obj[] => {
        const s0 = start + i * 100;
        return [
          { id: `orb${i}`, w: d, h: d, parent: "rig", at: [Math.cos(A[i]) * R0 * 1.25, Math.sin(A[i]) * R0 * 0.78], z: i % 2 ? 50 : -50,
            follow: (ms) => { const e = along(M.pull, ms, pull, meet), t = ms / 1000; return [Math.sin(t * 2.1 + PH[i]) * 10 * (1 - e), Math.cos(t * 1.7 + PH[i]) * 8 * (1 - e)]; },
            motion: { scale: [[s0, 0], [s0 + 480, 1, M["orb.pop"]]], opacity: [[meet - 1, 1], [meet, 0, "linear"]] } },
          // the label is the orb's child until the pull, then detaches: it stays where it was and fades (it is not sucked in)
          { id: `lab${i}`, w: 520, h: 56, parent: `orb${i}`, at: [0, 84], detach: { at_ms: pull }, motion: { opacity: [[s0, 0], [s0 + 240, 1, "linear"], [pull, 1], [pull + 380, 0, M["label.fade"]]] } },
        ];
      }),
      { id: "burst", w: 1500, h: 1200, at: [cx, cy], z: 8 },
      { id: "result", w: D, h: D, at: [cx, cy], z: 10, motion: { scale: [[meet, 0], [meet + 1600, 1, M["result.spring"]]] } },
      { id: "rlab", w: 1200, h: 80, parent: "result", at: [0, D / 2 + 70], motion: { opacity: [[meet + 250, 0], [meet + 650, 1, M["result.label"]]] } },
    ],
  });
  items.forEach((txt, i) => {
    const tone = tones[i % tones.length];
    sc.n[`orb${i}`].body.append(h("div", { position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 36% 32%, ${mix(tone, "#FFFFFF", 0.45)} 0%, ${tone} 60%, ${mix(tone, "#000000", 0.25)} 100%)`, boxShadow: `0 0 40px ${rgba(tone, 0.5)}` }));
    sc.n[`lab${i}`].body.append(h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.display), fontSize: 34, color: th.ink, whiteSpace: "nowrap" }, txt));
  });
  // pressure chevrons from four sides, on the field behind everything
  const s = stageSvg();
  sc.n.press.body.append(s);
  const chev = [0, 1, 2, 3].map((k) => {
    const g = svg("g", {});
    g.append(svg("path", { d: "M -34 -26 L 0 0 L -34 26", fill: "none", stroke: rgba(th.ink, 0.5), "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    s.append(g);
    return { g, a: (k * Math.PI) / 2 };
  });
  const res = h("div", { position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 38% 34%, #FFFFFF 0%, ${coreOf(th)} 28%, ${th.accent} 72%, ${mix(th.accent, "#000000", 0.2)} 100%)`, boxShadow: `0 0 80px ${rgba(th.accent, 0.7)}, 0 0 200px ${rgba(th.accent, 0.35)}` });
  sc.n.result.body.append(res);
  if (o.result) sc.n.rlab.body.append(h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.display), fontSize: 56, color: th.ink, whiteSpace: "nowrap" }, o.result));
  // the meeting's flash and sparks: the result's own light, drawn in the burst object just behind it
  const BW = 1500, BH = 1200;
  const c = nodeCanvas(sc.n.burst.body, BW, BH);
  const sparks = Array.from({ length: 18 }, () => ({ a: r() * Math.PI * 2, d: 260 + r() * 260, s: 3 + r() * 5 }));
  return {
    el, duration_ms: meet + 2200,
    seek(ms) {
      sc.seek(ms);
      const t = ms / 1000;
      const e = along(M.pull, ms, pull, meet);
      chev.forEach((q) => {
        const vis = seg(ms, pull - hold * 0.7, pull - hold * 0.4) * (1 - seg(ms, meet - 200, meet));
        const pulse = (t * 1.6) % 1;
        const dist = lerp(560, 330, prog("out-quad", pulse)) * lerp(1, 0.6, e);
        const x = cx - Math.cos(q.a) * dist * 1.3, y = cy - Math.sin(q.a) * dist * 0.85;
        attr(q.g, { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((q.a * 180) / Math.PI).toFixed(1)})`, opacity: (vis * (1 - pulse * 0.6)).toFixed(3) });
      });
      css(res, { transform: `scale(${(1 + 0.02 * Math.sin(t * 2.4)).toFixed(4)})` });
      c.clearRect(0, 0, BW, BH);
      if (ms >= meet) {
        const f = Math.exp(-(ms - meet) / 300);
        c.save();
        c.globalCompositeOperation = th.stage === "light" ? "source-over" : "lighter";
        const g = c.createRadialGradient(BW / 2, BH / 2, 0, BW / 2, BH / 2, 600);
        g.addColorStop(0, rgba("#FFFFFF", 0.85 * f)); g.addColorStop(0.3, rgba(th.accent, 0.4 * f)); g.addColorStop(1, rgba(th.accent, 0));
        c.fillStyle = g; c.fillRect(0, 0, BW, BH);
        const sp = along(M["spark.fly"], ms, meet, meet + 1100), fade = 1 - seg(ms, meet + 500, meet + 1300);
        for (const q of sparks) { c.fillStyle = rgba(coreOf(th), 0.9 * fade); c.beginPath(); c.arc(BW / 2 + Math.cos(q.a) * q.d * sp, BH / 2 + Math.sin(q.a) * q.d * sp * 0.8, q.s, 0, Math.PI * 2); c.fill(); }
        c.restore();
      }
    },
  };
}

// ---------------------------------------------------------------- flow
function flow(el: HTMLElement, th: Theme, o: EnergyOpts, start: number, M: Moves): Component {
  const nodes = (o.nodes ?? [{ label: "Your page", icon: "page" }, { label: "Script", icon: "chat" }, { label: "Shots", icon: "play" }, { label: "Film", icon: "check" }]).slice(0, 5);
  const n = nodes.length, CW = 220, cy = 500;
  const span = Math.min(1400, (n - 1) * 380);
  const xs = nodes.map((_, i) => (n === 1 ? 960 : 960 - span / 2 + (span * i) / (n - 1)));
  const gap = o.step_ms ?? 900;
  const act = (i: number) => start + 700 + i * gap;
  const travel = clamp(gap - 300, 300, 700); // the leading pulse arrives exactly when the next node activates
  const end = act(n - 1);
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "chain", kind: "row", at: [960, cy], gap: n === 1 ? 0 : span / (n - 1) - CW }],
    objects: [
      { id: "wires", w: 1920, h: 1080, at: [960, 540], z: -1 },
      ...nodes.flatMap((_, i): Obj[] => {
        const s0 = start + i * 120;
        const keys: Key[] = [[s0, 0], [s0 + 480, 1, M["card.pop"]]];
        if (i === n - 1) keys.push(...slamKeys(act(i), M["slam.drop"], M["slam.settle"]));
        else keys.push([act(i), 1], [act(i), 1.12], [act(i) + 600, 1, M["card.activate"]]);
        return [
          { id: `card${i}`, w: CW, h: CW, group: "chain", motion: { scale: keys, opacity: [[s0, 0], [s0 + 240, 1, "linear"]] } },
          { id: `lab${i}`, w: 600, h: 60, parent: `card${i}`, at: [0, CW / 2 + 56] },
        ];
      }),
    ],
  });
  const s = stageSvg();
  sc.n.wires.body.append(s);
  const lines = xs.slice(0, -1).map((x, i) => {
    const x1 = x + CW / 2 + 14, x2 = xs[i + 1] - CW / 2 - 14;
    const base = svg("line", { x1, y1: cy, x2, y2: cy, stroke: rgba(th.ink, 0.16), "stroke-width": 6, "stroke-dasharray": "12 12", "stroke-linecap": "round" });
    const live = svg("line", { x1, y1: cy, x2, y2: cy, stroke: th.accent, "stroke-width": 6, "stroke-linecap": "round" });
    s.append(base, live);
    const pulses = Array.from({ length: 4 }, () => { const p = svg("circle", { r: 11, fill: coreOf(th) }); const g = svg("circle", { r: 30, fill: th.accent, "fill-opacity": 0.3 }); s.append(g, p); return { p, g }; });
    return { x1, x2, base, live, pulses };
  });
  const lastGlow = glow(sc.n[`card${n - 1}`], { color: th.accent, radius: 210, spread: 0.6 });
  const C = nodes.map((nd, i) => {
    const card = h("div", { position: "absolute", inset: 0, borderRadius: 40, background: th.surface, border: `3px solid ${rgba(th.ink, 0.1)}`, boxShadow: th.shadow, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" });
    const ic = svg("svg", { viewBox: "0 0 100 100", width: 100, height: 100 });
    const path = svg("path", { d: ICON[nd.icon ?? "dot"], fill: th.muted, "fill-rule": "evenodd" });
    ic.append(path);
    card.append(ic as unknown as HTMLElement);
    sc.n[`card${i}`].body.append(card);
    const lab = h("div", { position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: ff(th.display), fontSize: 36, color: th.ink, whiteSpace: "nowrap" }, nd.label);
    sc.n[`lab${i}`].body.append(lab);
    return { card, path, lab };
  });
  return {
    el, duration_ms: end + 1800,
    seek(ms) {
      sc.seek(ms);
      C.forEach((q, i) => {
        const on = ms >= act(i);
        css(q.card, { borderColor: on ? th.accent : rgba(th.ink, 0.1), boxShadow: on ? `0 0 50px ${rgba(th.accent, 0.45)}, ${th.shadow}` : th.shadow });
        attr(q.path, { fill: on ? th.accent : th.muted });
        css(q.lab, { color: on ? th.ink : th.muted });
      });
      lines.forEach((L, i) => {
        const vis = seg(ms, start + i * 120 + 200, start + i * 120 + 500);
        attr(L.base, { opacity: vis.toFixed(3), "stroke-dashoffset": (-ms * 0.03).toFixed(1) });
        const d0 = act(i) + gap - travel, dr = along(M["wire.draw"], ms, d0, d0 + travel);
        attr(L.live, { x2: lerp(L.x1, L.x2, dr).toFixed(1), opacity: dr > 0 ? 1 : 0 });
        L.pulses.forEach((P, j) => {
          // the first pulse leads the line; the others keep flowing every 450 ms once the line is live
          const t0 = d0 + j * 450;
          const cyc = ms >= t0 ? ((ms - t0) % (450 * L.pulses.length)) / travel : -1;
          const vis2 = cyc >= 0 && cyc <= 1;
          const x = lerp(L.x1, L.x2, prog(M["pulse.ride"], clamp(cyc), travel));
          for (const e of [P.p, P.g]) attr(e, { cx: x.toFixed(1), cy, opacity: vis2 ? 1 : 0 });
        });
      });
      const b = seg(ms, end, end + 600);
      lastGlow.set(b * (0.7 + 0.15 * Math.sin(ms / 300)), lerp(0.4, 1, prog(M["goal.bloom"], b, 600)));
    },
  };
}
