/**
 * Engine requirements 2-4 (owner 10-19, after shot-03 v23 and shot-07): the scene is a spatial layout, glow respects depth, and
 * hierarchy is explicit.
 *
 * 2. Spatial layout first (「不能只是模仿帧,而是真的要去识别空间关系」). A scene is declared, not drawn: a light, a camera, groups
 *    (row, column, ring, grid, depth-stack: parallel cards behind each other) and objects with a size and a depth. The picture is
 *    generated from that layer: every object gets a slot (centre, depth, projected scale, stacking order, its lit side). Components
 *    take a place (a slot or rect) instead of absolute pixels and lay their own parts out the same way.
 * 3. Glow respects depth. Every object is a node with its own stacking context (isolation: isolate, z-index from depth). glow() and
 *    membrane() put the bloom, the spread ring or the bubble shell INSIDE that node, behind its content: whatever is in front of the
 *    object occludes its glow with it. Never a stage-wide blurred layer composited with ADD/screen on top (the shot-03 v23 bug: a
 *    sphere's membrane drawn over a card that is in front of the sphere).
 * 4. Hierarchy and parallax. An object with a parent follows it (world = parent.world ∘ local); detach: {at_ms} freezes the parent's
 *    transform as of at_ms (no jump) and the object moves on its own tracks after that. The camera projects by depth (scale =
 *    focal / (focal - cam.z - z)), so a camera move shifts near and far objects differently: real parallax. Anything whose speed
 *    differs from the hero, or that shows parallax, is declared as its own object (shot-07: the two tail sparks are not a texture).
 *
 * Coordinates are stage units (1920 x 1080), y down, z toward the viewer (z > 0 is in front of the stage plane). Pure seek.
 */
import { clamp, css, h, mix, rgba, type Theme } from "./core.js";
import { tracks, type Ease, type Key, type Tracks } from "./easing.js";

export const STAGE_W = 1920, STAGE_H = 1080;

/** where the key light comes from: angle in degrees (0 = from the top, 90 = from the right, clockwise), elevation 0 (grazing) .. 1 (frontal) */
export interface Light { angle?: number; elevation?: number }
export interface Camera {
  /** focal distance in px (default 1800): depth z = focal / 2 in front of the stage doubles in size */
  focal?: number;
  /** camera pan (stage units) and push (z toward the scene); numbers or keyframe tracks */
  x?: number | Key[]; y?: number | Key[]; z?: number | Key[];
}
export type GroupKind = "row" | "column" | "ring" | "grid" | "depth-stack" | "free";
export interface Group {
  id: string;
  kind: GroupKind;
  /** the group's centre (stage units, default the stage centre) and depth */
  at?: [number, number];
  z?: number;
  /** gap between members (row / column / grid), the ring's radius, the depth-stack's step back per member */
  gap?: number;
  radius?: number;
  /** ring: the first member's angle in degrees (0 = top, clockwise; default 0) */
  start?: number;
  /** grid: columns */
  cols?: number;
  /** depth-stack: offset in x/y per member (parallel cards stepping back and aside) */
  offset?: [number, number];
  /** row / column: cross-axis alignment */
  align?: "center" | "start" | "end";
}
/** an object's local motion: keyframe tracks for x, y, z (offset from its laid-out place), rot (deg), scale, opacity */
export type Motion = Partial<Record<"x" | "y" | "z" | "rot" | "scale" | "opacity", number | Key[]>>;
export interface Obj {
  id: string;
  w: number;
  h: number;
  /** depth (default the group's z, else 0) */
  z?: number;
  group?: string;
  /** free placement: centre in stage units (or, with a parent, in the parent's local units) */
  at?: [number, number];
  /** follow this object's transform (hierarchy) */
  parent?: string;
  /** stop following the parent from at_ms on, keeping the world transform it had then */
  detach?: { at_ms: number };
  motion?: Motion;
  /** an offset that rides a path (a parabola hop, a road): pure function of ms, added to the x/y tracks */
  follow?: (ms: number) => [number, number];
  /** default ease for this object's keys that do not name one */
  ease?: Ease;
}
export interface SpaceSpec { light?: Light; camera?: Camera; groups?: Group[]; objects: Obj[] }

