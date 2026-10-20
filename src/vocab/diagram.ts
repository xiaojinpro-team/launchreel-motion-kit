/**
 * Batch 2 · family "diagram": diagram builds, ported by motion design from the 人造太阳 experiment (fx.js FX.callout / FX.tag; 55_scenes
 * p06 s6 "the gap marked", p11 s0 the stamp, p12 s4-5 seven members round ITER; e6 s_safe / s_fair the ✓ ✗ rows). Built on the engine
 * foundations: named moves (DIAGRAM_MOTIONS, overridable by opts.ease), a declared space (the marks are the panel's child, the rows a
 * column, the hub's bloom inside the hub).
 *
 * callouts   FX.callout: a panel (a real screen or a calm placeholder, lit by the key light) settles in; one by one a point gets a dot
 *            with a repeating ripple, a leader line draws out to the side (elbow at the panel edge) and its label pops; the panel
 *            pushes in 2 % over the whole shot, and the marks are its child, so dots, lines and labels stay on what they point at.
 * checklist  e6 s_safe / p11 s0: a column of rows slides in from the left one per beat; each row's mark draws (circle, then the tick or
 *            the cross) in its colour (yes = accent, no = red, note = amber); an optional stamp slams onto the list at the end (1.6 ->
 *            1, -8°, the brake, not an alarm), in front of the rows.
 * network    p12 s4-5: a hub and 3-8 nodes round it pop in; spokes draw to the hub; the source node lights and packets run along its
 *            spoke every 260 ms, paving it in the accent behind them; each arrival pulses the hub (decay 300 ms) and its bloom (inside
 *            the hub); then every spoke carries a faint packet both ways (ambient).
 */
import { attr, clamp, css, ff, h, lerp, mix, rgba, root, seg, svg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, motions, prog, type MotionTable } from "./easing.js";
import { coreOf, NO_RED, NOTE_AMBER, stageSvg, tag } from "./parts.js";
import { glow, litSurface, scene, type Obj } from "./space.js";

export type DiagramVariant = "callouts" | "checklist" | "network";
export interface CalloutPoint { x: number; y: number; label: string }
export interface CheckItem { text: string; mark?: "yes" | "no" | "note"; sub?: string }

export interface DiagramOpts extends CommonOpts {
  variant?: DiagramVariant;
  /** callouts: a real screen ("/assets/<screen>.jpg") for the panel; without it a calm placeholder */
  src?: string;
  /** callouts: 2-5 points, x / y in 0..1 of the panel */
  points?: CalloutPoint[];
  /** checklist: 2-5 rows */
  items?: CheckItem[];
  /** checklist: a heading over the rows */
  title?: string;
  /** checklist: a stamp slammed on at the end ("Ready", "Shipped") */
  stamp?: string;
  /** network: the hub and 3-8 nodes; from = the node whose packets run to the hub (default 0) */
  hub?: string;
  nodes?: string[];
  from?: number;
  /** ms between two beats (callouts, rows) */
  step_ms?: number;
}

/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const DIAGRAM_MOTIONS: Record<DiagramVariant, MotionTable> = {
  callouts: {
    "panel.in": { ease: "house", doc: "the panel settling in (0.96x -> 1x)" },
    push: { ease: "in-out-sine", doc: "the slow 2 % push on the panel and its marks over the whole shot" },
    "dot.pop": { ease: [0.34, 1.9, 0.64, 1], doc: "a point's dot popping" },
    ripple: { ease: "out-quad", doc: "the ripple spreading from a dot (repeats)" },
    "line.draw": { ease: "out-cubic", doc: "the leader line drawing out to the side" },
    "tag.pop": { ease: "overshoot", doc: "the label popping at the line's end" },
  },
  checklist: {
    "title.in": { ease: "house", doc: "the heading fading in" },
    "row.in": { ease: "house", doc: "each row sliding in 40 px from the left" },
    "mark.circle": { ease: "linear", doc: "the mark's circle drawing" },
    "mark.glyph": { ease: "out-quad", doc: "the tick, cross or note drawing" },
    "stamp.drop": { ease: "in-cubic", doc: "the stamp dropping from 1.6x onto the list" },
    "stamp.settle": { ease: "out-quad", doc: "the stamp's small rebound settling" },
  },
  network: {
    "hub.pop": { ease: "overshoot", doc: "the hub popping in" },
    "node.pop": { ease: "overshoot", doc: "each node tag popping in" },
    "spoke.draw": { ease: "out-cubic", doc: "each spoke drawing to the hub" },
    pave: { ease: "in-out-sine", doc: "the source's spoke paving toward the hub" },
    packet: { ease: "in-out-sine", doc: "a packet riding the source's spoke" },
  },
};

