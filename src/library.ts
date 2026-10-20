/** xjp.ease-library.v1 — a growing shelf of measured curves and the easing that reproduces them. Pure (no fs). */
import { easeProblems, type EaseSpec, type Seg, type Space } from "./ease.js";
import type { Point } from "./fit.js";

export const EASE_LIBRARY_SCHEMA = "xjp.ease-library.v1";
export interface EaseEntry {
  id: string;
  name: string;
  space: Space;
  /** The measured samples of this move, frame relative to the move's start (0..duration), in value space. */
  frames: Point[];
  ease: EaseSpec;
  source?: { clip?: string; shot?: string; channel?: string };
  note?: string;
  /** Fit residual (share of range) when the entry came from motion-fit. */
  rms?: number;
}
export interface EaseLibrary { schema: typeof EASE_LIBRARY_SCHEMA; entries: EaseEntry[] }

export function libraryProblems(lib: unknown): string[] {
  const p: string[] = [];
  if (!lib || typeof lib !== "object") return ["library must be an object"];
  const l = lib as Record<string, unknown>;
  if (l.schema !== EASE_LIBRARY_SCHEMA) p.push(`schema must be "${EASE_LIBRARY_SCHEMA}"`);
  if (!Array.isArray(l.entries)) return [...p, "entries must be an array"];
  const ids = new Set<string>();
  l.entries.forEach((e: unknown, i) => {
    const w = `entries[${i}]`;
    if (!e || typeof e !== "object") { p.push(`${w} must be an object`); return; }
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) p.push(`${w}.id must be a non-empty string`);
    else if (ids.has(r.id)) p.push(`${w}.id "${r.id}" is duplicated`); else ids.add(r.id);
    if (typeof r.name !== "string" || !r.name) p.push(`${w}.name must be a non-empty string`);
    if (r.space !== "linear" && r.space !== "log") p.push(`${w}.space must be "linear" or "log"`);
    if (!Array.isArray(r.frames) || !r.frames.every((q: unknown) => !!q && typeof (q as Point).f === "number" && typeof (q as Point).value === "number")) p.push(`${w}.frames must be [{f,value}]`);
    for (const m of easeProblems(r.ease)) p.push(`${w}.ease: ${m}`);
  });
  return p;
}

export const emptyLibrary = (): EaseLibrary => ({ schema: EASE_LIBRARY_SCHEMA, entries: [] });
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "curve";

export interface EntryMeta { name: string; id?: string; source?: EaseEntry["source"]; note?: string }

/** One entry per fitted move (hold segments, from = to, are skipped); names get " #k" when there are several moves. */
export function entriesFromFit(points: Point[], segments: Seg[], rmsPerSegment: number[], space: Space, meta: EntryMeta): Omit<EaseEntry, "id">[] {
  const moves = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.from !== s.to);
  return moves.map(({ s, i }, k) => ({
    name: moves.length > 1 ? `${meta.name} #${k + 1}` : meta.name,
    space,
    frames: points.filter((p) => p.f >= s.f0 && p.f <= s.f1).map((p) => ({ f: +(p.f - s.f0).toFixed(6), value: p.value })),
    ease: s.ease,
    ...(meta.source ? { source: meta.source } : {}),
    ...(meta.note ? { note: meta.note } : {}),
    rms: rmsPerSegment[i],
  }));
}

/** Appends entries (ids made unique from `idBase`/name) and returns the new library; the input is not modified. */
export function appendEntries(lib: EaseLibrary | null, entries: Omit<EaseEntry, "id">[], idBase?: string): EaseLibrary {
  const out: EaseLibrary = lib ? JSON.parse(JSON.stringify(lib)) : emptyLibrary();
  const taken = new Set(out.entries.map((e) => e.id));
  for (const e of entries) {
    const base = slug(idBase && entries.length === 1 ? idBase : idBase ? `${idBase}-${entries.indexOf(e) + 1}` : e.name);
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    taken.add(id);
    out.entries.push({ id, ...e });
  }
  return out;
}
