/**
 * Family 5: transitions between shots, written inside the shots (the runtime's transition_in is the other way; never both on one cut).
 * A cut is two halves with the same options: phase "out" at the end of the leaving shot (at_ms = shot length − dur_ms), phase "in" at
 * the start of the entering shot (at_ms 0). Speeds match at the cut: the out half accelerates into it, the in half decelerates out of it.
 * Variants: a push/wipe in the brand colour, a zoom through a UI element, a match-cut card flip, a light sweep.
 * The sweep's light is per object (requirement 3: light respects depth): each surface of the shot gets its own specular band, clipped
 * to it and inside its stacking context, placed where one global band would cross it; each object brightens as the band passes its
 * centre. No blend mode and no light layer over the stage: only the cut's dip to white is a full-frame cover (plain paint, like the
 * wipe's panels).
 */
import { css, h, lerp, mix, rgba, root, seg, theme, zlerp, type CommonOpts, type Component } from "./core.js";
import { along, motions, prog, type MotionTable } from "./easing.js";

export type TransitionVariant = "wipe" | "zoomThrough" | "flip" | "sweep";
export type Dir = "left" | "right" | "up" | "down";

export interface TransitionOpts extends CommonOpts {
  variant?: TransitionVariant;
  phase: "out" | "in";
  /** ms into the shot when this half starts (out: shot length − dur_ms; in: 0) */
  at_ms?: number;
  /** length of this half (default wipe 420, zoomThrough 560, flip 460, sweep 480) */
  dur_ms?: number;
  /** the direction things travel (wipe, flip, sweep); default "left" (they move toward the left, the new shot comes from the right) */
  dir?: Dir;
  /** zoomThrough / flip: the element that moves (the shot's main wrapper); default the host's first child */
  content?: HTMLElement | string;
  /** zoomThrough: the UI element's rectangle in stage px, the hole the camera goes through (out) or comes out of (in) */
  target?: { x: number; y: number; w: number; h: number };
  /** zoomThrough: the colour of the target's face that fills the frame at the cut (default the stage surface) */
  fill?: string;
}

/** the named moves of each variant and their default curves (opts.ease overrides any of them by name). Out halves accelerate into the cut, in halves decelerate out of it. */
export const TRANSITION_MOTIONS: Record<TransitionVariant, MotionTable> = {
  wipe: {
    cover: { ease: "in-cubic", doc: "out half: the two brand panels sweeping across to cover the frame" },
    uncover: { ease: "out-cubic", doc: "in half: the panels sweeping on and off the new shot" },
  },
  zoomThrough: {
    "zoom.in": { ease: "in-cubic", doc: "out half: the camera flying into the target element" },
    "face.fill": { ease: "in-quad", doc: "out half: the target's face filling the frame in the last 40 %" },
    "zoom.out": { ease: "out-expo", doc: "in half: the new shot growing out of the target's place" },
    "face.clear": { ease: "out-quad", doc: "in half: the face colour clearing in the first 35 %" },
  },
  flip: {
    "flip.away": { ease: "in-quad", doc: "out half: the card turning edge-on and shrinking to 0.88x" },
    "flip.in": { ease: "out-quad", doc: "in half: the new card turning in from edge-on" },
  },
  sweep: {
    "band.in": { ease: "in-quad", doc: "out half: the light band travelling to the frame centre" },
    "band.out": { ease: "out-quad", doc: "in half: the band travelling on and off the frame" },
    lift: { ease: "in-expo", doc: "out half: the exposure lifting toward white at the cut" },
    fall: { ease: "out-cubic", doc: "in half: the exposure falling back after the cut" },
  },
};