/** a laid-out object: where it is and how it is lit, before motion */
export interface Slot {
  id: string;
  x: number; y: number; z: number; w: number; h: number;
  /** the key light as seen by this object: unit vector toward the light (dx, dy) and how frontal it is (k, 0..1) */
  light: { dx: number; dy: number; k: number };
}
/** an object's world state at a time */
export interface World { x: number; y: number; z: number; rot: number; scale: number; opacity: number }
/** projected to the screen */
export interface Screen { x: number; y: number; s: number; rot: number; opacity: number; depth: number }

export interface Space {
  slots: Record<string, Slot>;
  /** world transform of an object at ms (hierarchy and detach applied) */
  world(id: string, ms: number): World;
  /** projected position at ms */
  screen(id: string, ms: number): Screen;
}

const lightVec = (l: Light = {}) => {
  const a = ((l.angle ?? 315) * Math.PI) / 180; // default: from the top left
  return { dx: Math.sin(a), dy: -Math.cos(a), k: clamp(l.elevation ?? 0.6) };
};

/** lay out the groups and objects (requirement 2); pure, no DOM */
export function layout(spec: SpaceSpec): Record<string, Slot> {
  const L = lightVec(spec.light);
  const groups = new Map((spec.groups ?? []).map((g) => [g.id, g]));
  const members = new Map<string, Obj[]>();
  for (const o of spec.objects) if (o.group) {
    if (!groups.has(o.group)) throw new RangeError(`object "${o.id}": no group "${o.group}"`);
    (members.get(o.group) ?? members.set(o.group, []).get(o.group)!).push(o);
  }
  const slots: Record<string, Slot> = {};
  const put = (o: Obj, x: number, y: number, z: number) => { slots[o.id] = { id: o.id, x, y, z: o.z ?? z, w: o.w, h: o.h, light: L }; };
  for (const [gid, ms] of members) {
    const g = groups.get(gid)!;
    const [cx, cy] = g.at ?? [STAGE_W / 2, STAGE_H / 2];
    const gz = g.z ?? 0, gap = g.gap ?? 40, n = ms.length;
    const cross = (size: number, max: number) => (g.align === "start" ? -(max - size) / 2 : g.align === "end" ? (max - size) / 2 : 0);
    if (g.kind === "row" || g.kind === "column") {
      const along = (o: Obj) => (g.kind === "row" ? o.w : o.h);
      const total = ms.reduce((s, o) => s + along(o), 0) + gap * (n - 1);
      const maxC = Math.max(...ms.map((o) => (g.kind === "row" ? o.h : o.w)));
      let p = -total / 2;
      for (const o of ms) {
        const c = p + along(o) / 2;
        if (g.kind === "row") put(o, cx + c, cy + cross(o.h, maxC), gz); else put(o, cx + cross(o.w, maxC), cy + c, gz);
        p += along(o) + gap;
      }
    } else if (g.kind === "ring") {
      const r = g.radius ?? 300, a0 = ((g.start ?? 0) * Math.PI) / 180;
      ms.forEach((o, i) => { const a = a0 + (i / n) * Math.PI * 2; put(o, cx + Math.sin(a) * r, cy - Math.cos(a) * r, gz); });
    } else if (g.kind === "grid") {
      const cols = Math.max(1, g.cols ?? Math.ceil(Math.sqrt(n))), rows = Math.ceil(n / cols);
      const cw = Math.max(...ms.map((o) => o.w)), ch = Math.max(...ms.map((o) => o.h));
      ms.forEach((o, i) => { const c = i % cols, r = Math.floor(i / cols); put(o, cx + (c - (cols - 1) / 2) * (cw + gap), cy + (r - (rows - 1) / 2) * (ch + gap), gz); });
    } else if (g.kind === "depth-stack") {
      // parallel cards: each next member is one step further back, offset aside; they never cross (the shot-03 small card)
      const [ox, oy] = g.offset ?? [60, -40];
      ms.forEach((o, i) => put(o, cx + ox * i, cy + oy * i, gz - (g.gap ?? 120) * i));
    } else ms.forEach((o) => put(o, cx + (o.at?.[0] ?? 0), cy + (o.at?.[1] ?? 0), gz));
  }
  for (const o of spec.objects) if (!o.group) {
    const [x, y] = o.at ?? (o.parent ? [0, 0] : [STAGE_W / 2, STAGE_H / 2]);
    put(o, x, y, 0);
  }
  return slots;
}

