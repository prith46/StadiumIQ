import { describe, it, expect } from 'vitest';
import { predictCascades, HOTSPOT_THRESHOLD } from './cascadePrediction';
import type { DensityFrame, Edge } from '../types';

function makeEdge(from: string, to: string): Edge {
  return { from, to, baseWalkSec: 10, accessible: true, enclosed: false, noise: 'low' };
}

function frame(atSec: number, density: Record<string, number>): DensityFrame {
  return { atSec, density, gateStatus: {} };
}

describe('predictCascades', () => {
  it('detects a two-zone cascade in correct order with correct timing', () => {
    const edges = [makeEdge('gate-b', 'concourse-n')];
    const frames: DensityFrame[] = [
      frame(0, { 'gate-b': 0.5, 'concourse-n': 0.4 }),
      frame(60, { 'gate-b': 0.8, 'concourse-n': 0.5 }),
      frame(120, { 'gate-b': 0.85, 'concourse-n': 0.6 }),
      frame(180, { 'gate-b': 0.85, 'concourse-n': 0.78 }),
    ];

    const cascades = predictCascades(frames, edges, HOTSPOT_THRESHOLD);

    expect(cascades).toHaveLength(1);
    expect(cascades[0].chain).toEqual([
      { zoneId: 'gate-b', predictedCrossingSec: 60, triggerZoneId: null },
      { zoneId: 'concourse-n', predictedCrossingSec: 180, triggerZoneId: 'gate-b' },
    ]);
  });

  it('returns no cascade for an isolated single hotspot', () => {
    const edges: Edge[] = [];
    const frames: DensityFrame[] = [
      frame(0, { 'sec-214': 0.4 }),
      frame(60, { 'sec-214': 0.8 }),
    ];

    const cascades = predictCascades(frames, edges, HOTSPOT_THRESHOLD);

    expect(cascades).toHaveLength(0);
  });

  it('does not link zones that are not adjacent', () => {
    const edges: Edge[] = []; // no edge between gate-b and sec-214
    const frames: DensityFrame[] = [
      frame(0, { 'gate-b': 0.5, 'sec-214': 0.4 }),
      frame(60, { 'gate-b': 0.8, 'sec-214': 0.5 }),
      frame(120, { 'gate-b': 0.85, 'sec-214': 0.8 }),
    ];

    const cascades = predictCascades(frames, edges, HOTSPOT_THRESHOLD);

    expect(cascades).toHaveLength(0);
  });
});