export function diagram(host: HTMLElement, o: DiagramOpts): Component {
  const v: DiagramVariant = o.variant ?? "callouts";
  const th = theme(o);
  const M = motions(DIAGRAM_MOTIONS[v] ?? DIAGRAM_MOTIONS.callouts, o.ease, `diagram.${v}`);
  const el = root(host, th, o, `diagram-${v}`);
  const start = o.start_ms ?? 300;
  if (v === "checklist") return checklist(el, th, o, start, M);
  if (v === "network") return network(el, th, o, start, M);
  return callouts(el, th, o, start, M);
}
type Moves = ReturnType<typeof motions>;

// ---------------------------------------------------------------- callouts
function callouts(el: HTMLElement, th: Theme, o: DiagramOpts, start: number, M: Moves): Component {
  const pts = (o.points ?? [{ x: 0.22, y: 0.3, label: "Paste a link" }, { x: 0.7, y: 0.42, label: "Pick a look" }, { x: 0.35, y: 0.78, label: "Get the film" }]).slice(0, 5);
  const PW = 1040, PH = 620, px = 960 - PW / 2, py = 540 - PH / 2;
  const beat = o.step_ms ?? 800;
  const end = start + 700 + (pts.length - 1) * beat + 900;
  const sc = scene(el, {
    camera: o.camera,
    objects: [
      { id: "panel", w: PW, h: PH, at: [960, 540], motion: { opacity: [[start, 0], [start + 550, 1, M["panel.in"]]], scale: [[start, 0.96], [start + 550, 1, M["panel.in"]], [end + 1200, 1.02, M.push]] } },
      // the marks ride the panel: its child, in front of it, in stage coordinates
      { id: "marks", w: 1920, h: 1080, parent: "panel", at: [0, 0], z: 2 },
    ],
  });
  const L = sc.sp.slots.panel.light;
  const panel = h("div", { position: "absolute", inset: 0, overflow: "hidden", ...litSurface(th, L, th.surface, { radius: 24, rim: 1.5 }), border: `1px solid ${th.line}` });
  if (o.src) { const img = h("img", { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }) as HTMLImageElement; img.src = o.src; panel.append(img); }
  else {
    const tone = (a: number) => mix(th.surface, th.ink, a);
    panel.append(h("div", { position: "absolute", left: 0, right: 0, top: 0, height: 64, background: tone(0.05) }));
    [[48, 120, 420, 44, 0.16], [48, 196, 300, 22, 0.09], [48, 236, 360, 22, 0.09], [48, 330, 200, 64, 0], [560, 120, 430, 300, 0], [48, 460, 940, 110, 0.05]].forEach(([x, y, w, hh, a], i) => panel.append(h("div", { position: "absolute", left: x, top: y, width: w, height: hh, borderRadius: 14, background: i === 3 ? th.brand : i === 4 ? `linear-gradient(140deg, ${th.brand}, ${mix(th.brand, "#FFFFFF", 0.45)})` : tone(a as number), opacity: i === 4 ? 0.85 : 1 })));
  }
  sc.n.panel.body.append(panel);
  const marks = sc.n.marks.body;
  const s = stageSvg();
  marks.append(s);
  // labels outside the panel, spread so they never overlap
  const P = pts.map((p, i) => ({ p, i, x: px + p.x * PW, y: py + p.y * PH, side: (p.x < 0.5 ? "l" : "r") as "l" | "r", ly: 0 }));
  for (const side of ["l", "r"] as const) {
    const list = P.filter((q) => q.side === side).sort((a, b) => a.y - b.y);
    let last = -1e9;
    for (const q of list) { q.ly = Math.max(q.y, last + 96); last = q.ly; }
    const over = last - (py + PH - 20);
    if (over > 0) for (const q of list) q.ly -= over;
  }
  const C = P.map((q) => {
    const lx = q.side === "l" ? px - 50 : px + PW + 50, ex = q.side === "l" ? px - 24 : px + PW + 24;
    const d = `M ${q.x.toFixed(1)} ${q.y.toFixed(1)} L ${ex.toFixed(1)} ${q.ly.toFixed(1)} L ${lx.toFixed(1)} ${q.ly.toFixed(1)}`;
    const len = Math.hypot(ex - q.x, q.ly - q.y) + Math.abs(lx - ex);
    const line = svg("path", { d, fill: "none", stroke: th.accent, "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" });
    const ripple = svg("circle", { cx: q.x, cy: q.y, r: 14, fill: "none", stroke: th.accent, "stroke-width": 4 });
    const dot = svg("circle", { cx: q.x, cy: q.y, r: 12, fill: th.accent, stroke: th.surface, "stroke-width": 4 });
    s.append(line, ripple, dot);
    const t = tag(th, q.p.label, { size: 36, fill: th.accent, color: th.brandInk, ease: M["tag.pop"] });
    marks.append(t.el);
    return { q, lx, line, len, ripple, dot, t, w: 0, at: start + 700 + q.i * beat };
  });
  return {
    el, duration_ms: end + 1200,
    seek(ms) {
      sc.seek(ms);
      for (const c of C) {
        const d = ms >= c.at ? prog(M["dot.pop"], seg(ms, c.at, c.at + 300), 300) : 0;
        attr(c.dot, { r: (12 * d).toFixed(2), opacity: d > 0 ? 1 : 0 });
        const rp = ms >= c.at ? ((ms - c.at) % 1400) / 1400 : 0;
        attr(c.ripple, { r: (14 + 40 * prog(M.ripple, rp, 1400)).toFixed(1), opacity: ms >= c.at ? (0.7 * (1 - rp)).toFixed(3) : 0 });
        const l = along(M["line.draw"], ms, c.at + 150, c.at + 600);
        attr(c.line, { "stroke-dasharray": `${c.len.toFixed(1)} ${c.len.toFixed(1)}`, "stroke-dashoffset": (c.len * (1 - l)).toFixed(1), opacity: l > 0 ? 1 : 0 });
        c.t.set(seg(ms, c.at + 450, c.at + 900));
        // the tag hangs off the line's end on its side
        if (!c.w) c.w = c.t.el.offsetWidth;
        const w = c.w || 200;
        css(c.t.el, { left: c.q.side === "l" ? c.lx - w / 2 : c.lx + w / 2, top: c.q.ly });
      }
    },
  };
}

