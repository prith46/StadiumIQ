import type { DensityFrame, Edge } from '../types';

// M23: no exported hotspot-threshold constant exists elsewhere in the codebase
// to reuse (Dashboard.tsx only mentions "0.75" in a UI copy string) — this is
// the resolved fallback, matching that documented value.
export const HOTSPOT_THRESHOLD = 0.75;

// Number of frames a downstream zone's threshold crossing may lag behind its
// trigger's crossing and still be considered part of the same cascade.
export const CASCADE_LOOKBACK_FRAMES = 5;

export interface CascadeLink {
  zoneId: string;
  predictedCrossingSec: number;
  triggerZoneId: string | null;
}

export interface Cascade {
  chain: CascadeLink[];
}

/**
 * zoneId -> ids of zones with an edge pointing into it (candidate triggers).
 * Shared by `predictCascades` (forward) and M25's `traceRootCause` (backward)
 * — the adjacency direction is identical in both, only the traversal order
 * differs, so this is extracted rather than duplicated.
 */
export function buildIncomingMap(edges: Edge[]): Map<string, string[]> {
  const incomingMap = new Map<string, string[]>();
  for (const edge of edges) {
    let list = incomingMap.get(edge.to);
    if (!list) {
      list = [];
      incomingMap.set(edge.to, list);
    }
    list.push(edge.from);
  }
  return incomingMap;
}

export interface FirstCrossings {
  frameIdx: Map<string, number>;
  sec: Map<string, number>;
}

/**
 * First frame (index + atSec) at which each zone's density crosses
 * `threshold`, scanning `frames` in chronological order. Shared by
 * `predictCascades` and `traceRootCause` for the same reason as
 * `buildIncomingMap` above.
 */
export function computeFirstCrossings(frames: DensityFrame[], threshold: number): FirstCrossings {
  const frameIdx = new Map<string, number>();
  const sec = new Map<string, number>();

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    for (const [zoneId, density] of Object.entries(frame.density)) {
      if (density < threshold) continue;
      if (frameIdx.has(zoneId)) continue; // only the first crossing counts
      frameIdx.set(zoneId, i);
      sec.set(zoneId, frame.atSec);
    }
  }

  return { frameIdx, sec };
}

/**
 * Pure, synchronous cascade detection over a precomputed forecast timeline.
 * Adjacency-only causation: a zone is linked as an "effect" of the nearest
 * (most recent) already-crossed adjacent zone within CASCADE_LOOKBACK_FRAMES,
 * no full flow-network analysis.
 */
export function predictCascades(
  frames: DensityFrame[],
  edges: Edge[],
  threshold: number = HOTSPOT_THRESHOLD
): Cascade[] {
  if (frames.length === 0) return [];

  const incomingMap = buildIncomingMap(edges);
  const { frameIdx: firstCrossingFrameIdx, sec: firstCrossingSec } = computeFirstCrossings(frames, threshold);
  const triggerOf = new Map<string, string>(); // effect zoneId -> trigger zoneId

  for (const [zoneId, i] of firstCrossingFrameIdx.entries()) {
    const incoming = incomingMap.get(zoneId) ?? [];
    let bestTrigger: string | null = null;
    let bestTriggerFrameIdx = -1;
    for (const neighborId of incoming) {
      const neighborFrameIdx = firstCrossingFrameIdx.get(neighborId);
      if (neighborFrameIdx === undefined) continue;
      if (neighborFrameIdx >= i) continue;
      if (i - neighborFrameIdx > CASCADE_LOOKBACK_FRAMES) continue;
      if (neighborFrameIdx > bestTriggerFrameIdx) {
        bestTriggerFrameIdx = neighborFrameIdx;
        bestTrigger = neighborId;
      }
    }
    if (bestTrigger) {
      triggerOf.set(zoneId, bestTrigger);
    }
  }

  const effectsOf = new Map<string, string[]>();
  for (const [effect, trigger] of triggerOf.entries()) {
    let list = effectsOf.get(trigger);
    if (!list) {
      list = [];
      effectsOf.set(trigger, list);
    }
    list.push(effect);
  }

  const roots = Array.from(firstCrossingFrameIdx.keys()).filter((zoneId) => !triggerOf.has(zoneId));

  const cascades: Cascade[] = [];
  for (const root of roots) {
    const chain: CascadeLink[] = [
      { zoneId: root, predictedCrossingSec: firstCrossingSec.get(root)!, triggerZoneId: null },
    ];
    const visited = new Set<string>([root]);
    let current = root;

    while (true) {
      const children = (effectsOf.get(current) ?? []).filter((c) => !visited.has(c));
      if (children.length === 0) break;
      children.sort((a, b) => firstCrossingSec.get(a)! - firstCrossingSec.get(b)!);
      const next = children[0];
      chain.push({ zoneId: next, predictedCrossingSec: firstCrossingSec.get(next)!, triggerZoneId: current });
      visited.add(next);
      current = next;
    }

    if (chain.length >= 2) cascades.push({ chain });
  }

  return cascades;
}
