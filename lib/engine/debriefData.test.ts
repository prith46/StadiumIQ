import { describe, it, expect } from 'vitest';
import { aggregateDebriefData } from './debriefData';
import type { SimState, Incident } from '../types';

function baseState(overrides: Partial<SimState> = {}): SimState {
  return {
    matchClockSec: 6300,
    density: {},
    gateStatus: {},
    incidents: [],
    routedLoad: {},
    sensorCounts: {},
    timeline: [],
    ...overrides,
  };
}

describe('aggregateDebriefData', () => {
  it('identifies the top 3 bottlenecks by peak density', () => {
    const state = baseState({
      timeline: [
        { atSec: 0, density: { a: 0.4, b: 0.9, c: 0.2, d: 0.85, e: 0.1 }, gateStatus: {} },
        { atSec: 60, density: { a: 0.95, b: 0.5, c: 0.3, d: 0.6, e: 0.7 }, gateStatus: {} },
      ],
    });

    const result = aggregateDebriefData(state, []);

    expect(result.topBottlenecks).toHaveLength(3);
    expect(result.topBottlenecks.map((b) => b.zoneId)).toEqual(['a', 'b', 'd']);
    expect(result.topBottlenecks[0].peakDensity).toBeCloseTo(0.95, 5);
  });

  it('computes response-time deltas for resolved incidents using the recorded etaSec', () => {
    const incidents: Incident[] = [
      { id: 'inc1', type: 'medical', zoneId: 'sec-101', note: '', status: 'resolved', createdAt: 0, etaSec: 180 },
      { id: 'inc2', type: 'security', zoneId: 'sec-102', note: '', status: 'pending', createdAt: 0, etaSec: 90 },
    ];
    const state = baseState({ incidents });

    const result = aggregateDebriefData(state, []);

    expect(result.incidentStats).toHaveLength(1);
    expect(result.incidentStats[0]).toMatchObject({ id: 'inc1', responseSec: 180 });
  });

  it('correctly flags breached incidents', () => {
    const incidents: Incident[] = [
      { id: 'inc1', type: 'medical', zoneId: 'sec-101', note: '', status: 'resolved', createdAt: 0, etaSec: 400 },
      { id: 'inc2', type: 'assistance', zoneId: 'sec-103', note: '', status: 'resolved', createdAt: 0, etaSec: 100 },
    ];
    const state = baseState({ incidents });

    const result = aggregateDebriefData(state, []);

    const breachedInc = result.incidentStats.find((i) => i.id === 'inc1');
    const okInc = result.incidentStats.find((i) => i.id === 'inc2');

    expect(breachedInc?.breached).toBe(true);
    expect(okInc?.breached).toBe(false);
  });
});
