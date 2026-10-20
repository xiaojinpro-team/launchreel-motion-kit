/**
 * Motion vocabulary core (xjp.motion-vocab.v1): the shared pieces of the vocabulary components.
 * A component is `factory(host, opts) -> { el, duration_ms, seek(ms) }`. `seek` is pure: the same ms gives the same DOM, every time,
 * in any order (the free-film renderer seeks frames, it never plays). No clock, no rAF, no Math.random: jitter is seeded from the text.
 * Layout that depends on fonts (fits, wrapped heights) is measured on the first seek, after the runtime loaded the fonts.
 * Coordinates are stage pixels of a 1920x1080 frame; the host is the stage (the component fills it, position: absolute; inset: 0).
 */

import type { Ease } from "./easing.js";
import type { Camera } from "./space.js";

export type Stage = "light" | "dark";

/** where a component sits in the shot's layout: a stage rect it fits into (centred, aspect kept) and its depth among components */
export interface Place { x: number; y: number; w: number; h: number; z?: number }

/** Options every component takes. Colours are CSS hex; fonts are shipped stems ("Inter-Bold"), named in the call so the runtime loads them. */
export interface CommonOpts {
  /** the brand colour (the site's accent); everything else is derived from it and the stage */
  brand?: string;
  /** the stage the component sits on; "dark" by default */
  stage?: Stage;
  /** override the derived ink (text) colour */
  ink?: string;
  /** override the derived stage background (only drawn when `background: true`) */
  bg?: string;
  /** draw the stage background behind the component (default false: transparent over the shot's own stage) */
  background?: boolean;
  /** display (headline) font stem, default "Inter-Bold" */
  display?: string;
  /** body / UI font stem, default "Inter-Regular" */
  body?: string;
  /** ms into the shot when the component starts (default 300: something is readable at +0.3 s) */
  start_ms?: number;
  /** the component's place in the shot's layout (default: the whole stage); z orders components front to back */
  place?: Place;
  /** retune any of the component's named moves: {"roll": "out-expo", "tag.scale": [0.3, 1.4, 0.5, 1]} (see the catalogue's moves) */
  ease?: Record<string, Ease>;
  /** components built on the spatial layer: a camera (focal, pan x/y, push z; numbers or keyframes) for real parallax */
  camera?: Camera;
}

export interface Theme {
  stage: Stage;
  brand: string;
  /** the brand pushed to >= 3:1 against the stage, for marks and type */
  accent: string;
  /** text on a brand fill */
  brandInk: string;
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  line: string;
  shadow: string;
  display: string;
  body: string;
}

export interface Component {
  readonly el: HTMLElement;
  /** the natural length in ms (start + motion + a held end) */
  readonly duration_ms: number;
  seek(ms: number): void;
}

// ---------- numbers

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
/** progress of t through [a, b], clamped */
export const seg = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
/** log-space lerp: the right one for scale and zoom */
export const zlerp = (a: number, b: number, p: number): number => a * Math.pow(b / a, p);

export const ease = {
  linear: (p: number) => p,
  sineInOut: (p: number) => -(Math.cos(Math.PI * p) - 1) / 2,
  power2Out: (p: number) => 1 - (1 - p) * (1 - p),
  power3Out: (p: number) => 1 - Math.pow(1 - p, 3),
  power4Out: (p: number) => 1 - Math.pow(1 - p, 4),
  power2In: (p: number) => p * p,
  power3In: (p: number) => p * p * p,
  expoOut: (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  expoIn: (p: number) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
  expoInOut: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
  backOut: (p: number, s = 1.4) => { const q = p - 1; return 1 + (s + 1) * q * q * q + s * q * q; },
  /** the house curve for UI: a fast start and a long settle (cubic-bezier(0.22, 1, 0.36, 1) closely) */
  quintOut: (p: number) => 1 - Math.pow(1 - p, 5),
};

/**
 * SwiftUI-style spring step response at t seconds: bounce 0 = critically damped (UI), 0.15 snappy, never above 0.3.
 * Settles in about `duration` seconds.
 */
export function spring(t_s: number, duration = 0.5, bounce = 0): number {
  if (t_s <= 0) return 0;
  const w = (2 * Math.PI) / duration, z = 1 - bounce;
  if (Math.abs(z - 1) < 1e-4) return 1 - Math.exp(-w * t_s) * (1 + w * t_s);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t_s) * (Math.cos(wd * t_s) + ((z * w) / wd) * Math.sin(wd * t_s));
}

/** spring progress of a move that starts at `at` ms, evaluated at `ms` */
export const springAt = (ms: number, at: number, duration = 0.5, bounce = 0): number => spring((ms - at) / 1000, duration, bounce);