/** the scene: layout + hierarchy + camera (requirements 2 and 4); pure, no DOM */
export function space(spec: SpaceSpec): Space {
  const slots = layout(spec);
  const objs = new Map(spec.objects.map((o) => [o.id, o]));
  for (const o of spec.objects) {
    if (o.parent && !objs.has(o.parent)) throw new RangeError(`object "${o.id}": no parent "${o.parent}"`);
    for (let p = o.parent, n = 0; p; p = objs.get(p)?.parent, n++) if (p === o.id || n > 64) throw new RangeError(`object "${o.id}": its parents form a loop`);
  }
  const motion = new Map<string, Tracks>();
  for (const o of spec.objects) {
    const m = o.motion ?? {};
    motion.set(o.id, tracks({ x: m.x ?? 0, y: m.y ?? 0, z: m.z ?? 0, rot: m.rot ?? 0, scale: m.scale ?? 1, opacity: m.opacity ?? 1 }, o.ease ?? "house"));
  }
  const cam = tracks({ x: spec.camera?.x ?? 0, y: spec.camera?.y ?? 0, z: spec.camera?.z ?? 0 }, "in-out-sine");
  const focal = spec.camera?.focal ?? 1800;
  const local = (id: string, ms: number): World => {
    const s = slots[id], t = motion.get(id)!.at(ms);
    const f = objs.get(id)!.follow?.(ms) ?? [0, 0];
    return { x: s.x + t.x + f[0], y: s.y + t.y + f[1], z: s.z + t.z, rot: t.rot, scale: t.scale, opacity: t.opacity };
  };
  const compose = (p: World, l: World): World => {
    const a = (p.rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    return { x: p.x + (l.x * c - l.y * sn) * p.scale, y: p.y + (l.x * sn + l.y * c) * p.scale, z: p.z + l.z * p.scale, rot: p.rot + l.rot, scale: p.scale * l.scale, opacity: p.opacity * l.opacity };
  };
  const world = (id: string, ms: number): World => {
    const o = objs.get(id);
    if (!o) throw new RangeError(`no object "${id}"`);
    const l = local(id, ms);
    if (!o.parent) return l;
    // detached: the parent as it was at the moment of detaching (continuous at at_ms), then the object's own tracks
    const pt = o.detach && ms >= o.detach.at_ms ? o.detach.at_ms : ms;
    return compose(world(o.parent, pt), l);
  };
  const screen = (id: string, ms: number): Screen => {
    const w = world(id, ms), c = cam.at(ms);
    const dist = Math.max(focal * 0.08, focal - c.z - w.z);
    const s = focal / dist;
    return { x: STAGE_W / 2 + (w.x - c.x - STAGE_W / 2) * s, y: STAGE_H / 2 + (w.y - c.y - STAGE_H / 2) * s, s: s * w.scale, rot: w.rot, opacity: w.opacity, depth: w.z + c.z };
  };
  return { slots, world, screen };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DOM: object nodes (own stacking context), glow inside the node, lit surfaces

/** an object's DOM node: its own stacking context, centred on its slot; content goes in node.body, glow behind it */
export interface ObjNode { el: HTMLElement; body: HTMLElement; id: string }

/** make the node of an object (requirement 3: isolation + depth z-index, so glow inside is occluded with the object) */
export function objNode(sp: Space, id: string, cls = ""): ObjNode {
  const s = sp.slots[id];
  if (!s) throw new RangeError(`no object "${id}"`);
  const el = h("div", { position: "absolute", left: 0, top: 0, width: s.w, height: s.h, isolation: "isolate", transformOrigin: "50% 50%", willChange: "transform" });
  el.dataset.mvObj = id;
  if (cls) el.className = cls;
  const body = h("div", { position: "absolute", inset: 0, zIndex: 1 });
  el.append(body);
  return { el, body, id };
}

/**
 * Place nodes at ms: transform from the projected world state, z-index from depth (front over back). Objects at equal depth keep
 * their declaration order. Writes only when a value changes.
 */
export function placeNodes(sp: Space, nodes: ObjNode[], ms: number): void {
  const sc = nodes.map((n, i) => ({ n, i, s: sp.screen(n.id, ms) }));
  const order = [...sc].sort((a, b) => a.s.depth - b.s.depth || a.i - b.i);
  order.forEach((o, rank) => {
    const slot = sp.slots[o.n.id];
    css(o.n.el, {
      transform: `translate(${(o.s.x - slot.w / 2).toFixed(2)}px, ${(o.s.y - slot.h / 2).toFixed(2)}px) rotate(${o.s.rot.toFixed(3)}deg) scale(${o.s.s.toFixed(4)})`,
      opacity: clamp(o.s.opacity).toFixed(3),
      zIndex: String(10 + rank),
      visibility: o.s.opacity <= 0.001 ? "hidden" : "visible",
    });
  });
}

export interface GlowOpts {
  color: string;
  /** reach beyond the object's edge, px */
  radius?: number;
  /** 0..1: how much of the reach is bright (a tight glow ~0.3, a wide bloom ~0.7) */
  spread?: number;
  /** circle: a round bloom; rect: a halo that follows the object's rounded box (corner = its border radius) */
  shape?: "circle" | "rect";
  corner?: number;
  /** the glow's own offset from the object's centre (e.g. toward the light) */
  dx?: number; dy?: number;
}
export interface Glow { el: HTMLElement; set(alpha: number, scale?: number): void }

/**
 * Glow that belongs to its object (requirement 3): a bloom inside the object's node, behind its body. What is in front of the
 * object hides the glow with it; the glow never paints over an object nearer the camera. No blend modes, no stage layer.
 */
export function glow(node: ObjNode, o: GlowOpts): Glow {
  const w = parseFloat(node.el.style.width) || 0, hh = parseFloat(node.el.style.height) || 0;
  const r = o.radius ?? Math.max(w, hh) * 0.5, sp = clamp(o.spread ?? 0.5, 0.05, 0.95);
  const dx = o.dx ?? 0, dy = o.dy ?? 0;
  const el = (o.shape ?? "circle") === "circle"
    ? h("div", {
        position: "absolute", left: -r + dx, top: -r + dy, width: w + r * 2, height: hh + r * 2, borderRadius: "50%",
        background: `radial-gradient(closest-side, ${rgba(o.color, 0.75)} 0%, ${rgba(o.color, 0.75 * sp)} ${Math.round(sp * 60)}%, ${rgba(o.color, 0)} 100%)`,
      })
    : h("div", {
        position: "absolute", left: dx, top: dy, width: w, height: hh, borderRadius: o.corner ?? 24,
        boxShadow: `0 0 ${(r * (0.4 + sp)).toFixed(1)}px ${(r * sp * 0.35).toFixed(1)}px ${rgba(o.color, 0.55)}`,
      });
  css(el, { zIndex: 0, pointerEvents: "none", transformOrigin: "50% 50%" });
  el.dataset.mvGlow = node.id;
  node.el.insertBefore(el, node.body);
  const set = (alpha: number, scale = 1) => css(el, { opacity: clamp(alpha).toFixed(3), transform: `scale(${scale.toFixed(4)})` });
  set(0);
  return { el, set };
}

/**
 * A bubble shell around an object (the 气泡光球 membrane): thin, transparent, a Fresnel rim brighter on the lit side, a faint inner
 * mist. It is part of the object node, so it is occluded with the object (never drawn over a card in front of it).
 */
export function membrane(node: ObjNode, o: { color: string; light: Slot["light"]; thickness?: number }): Glow {
  const w = parseFloat(node.el.style.width) || 0, hh = parseFloat(node.el.style.height) || 0;
  const lx = 50 + o.light.dx * 22, ly = 50 + o.light.dy * 22;
  const el = h("div", {
    position: "absolute", left: 0, top: 0, width: w, height: hh, borderRadius: "50%", zIndex: 2, pointerEvents: "none",
    background: `radial-gradient(circle at ${lx.toFixed(1)}% ${ly.toFixed(1)}%, ${rgba("#FFFFFF", 0.22)} 0%, ${rgba("#FFFFFF", 0)} 30%), radial-gradient(closest-side, ${rgba(o.color, 0.04)} 0%, ${rgba(o.color, 0.08)} 70%, ${rgba(o.color, 0.5)} 94%, ${rgba(o.color, 0)} 100%)`,
    boxShadow: `inset ${(-o.light.dx * (o.thickness ?? 3)).toFixed(1)}px ${(-o.light.dy * (o.thickness ?? 3)).toFixed(1)}px ${(o.thickness ?? 3) * 3}px ${rgba("#FFFFFF", 0.35)}`,
    transformOrigin: "50% 50%",
  });
  el.dataset.mvGlow = node.id;
  node.el.append(el);
  const set = (alpha: number, scale = 1) => css(el, { opacity: clamp(alpha).toFixed(3), transform: `scale(${scale.toFixed(4)})` });
  set(0);
  return { el, set };
}

/**
 * A surface lit by the key light (no flat fill, no stacked gradients): the lit side a little lighter, the far side a little darker,
 * a narrow rim on the edge that faces the light. Returns styles for a card/panel/tube body.
 */
export function litSurface(th: Theme, light: Slot["light"], base: string, o: { radius?: number; rim?: number } = {}): Record<string, string | number> {
  const ang = (Math.atan2(light.dx, -light.dy) * 180) / Math.PI; // css gradient angle pointing toward the light
  const dark = th.stage === "dark";
  const hi = mix(base, "#FFFFFF", dark ? 0.1 + 0.08 * light.k : 0.5 + 0.2 * light.k), lo = mix(base, "#000000", dark ? 0.18 : 0.04);
  const rim = o.rim ?? 1.5;
  return {
    borderRadius: o.radius ?? 24,
    background: `linear-gradient(${(ang + 180).toFixed(1)}deg, ${lo} 0%, ${base} 55%, ${hi} 100%)`,
    boxShadow: `inset ${(light.dx * rim).toFixed(2)}px ${(light.dy * rim).toFixed(2)}px 0 ${rgba("#FFFFFF", dark ? 0.16 : 0.85)}, ${dark ? "0 16px 40px rgba(0,0,0,0.38)" : "0 16px 40px rgba(20,24,40,0.10)"}`,
  };
}

/** a declared scene mounted in a component root: one node per object (declaration order = DOM order), placed on seek */
export interface Scene { sp: Space; n: Record<string, ObjNode>; seek(ms: number): void }
export function scene(el: HTMLElement, spec: SpaceSpec): Scene {
  const sp = space(spec);
  const n: Record<string, ObjNode> = {};
  const list = spec.objects.map((o) => (n[o.id] = objNode(sp, o.id)));
  for (const x of list) el.append(x.el);
  return { sp, n, seek: (ms) => placeNodes(sp, list, ms) };
}

/** the slam on a landing as scale keys (FX.slam): at `at` 1 -> 1.5, drops to 0.94 in 170 ms, settles to 1 by 300 ms */
export function slamKeys(at: number, drop: Ease = "in-quad", settle: Ease = "in-out-sine"): Key[] {
  return [[at, 1], [at, 1.5], [at + 170, 0.94, drop], [at + 300, 1, settle]];
}
