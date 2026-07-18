import { describe, it, expect } from 'vitest';
import { traceRootCause } from './rootCause';
import type { DensityFrame, Edge, Incident } from '../types';

function makeEdge(from: string, to: string): Edge {
  return { from, to, baseWalkSec: 10, accessible: true, enclosed: false, noise: 'low' };
}

function frame(atSec: number, density: Record<string, number>, gateStatus: DensityFrame['gateStatus'] = {}): DensityFrame {
  return { atSec, density, gateStatus };
}

describe('traceRootCause', () => {
  it('identifies a gate closure as the root cause with correct timing', () => {
    const edges = [makeEdge('gate-a', 'sec-101')];
    const history: DensityFrame[] = [
      frame(0, { 'sec-101': 0.3 }, { 'gate-a': 'open' }),
      frame(180, { 'sec-101': 0.5 }, { 'gate-a': 'closed' }),
      frame(360, { 'sec-101': 0.8 }, { 'gate-a': 'closed' }),
    ];
    const gateStatus = { 'gate-a': 'closed' };

    const result = traceRootCause('sec-101', history, gateStatus, [], edges);

    expect(result.symptomZoneId).toBe('sec-101');
    expect(result.chain).toHaveLength(1);
    expect(result.chain[0]).toMatchObject({
      kind: 'gate_status',
      zoneOrGateId: 'gate-a',
      secondsAgo: 180,
    });
  });

  it('identifies an incident as the root cause', () => {
    const history: DensityFrame[] = [
      frame(0, { 'sec-205': 0.4 }),
      frame(400, { 'sec-205': 0.9 }),
    ];
    const incidents: Incident[] = [
      { id: 'inc1', type: 'medical', zoneId: 'sec-205', note: 'reported', status: 'pending', createdAt: 100 },
    ];

    const result = traceRootCause('sec-205', history, {}, incidents, []);

    expect(result.chain).toHaveLength(1);
    expect(result.chain[0]).toMatchObject({
      kind: 'incident',
      zoneOrGateId: 'sec-205',
      secondsAgo: 300,
    });
  });

  it('returns a length-1 "no clear trigger" chain rather than a fabricated cause', () => {
    const history: DensityFrame[] = [
      frame(0, { 'sec-300': 0.4 }),
      frame(300, { 'sec-300': 0.8 }),
    ];

    const result = traceRootCause('sec-300', history, {}, [], []);

    expect(result.chain).toHaveLength(1);
    expect(result.chain[0].kind).toBe('none');
    expect(result.chain[0].label.toLowerCase()).toContain('no clear');
  });

  it('traces a multi-hop chain (adjacent zone -> adjacent zone -> symptom) in root-to-symptom order', () => {
    const edges = [makeEdge('sec-A', 'sec-B'), makeEdge('sec-B', 'sec-C')];
    const history: DensityFrame[] = [
      frame(0, { 'sec-A': 0.8, 'sec-B': 0.3, 'sec-C': 0.2 }),
      frame(60, { 'sec-A': 0.8, 'sec-B': 0.8, 'sec-C': 0.4 }),
      frame(120, { 'sec-A': 0.8, 'sec-B': 0.8, 'sec-C': 0.8 }),
    ];

    const result = traceRootCause('sec-C', history, {}, [], edges);

    expect(result.chain).toHaveLength(2);
    expect(result.chain[0]).toMatchObject({ kind: 'adjacent_zone', zoneOrGateId: 'sec-A', secondsAgo: 120 });
    expect(result.chain[1]).toMatchObject({ kind: 'adjacent_zone', zoneOrGateId: 'sec-B', secondsAgo: 60 });
  });
});