/** 32-bit string hash (FNV-1a) */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** a seeded generator in 0..1 (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- colour

export type RGB = [number, number, number];

export function hexRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [107, 91, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbHex = (c: RGB): string => "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
/** sRGB mix of a toward b by p */
export const mix = (a: string, b: string, p: number): string => { const x = hexRgb(a), y = hexRgb(b); return rgbHex([lerp(x[0], y[0], p), lerp(x[1], y[1], p), lerp(x[2], y[2], p)]); };
export const rgba = (hex: string, a: number): string => { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(4)})`; };
function lum(hex: string): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const c = hexRgb(hex);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
export const contrast = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export const DEFAULT_BRAND = "#6B5BFF";

/** The palette a component draws with: the brand, pushed to 3:1 on the stage, and stage tones tinted 4-6 % toward it. */
export function theme(o: CommonOpts = {}): Theme {
  const stage: Stage = o.stage === "light" ? "light" : "dark";
  const brand = /^#?[0-9a-f]{3,6}$/i.test(o.brand ?? "") ? (o.brand!.startsWith("#") ? o.brand! : "#" + o.brand) : DEFAULT_BRAND;
  const base = stage === "dark" ? "#0B0D12" : "#F6F5F2";
  const bg = o.bg ?? mix(base, brand, stage === "dark" ? 0.06 : 0.035);
  let accent = brand;
  const toward = stage === "dark" ? "#FFFFFF" : "#000000";
  for (let i = 0; i < 10 && contrast(accent, bg) < 3; i++) accent = mix(accent, toward, 0.12);
  const ink = o.ink ?? (stage === "dark" ? "#F4F6FA" : "#111318");
  return {
    stage, brand, accent,
    brandInk: contrast("#FFFFFF", brand) >= contrast("#111318", brand) ? "#FFFFFF" : "#111318",
    bg,
    surface: stage === "dark" ? mix(bg, "#FFFFFF", 0.07) : "#FFFFFF",
    surface2: stage === "dark" ? mix(bg, "#FFFFFF", 0.12) : mix(bg, "#000000", 0.04),
    ink,
    muted: mix(ink, bg, 0.42),
    line: mix(ink, bg, stage === "dark" ? 0.84 : 0.88),
    shadow: stage === "dark" ? "0 30px 80px rgba(0,0,0,0.45), 0 2px 0 rgba(255,255,255,0.04) inset" : "0 30px 70px rgba(20,24,40,0.14), 0 2px 6px rgba(20,24,40,0.06)",
    display: o.display ?? "Inter-Bold",
    body: o.body ?? "Inter-Regular",
  };
}

export const ff = (stem: string): string => `"${stem}", "Inter-Regular", "NotoSansSC-Regular", system-ui, sans-serif`;

// ---------- DOM

export type Style = Partial<Record<string, string | number>>;

/** create an element with inline styles and children */
export function h(tag: string, style: Style = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  css(el, style);
  for (const k of kids) if (k) el.append(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}

const UNITLESS = new Set(["opacity", "zIndex", "z-index", "fontWeight", "font-weight", "lineHeight", "line-height", "flex", "flexGrow", "order"]);
const cache = new WeakMap<HTMLElement | SVGElement, Map<string, string>>();
/** set inline styles; numbers get px (except unitless props); a value is written only when it changed (seek is called every frame) */
export function css(el: HTMLElement | SVGElement, style: Style): void {
  let m = cache.get(el);
  if (!m) { m = new Map(); cache.set(el, m); }
  for (const k in style) {
    const raw = style[k];
    if (raw === undefined) continue;
    const v = typeof raw === "number" && !UNITLESS.has(k) ? `${+raw.toFixed(3)}px` : String(raw);
    if (m.get(k) === v) continue;
    m.set(k, v);
    if (k.startsWith("--") || k.includes("-")) el.style.setProperty(k, v);
    else (el.style as unknown as Record<string, string>)[k] = v;
  }
}

export const SVGNS = "http://www.w3.org/2000/svg";
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | null)[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  for (const k of kids) if (k) el.append(k);
  return el;
}
export const attr = (el: Element, attrs: Record<string, string | number>): void => { for (const k in attrs) { const v = String(attrs[k]); if (el.getAttribute(k) !== v) el.setAttribute(k, v); } };

/** the component root: fills the host (the stage) */
export function root(host: HTMLElement, th: Theme, o: CommonOpts, cls: string): HTMLElement {
  const el = h("div", { position: "absolute", inset: "0", overflow: "hidden", fontFamily: ff(th.body), color: th.ink, background: o.background ? th.bg : "transparent", pointerEvents: "none" });
  el.className = `mv-root mv-${cls}`;
  if (o.place) {
    // fit the 1920x1080 composition into the place rect (centred, aspect kept): the component keeps its own layout inside
    const p = o.place, k = Math.min(p.w / 1920, p.h / 1080);
    css(el, { transformOrigin: "0 0", transform: `translate(${(p.x + (p.w - 1920 * k) / 2).toFixed(2)}px, ${(p.y + (p.h - 1080 * k) / 2).toFixed(2)}px) scale(${k.toFixed(5)})`, overflow: "visible" });
  }
  if (o.place?.z != null) css(el, { zIndex: String(Math.round(o.place.z)) });
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.append(el);
  return el;
}

/** a one-time layout step run on the first seek (after fonts are loaded) */
export function lazy(fn: () => void): () => void {
  let done = false;
  return () => { if (!done) { done = true; fn(); } };
}

/** split text into words, keeping CJK characters as single units (a CJK run has no spaces to split on) */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (/[　-鿿＀-￯]/.test(w) && w.length > 4) {
      // keep CJK in 2-character chunks (closer to how it is read aloud than single characters)
      const chars = Array.from(w);
      for (let i = 0; i < chars.length; i += 2) out.push(chars.slice(i, i + 2).join(""));
    } else out.push(w);
  }
  return out;
}
export const isCjk = (text: string): boolean => /[　-鿿]/.test(text);

/** the type scale of the look sheets (px at 1920x1080) */
export const TYPE_SCALE = { super: 144, chapter: 64, ui: 40, body: 28, label: 22 } as const;
export type ScaleName = keyof typeof TYPE_SCALE;
export const sizeOf = (s: ScaleName | number | undefined, d: ScaleName): number => (typeof s === "number" ? s : TYPE_SCALE[s ?? d] ?? TYPE_SCALE[d]);

/** caret blink: solid while typing (within 450 ms of the last key), else a 530 ms square wave */
export const caretOn = (ms: number, lastKey: number): boolean => ms - lastKey < 450 || Math.floor((ms - lastKey - 450) / 530) % 2 === 1;
