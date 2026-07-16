import { describe, it, expect } from 'vitest';
import { recommendPrepositioning } from './staffPrepositioning';
import { computeRoute } from './routing';
import { EDGES, ZONES } from '../venue/venue';
import type { Responder } from '../types';

describe('recommendPrepositioning', () => {
  it('recommends the nearest available idle responder', () => {
    const hotspotZoneId = 'gate-b';
    const responders: Responder[] = [
      { id: 'resp-a', label: 'Team A', zoneId: 'sec-101', skills: ['medical'], available: true },
      { id: 'resp-b', label: 'Team B', zoneId: 'sec-218', skills: ['medical'], available: true },
    ];

    const routeA = computeRoute('sec-101', hotspotZoneId, EDGES, ZONES, {}, {}, {});
    const routeB = computeRoute('sec-218', hotspotZoneId, EDGES, ZONES, {}, {}, {});
    const etaA = 'error' in routeA ? Infinity : routeA.etaSec;
    const etaB = 'error' in routeB ? Infinity : routeB.etaSec;
    const expectedNearest = etaA <= etaB ? 'resp-a' : 'resp-b';

    const result = recommendPrepositioning(
      { zoneId: hotspotZoneId, predictedCrossingSec: 900 },
      responders,
      EDGES
    );

    expect(result).toHaveLength(1);
    expect(result[0].responderId).toBe(expectedNearest);
    expect(result[0].toZone).toBe(hotspotZoneId);
    expect(result[0].willArriveInTime).toBe(true);
  });

  it('excludes a responder already committed to a pending incident from candidates', () => {
    const hotspotZoneId = 'gate-b';
    // The committed responder ('resp-a', nearer to the hotspot) has already
    // been filtered out of the candidate list by the caller (route.ts marks
    // responders assigned to pending/dispatched incidents unavailable) —
    // only the farther, still-idle responder is passed in.
    const responders: Responder[] = [
      { id: 'resp-b', label: 'Team B', zoneId: 'sec-218', skills: ['medical'], available: true },
    ];

    const result = recommendPrepositioning(
      { zoneId: hotspotZoneId, predictedCrossingSec: 900 },
      responders,
      EDGES
    );

    expect(result).toHaveLength(1);
    expect(result[0].responderId).toBe('resp-b');
  });

  it('flags willArriveInTime: false rather than omitting when unreachable', () => {
    const responders: Responder[] = [
      { id: 'resp-a', label: 'Team A', zoneId: 'sec-101', skills: ['medical'], available: true },
    ];

    // No edges at all — the responder's zone has no path to the hotspot zone.
    const result = recommendPrepositioning(
      { zoneId: 'gate-b', predictedCrossingSec: 900 },
      responders,
      []
    );

    expect(result).toHaveLength(1);
    expect(result[0].responderId).toBe('resp-a');
    expect(result[0].willArriveInTime).toBe(false);
  });
});