// ---------------------------------------------------------------- checklist
function checklist(el: HTMLElement, th: Theme, o: DiagramOpts, start: number, M: Moves): Component {
  const items = (o.items ?? [{ text: "Reads your page", mark: "yes" }, { text: "Writes the script", mark: "yes" }, { text: "Needs an editor", mark: "no" }]).slice(0, 5);
  const n = items.length, RW = 1100, X = 960 - RW / 2;
  const hasSub = items.some((i) => i.sub);
  const RH = hasSub ? 150 : 112, G = 26;
  const listH = n * RH + (n - 1) * G;
  const totalH = listH + (o.title ? 100 : 0);
  const top = 540 - totalH / 2, listTop = top + (o.title ? 100 : 0);
  const beat = o.step_ms ?? 800;
  const at = (i: number) => start + 300 + i * beat;
  const stampAt = at(n - 1) + beat + 300;
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "rows", kind: "column", at: [960, listTop + listH / 2], gap: G }],
    objects: [
      ...(o.title ? [{ id: "title", w: RW, h: 60, at: [960, top + 30], motion: { opacity: [[start - 150, 0], [start + 300, 1, M["title.in"]]] } } as Obj] : []),
      ...items.map((_, i): Obj => ({ id: `row${i}`, w: RW, h: RH, group: "rows", motion: { opacity: [[at(i), 0], [at(i) + 500, 1, M["row.in"]]], x: [[at(i), 40], [at(i) + 500, 0, M["row.in"]]] } })),
      ...(o.stamp ? [{ id: "stamp", w: 10, h: 10, at: [X + RW - 210, listTop + listH - 40], z: 10, motion: { rot: -8, opacity: [[stampAt, 0], [stampAt + 1, 1, "linear"]], scale: [[stampAt, 1.6], [stampAt + 180, 1, M["stamp.drop"]], [stampAt + 180, 1.03], [stampAt + 420, 1, M["stamp.settle"]]] } } as Obj] : []),
    ],
  });
  if (sc.n.title) sc.n.title.body.append(h("div", { position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", fontFamily: ff(th.display), fontSize: 46, color: th.ink, whiteSpace: "nowrap" }, o.title!));
  const colOf = (m: CheckItem["mark"]) => (m === "no" ? NO_RED : m === "note" ? NOTE_AMBER : th.accent);
  const R = items.map((it, i) => {
    const col = colOf(it.mark);
    const row = h("div", { position: "absolute", inset: 0, ...litSurface(th, sc.sp.slots[`row${i}`].light, th.surface, { radius: 24, rim: 1.5 }), border: `2px solid ${rgba(col, 0.35)}` });
    const m = svg("svg", { viewBox: "0 0 64 64", width: 64, height: 64 });
    (m as unknown as HTMLElement).style.cssText = `position:absolute;left:28px;top:${(RH - 64) / 2}px`;
    const circ = svg("circle", { cx: 32, cy: 32, r: 28, fill: "none", stroke: col, "stroke-width": 5 });
    const glyph = it.mark === "no" ? "M 21 21 L 43 43 M 43 21 L 21 43" : it.mark === "note" ? "M 32 16 L 32 36 M 32 46 L 32 47" : "M 19 33 L 28 42 L 46 23";
    const g = svg("path", { d: glyph, fill: "none", stroke: col, "stroke-width": 6, "stroke-linecap": "round", "stroke-linejoin": "round" });
    m.append(circ, g);
    row.append(m as unknown as HTMLElement);
    row.append(h("div", { position: "absolute", left: 124, top: hasSub ? 30 : 0, height: hasSub ? "auto" : RH, display: "flex", alignItems: "center", fontFamily: ff(th.display), fontSize: 44, color: th.ink, whiteSpace: "nowrap" }, it.text));
    if (it.sub) row.append(h("div", { position: "absolute", left: 124, top: 92, fontFamily: ff(th.body), fontSize: 30, color: th.muted, whiteSpace: "nowrap" }, it.sub));
    sc.n[`row${i}`].body.append(row);
    return { circ, g, at: at(i) };
  });
  if (o.stamp) sc.n.stamp.body.append(h("div", { position: "absolute", left: 5, top: 5, transform: "translate(-50%, -50%)", padding: "14px 34px", border: `8px solid ${th.accent}`, borderRadius: 18, color: th.accent, fontFamily: ff(th.display), fontSize: 64, letterSpacing: "0.04em", whiteSpace: "nowrap", background: rgba(th.bg, 0.5) }, o.stamp));
  return {
    el, duration_ms: (o.stamp ? stampAt : at(n - 1) + 700) + 1400,
    seek(ms) {
      sc.seek(ms);
      for (const r of R) {
        const c = along(M["mark.circle"], ms, r.at + 250, r.at + 500), g = along(M["mark.glyph"], ms, r.at + 450, r.at + 750);
        attr(r.circ, { "stroke-dasharray": "176 176", "stroke-dashoffset": (176 * (1 - c)).toFixed(1) });
        attr(r.g, { "stroke-dasharray": "80 80", "stroke-dashoffset": (80 * (1 - g)).toFixed(1), opacity: g > 0 ? 1 : 0 });
      }
    },
  };
}

// ---------------------------------------------------------------- network
function network(el: HTMLElement, th: Theme, o: DiagramOpts, start: number, M: Moves): Component {
  const nodes = (o.nodes ?? ["Docs", "Mail", "Chat", "Sheets", "Calendar", "Drive"]).slice(0, 8);
  const n = nodes.length, from = clamp(o.from ?? 0, 0, n - 1);
  const cx = 960, cy = 540, RX = 660, RY = 330, HR = 120;
  const geo = nodes.map((_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + (n % 2 === 0 ? Math.PI / n : 0);
    const x = cx + Math.cos(a) * RX, y = cy + Math.sin(a) * RY;
    const len = Math.hypot(x - cx, y - cy) - HR;
    const ux = (cx - x) / (len + HR), uy = (cy - y) / (len + HR);
    return { x, y, ex: cx - ux * HR, ey: cy - uy * HR };
  });
  const sc = scene(el, {
    camera: o.camera,
    objects: [
      { id: "web", w: 1920, h: 1080, at: [960, 540], z: -1 },
      { id: "hub", w: HR * 2, h: HR * 2, at: [cx, cy], z: 1, motion: { scale: [[start, 0], [start + 500, 1, M["hub.pop"]]], opacity: [[start, 0], [start + 250, 1, "linear"]] } },
      ...nodes.map((_, i): Obj => ({ id: `node${i}`, w: 10, h: 10, at: [geo[i].x, geo[i].y], z: 2 })),
    ],
  });
  const s = stageSvg();
  sc.n.web.body.append(s);
  const N = geo.map((q, i) => {
    const spoke = svg("line", { x1: q.x, y1: q.y, x2: q.ex, y2: q.ey, stroke: rgba(th.ink, 0.18), "stroke-width": 4, "stroke-linecap": "round" });
    const paved = svg("line", { x1: q.x, y1: q.y, x2: q.x, y2: q.y, stroke: th.accent, "stroke-width": 7, "stroke-linecap": "round" });
    s.append(spoke, paved);
    const t = tag(th, nodes[i], { size: 38, dot: i === from ? th.accent : th.muted, ease: M["node.pop"] });
    css(t.el, { left: 5, top: 5 });
    sc.n[`node${i}`].body.append(t.el);
    return { ...q, spoke, paved, t, i };
  });
  const packets = Array.from({ length: 6 }, () => { const g = svg("circle", { r: 26, fill: th.accent, "fill-opacity": 0.3 }); const p = svg("circle", { r: 10, fill: coreOf(th) }); s.append(g, p); return { g, p }; });
  const ambient = N.map(() => { const p = svg("circle", { r: 7, fill: th.accent }); s.append(p); return p; });
  // the hub's bloom is the hub's own light: inside its object, so it is occluded with the hub
  const hubGlow = glow(sc.n.hub, { color: th.accent, radius: 230, spread: 0.55 });
  const hub = h("div", { position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 38% 34%, ${mix(th.accent, "#FFFFFF", 0.35)} 0%, ${th.accent} 70%)`, boxShadow: `0 0 60px ${rgba(th.accent, 0.55)}`, display: "flex", alignItems: "center", justifyContent: "center", color: th.brandInk, fontFamily: ff(th.display), fontSize: o.hub && o.hub.length > 8 ? 32 : 40, textAlign: "center", lineHeight: 1.1 }, o.hub ?? "LaunchReel");
  sc.n.hub.body.append(hub);
  const spokesAt = start + 500 + n * 90;
  const runAt = spokesAt + 700, every = 260, travel = 520, runs = 6;
  const pavedEnd = runAt + (runs - 1) * every + travel;
  const src = N[from];
  return {
    el, duration_ms: pavedEnd + 2000,
    seek(ms) {
      sc.seek(ms);
      let pulse = 0;
      for (let k = 0; k < runs; k++) { const arr = runAt + k * every + travel; if (ms >= arr) pulse = Math.max(pulse, Math.exp(-(ms - arr) / 300)); }
      css(hub, { transform: `scale(${(1 + 0.06 * pulse).toFixed(4)})` });
      const hp = seg(ms, start, start + 500);
      hubGlow.set(0.25 * hp + 0.5 * seg(ms, runAt, pavedEnd) + 0.25 * pulse);
      for (const q of N) {
        q.t.set(seg(ms, start + 200 + q.i * 90, start + 200 + q.i * 90 + 420));
        const d = along(M["spoke.draw"], ms, spokesAt + q.i * 60, spokesAt + q.i * 60 + 500);
        attr(q.spoke, { x2: lerp(q.x, q.ex, d).toFixed(1), y2: lerp(q.y, q.ey, d).toFixed(1), opacity: d > 0 ? 1 : 0 });
      }
      const pv = along(M.pave, ms, runAt, pavedEnd);
      attr(src.paved, { x2: lerp(src.x, src.ex, pv).toFixed(1), y2: lerp(src.y, src.ey, pv).toFixed(1), opacity: pv > 0 ? 1 : 0 });
      packets.forEach((P, k) => {
        const t0 = runAt + k * every, p = prog(M.packet, seg(ms, t0, t0 + travel), travel);
        const vis = ms >= t0 && ms < t0 + travel;
        for (const e of [P.g, P.p]) attr(e, { cx: lerp(src.x, src.ex, p).toFixed(1), cy: lerp(src.y, src.ey, p).toFixed(1), opacity: vis ? 1 : 0 });
      });
      N.forEach((q, i) => {
        const t0 = pavedEnd + 200 + i * 120;
        if (ms < t0) { attr(ambient[i], { opacity: 0 }); return; }
        const cyc = ((ms - t0) % 1600) / 1600;
        const p = i % 2 ? cyc : 1 - cyc;
        attr(ambient[i], { cx: lerp(q.x, q.ex, p).toFixed(1), cy: lerp(q.y, q.ey, p).toFixed(1), opacity: (0.75 * Math.sin(cyc * Math.PI)).toFixed(3) });
      });
    },
  };
}
