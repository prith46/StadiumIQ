import { describe, it, expect } from 'vitest';
import { computeFlowVectors, FLOW_THRESHOLD } from './flowVectors';
import type { Edge } from '../types';

function makeEdge(from: string, to: string): Edge {
  return { from, to, baseWalkSec: 10, accessible: true, enclosed: false, noise: 'low' };
}

describe('computeFlowVectors', () => {
  it('computes a flow vector when density increases on the destination zone', () => {
    const edges = [makeEdge('concourse-a', 'sec-a')];
    const previous = { 'sec-a': 0.2 };
    const current = { 'sec-a': 0.35 };

    const result = computeFlowVectors(current, previous, edges);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ edgeId: 'concourse-a->sec-a', from: 'concourse-a', to: 'sec-a' });
    expect(result[0].magnitude).toBeCloseTo(0.15, 5);
  });

  it('does not generate a vector when flow is at or below the threshold', () => {
    const edges = [makeEdge('concourse-a', 'sec-a')];
    const previous = { 'sec-a': 0.2 };
    const current = { 'sec-a': 0.2 + FLOW_THRESHOLD };

    const result = computeFlowVectors(current, previous, edges);

    expect(result).toHaveLength(0);
  });

  it('clamps magnitude to the 0..1 range', () => {
    const edges = [makeEdge('concourse-a', 'sec-a')];
    const previous = { 'sec-a': 0 };
    const current = { 'sec-a': 1.7 };

    const result = computeFlowVectors(current, previous, edges);

    expect(result[0].magnitude).toBe(1);
  });
});
