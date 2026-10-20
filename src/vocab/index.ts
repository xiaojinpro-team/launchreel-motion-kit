/**
 * The motion vocabulary (xjp.motion-vocab.v1): finished, seekable motion components for launch films.
 * In a free-film shot: <script src="/vendor/motion-vocab.js"></script> gives the global MV; MV.bind("s3", MV.title(el, {...})) registers
 * the shot's frame hook. The catalogue (catalogue.ts) says which component fits which scene.
 */
import type { Component } from "./core.js";

export const VOCAB_VERSION = "1.0.0";

/** register the shot's frame hook: every component is seeked to the ms since the shot began; an existing hook still runs after them */
export function bind(shot: string, ...comps: Component[]): void {
  const w = window as unknown as { __shotFrames?: Record<string, (f: { shot_t: number }) => unknown> };
  const frames = (w.__shotFrames ||= {});
  const prev = frames[shot];
  frames[shot] = (f) => { for (const c of comps) c.seek(f.shot_t); return prev ? prev(f) : undefined; };
}

export { theme, mix, rgba, ease, spring, seg, clamp, lerp, zlerp, TYPE_SCALE, type CommonOpts, type Component, type Theme, type Stage, type Place } from "./core.js";
// engine foundations (owner 10-19): per-property easing down to bezier handles, a spatial layout layer, glow that respects depth, a
// transform tree with detach and camera parallax
export { EASES, curve, along, prog, tracks, motions, fitEase, cssEase, easeSpec, easeIssue, type Ease, type EasePreset, type Bezier, type Key, type Tracks, type MotionTable, type FitEaseResult } from "./easing.js";
export { layout, space, scene, objNode, placeNodes, glow, membrane, litSurface, slamKeys, type SpaceSpec, type Obj, type Group, type Light, type Camera, type Slot, type World, type Screen, type Space, type Scene, type ObjNode, type Glow } from "./space.js";
export { typeInput, typingEvents, TYPE_INPUT_MOTIONS, type TypeInputOpts, type TypeInputVariant } from "./type-input.js";
export { title, TITLE_MOTIONS, type TitleOpts, type TitleVariant } from "./title.js";
export { captions, timedWords, CAPTION_MOTIONS, balance, type CaptionOpts, type CaptionLine, type CaptionVariant } from "./captions.js";
export { logo, endCard, defaultMark, LOGO_MOTIONS, type LogoOpts, type EndCardOpts, type LogoVariant } from "./logo.js";
export { transition, transitionSpan, TRANSITION_MOTIONS, type TransitionOpts, type TransitionVariant } from "./transition.js";
export { device, scrollAt, DEVICE_MOTIONS, type DeviceOpts, type DeviceVariant } from "./device.js";
// batch 2 (from the 人造太阳 experiment's scene motion): data reveals, timelines, energy builds, diagram builds
export { DATA_MOTIONS } from "./data.js";
export { TIMELINE_MOTIONS } from "./timeline.js";
export { ENERGY_MOTIONS } from "./energy.js";
export { DIAGRAM_MOTIONS } from "./diagram.js";
export { data, type DataOpts, type DataVariant, type DataItem, type GaugeItem, type CurveSeries, type PictoIcon } from "./data.js";
export { timeline, type TimelineOpts, type TimelineVariant, type Step, type Milestone } from "./timeline.js";
export { energy, type EnergyOpts, type EnergyVariant, type FlowNode } from "./energy.js";
export { diagram, type DiagramOpts, type DiagramVariant, type CalloutPoint, type CheckItem } from "./diagram.js";
