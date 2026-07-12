import type { Edge } from '../types';

// M22: minimum tick-over-tick density increase on the destination zone before
// an edge is considered to be carrying visible crowd flow.
export const FLOW_THRESHOLD = 0.03;

export interface FlowVector {
  edgeId: string;
  from: string;
  to: string;
  magnitude: number; // clamped 0..1
}

/**
 * Pure, synchronous derivation of directional crowd-flow vectors from a
 * tick-over-tick density delta. No store/React imports (lib/engine/* rule).
 */
export function computeFlowVectors(
  currentDensity: Record<string, number>,
  previousDensity: Record<string, number>,
  edges: Edge[]
): FlowVector[] {
  const vectors: FlowVector[] = [];

  for (const edge of edges) {
    const flow = (currentDensity[edge.to] ?? 0) - (previousDensity[edge.to] ?? 0);
    if (flow > FLOW_THRESHOLD) {
      vectors.push({
        edgeId: `${edge.from}->${edge.to}`,
        from: edge.from,
        to: edge.to,
        magnitude: Math.min(1, Math.max(0, flow)),
      });
    }
  }

  return vectors;
}