export function transition(host: HTMLElement, o: TransitionOpts): Component {
  const v: TransitionVariant = o.variant ?? "wipe";
  const th = theme(o);
  const el = root(host, th, { ...o, background: false }, `tr-${v}-${o.phase}`);
  css(el, { zIndex: 50 });
  const M = motions(TRANSITION_MOTIONS[v], o.ease, `transition.${v}`);
  const out = o.phase !== "in";
  const dur = o.dur_ms ?? { wipe: 420, zoomThrough: 560, flip: 460, sweep: 480 }[v];
  const at = o.at_ms ?? (out ? 0 : 0);
  const dir: Dir = o.dir ?? "left";
  const horiz = dir === "left" || dir === "right";
  const sign = dir === "left" || dir === "up" ? -1 : 1;
  const resolve = (): HTMLElement | null => {
    if (o.content instanceof HTMLElement) return o.content;
    if (typeof o.content === "string") return host.querySelector(o.content) ?? document.querySelector(o.content);
    for (const c of Array.from(host.children)) if (c !== el && c instanceof HTMLElement && !c.classList.contains("mv-root")) return c;
    return null;
  };
  // progress through this half, eased so the speed peaks at the cut
  const raw = (ms: number) => seg(ms, at, at + dur);
  let seek: (ms: number) => void;

  if (v === "wipe") {
    const panels = [mix(th.brand, "#000000", 0.28), th.brand].map((c) => h("div", { position: "absolute", left: horiz ? -320 : -100, top: horiz ? -100 : -320, width: horiz ? 1920 + 640 : 2120, height: horiz ? 1280 : 1080 + 640, background: c, transform: "none" }));
    el.append(...panels);
    const span = horiz ? 1920 + 640 : 1080 + 640;
    seek = (ms) => {
      panels.forEach((p, i) => {
        // out: the back panel leads, the front follows 70 ms behind, both reach full cover at the cut
        // in: the front panel leaves first, the back one follows
        const lag = out ? (i === 0 ? 0 : 70) : (i === 1 ? 0 : 70);
        const q = out ? along(M.cover, ms, at + lag, at + dur - (i === 0 ? 70 : 0)) : along(M.uncover, ms, at + lag, at + dur - (i === 1 ? 70 : 0));
        // position: out travels from off-screen (opposite of sign) to 0; in travels from 0 to off-screen (in sign direction)
        const off = out ? (1 - q) * -sign * span : q * sign * span;
        const skew = horiz ? `skewX(${-sign * 12}deg)` : `skewY(${-sign * 8}deg)`;
        css(p, { transform: `${horiz ? `translateX(${off.toFixed(1)}px)` : `translateY(${off.toFixed(1)}px)`} ${skew}`, opacity: (out ? ms >= at : ms < at + dur + 1) ? 1 : 0 });
      });
    };
  } else if (v === "zoomThrough") {
    const t = o.target ?? { x: 760, y: 440, w: 400, h: 200 };
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    const S = Math.max(1920 / t.w, 1080 / t.h) * 1.08;
    const face = h("div", { position: "absolute", inset: 0, background: o.fill ?? th.surface, opacity: 0 });
    el.append(face);
    seek = (ms) => {
      const c = resolve();
      const r = raw(ms);
      if (out) {
        const p = prog(M["zoom.in"], r, dur);
        const s = zlerp(1, S, p);
        const q = Math.log(s) / Math.log(S);
        if (c) css(c, { transformOrigin: `${cx}px ${cy}px`, transform: `translate(${((960 - cx) * q).toFixed(2)}px, ${((540 - cy) * q).toFixed(2)}px) scale(${s.toFixed(5)})` });
        css(face, { opacity: prog(M["face.fill"], seg(r, 0.6, 1), dur * 0.4).toFixed(3) });
      } else {
        const p = prog(M["zoom.out"], r, dur);
        const s0 = Math.max(t.w / 1920, t.h / 1080);
        const s = zlerp(s0, 1, p);
        const q = 1 - Math.log(s) / Math.log(s0);
        // the new shot grows out of the target's place
        if (c) css(c, { transformOrigin: "960px 540px", transform: `translate(${((cx - 960) * (1 - q)).toFixed(2)}px, ${((cy - 540) * (1 - q)).toFixed(2)}px) scale(${s.toFixed(5)})`, borderRadius: `${((1 - p) * 40).toFixed(1)}px`, overflow: "hidden" });
        css(face, { opacity: (1 - prog(M["face.clear"], seg(r, 0, 0.35), dur * 0.35)).toFixed(3) });
      }
    };
  } else if (v === "flip") {
    // the backdrop sits behind the content: what shows while the card is edge-on
    host.prepend(el);
    css(el, { zIndex: 0, background: mix(th.bg, "#000000", th.stage === "dark" ? 0.4 : 0.12) });
    seek = (ms) => {
      const c = resolve();
      const r = raw(ms);
      const axis = horiz ? "rotateY" : "rotateX";
      const f = prog(M[out ? "flip.away" : "flip.in"], r, dur);
      const deg = out ? f * 90 * -sign : (1 - f) * 90 * sign;
      const sc = out ? lerp(1, 0.88, f) : lerp(0.88, 1, f);
      if (c && getComputedStyle(c).position === "static") css(c, { position: "relative" });
      if (c) css(c, { zIndex: 1, transform: `perspective(2200px) ${axis}(${deg.toFixed(3)}deg) scale(${sc.toFixed(4)})`, transformOrigin: "50% 50%", backfaceVisibility: "hidden" });
      css(el, { opacity: (out ? r > 0 : r < 1) ? 1 : 0 });
    };
  } else {
    // one light crosses the shot, met object by object: a specular band inside each surface (clipped to it) and a brightness lift as
    // the band passes each object's centre; the exposure dips toward white at the cut (a plain full-frame cover)
    const wash = h("div", { position: "absolute", inset: 0, background: mix("#FFFFFF", th.brand, 0.08) });
    el.append(wash);
    const BW = 760, tint = mix("#FFFFFF", th.brand, 0.12);
    type Lit = { t: HTMLElement; band: HTMLElement | null; filter: string };
    let lit: Lit[] | null = null;
    const find = (): Lit[] => {
      const c = resolve();
      if (!c) return [];
      const objs = Array.from(c.querySelectorAll<HTMLElement>("[data-mv-obj]"));
      const ts: HTMLElement[] = [];
      if (objs.length) ts.push(...objs);
      else {
        const cr = c.getBoundingClientRect(), full = cr.width * cr.height || 1;
        const visit = (p: Element) => {
          for (const x of Array.from(p.children)) {
            if (!(x instanceof HTMLElement) || x === el || x.dataset.mvLight !== undefined) continue;
            const r = x.getBoundingClientRect();
            if (r.width * r.height <= 0) continue;
            const cs = getComputedStyle(x);
            const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || ["IMG", "CANVAS", "VIDEO", "svg"].includes(x.tagName);
            const texty = Array.from(x.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
            if (r.width * r.height > 0.85 * full || (!painted && !texty)) visit(x);
            else ts.push(x);
          }
        };
        visit(c);
      }
      return ts.map((t) => {
        const cs = getComputedStyle(t);
        const surface = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || t.dataset.mvObj !== undefined;
        let band: HTMLElement | null = null;
        if (surface && !["IMG", "CANVAS", "VIDEO"].includes(t.tagName)) {
          if (cs.position === "static") css(t, { position: "relative" });
          const wrap = h("div", { position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit", pointerEvents: "none", zIndex: 30 });
          wrap.dataset.mvLight = "";
          band = h("div", { position: "absolute", width: BW, height: 2480, background: `linear-gradient(90deg, ${rgba(tint, 0)}, ${rgba(tint, th.stage === "dark" ? 0.34 : 0.6)}, ${rgba(tint, 0)})`, transform: "rotate(18deg)", opacity: 0 });
          wrap.append(band);
          t.append(wrap);
        }
        return { t, band, filter: t.style.filter };
      });
    };
    seek = (ms) => {
      if (!lit) lit = find();
      const r = raw(ms);
      const p = out ? along(M["band.in"], ms, at, at + dur) : along(M["band.out"], ms, at, at + dur);
      // the band's centre in stage units: out runs from off-screen to the frame centre, in from the centre to off-screen
      const from = sign < 0 ? 1920 + 880 : -880, to = sign < 0 ? -880 : 1920 + 880;
      const cx = out ? lerp(from, 960, p) : lerp(960, to, p);
      const live = ms >= at && r < 1;
      const hr = host.getBoundingClientRect(), k = hr.width / 1920 || 1;
      for (const L of lit) {
        const b = L.t.getBoundingClientRect();
        const tx = (b.left - hr.left) / k, ty = (b.top - hr.top) / k, tw = b.width / k;
        const s = L.t.offsetWidth ? tw / L.t.offsetWidth : 1; // the object's own scale on the stage
        // light on the object as the band crosses its centre (a soft falloff over the band's width)
        const d = (tx + tw / 2 - cx) / BW;
        const g = live ? Math.exp(-d * d * 3) : 0;
        css(L.t, { filter: g > 0.01 ? `${L.filter} brightness(${(1 + 0.45 * g).toFixed(3)})`.trim() : L.filter });
        if (L.band) css(L.band, { left: ((cx - BW / 2 - tx) / s).toFixed(1) + "px", top: ((-700 - ty) / s).toFixed(1) + "px", opacity: live ? 1 : 0 });
      }
      css(wash, { opacity: (out ? 0.92 * prog(M.lift, r, dur) : 0.92 * (1 - prog(M.fall, r, dur))).toFixed(3) });
    };
  }
  return { el, duration_ms: at + dur, seek: (ms) => seek(ms) };
}

/** the default length of one half of a transition */
export const transitionSpan = (o: Pick<TransitionOpts, "variant" | "dur_ms">): number => o.dur_ms ?? { wipe: 420, zoomThrough: 560, flip: 460, sweep: 480 }[o.variant ?? "wipe"];
