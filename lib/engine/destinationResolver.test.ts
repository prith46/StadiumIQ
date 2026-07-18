/**
 * lib/engine/destinationResolver.test.ts
 *
 * Pure unit tests for the destination resolver (M3).
 */

import { describe, it, expect } from 'vitest';
import { resolveDestination } from './destinationResolver';
import { Edge, Zone, Poi, PoiType } from '../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeZone(id: string, type: Zone['type'] = 'section'): Zone {
  return { id, label: id, type, attrs: { accessible: true, enclosed: false, noise: 'low' } };
}

function makeEdge(from: string, to: string, baseWalkSec = 30): Edge {
  return { from, to, baseWalkSec, accessible: true, enclosed: false, noise: 'low' };
}

function makePoi(
  id: string,
  type: PoiType,
  nearestZone: string,
  status: Poi['status'] = 'open'
): Poi {
  return { id, type, label: id, nearestZone, angle: 0, r: 0, status };
}

// ---------------------------------------------------------------------------
// Fixture graph (5 zones):
//
//   origin --30s--> near-zone --30s--> far-zone
//                    |
//                   gate1 (open)
//
//   origin --90s--> gate2 (congested)
//
// POIs:
//   close-poi  @ near-zone (open, restroom)
//   far-poi    @ far-zone  (open, restroom)
//   closed-poi @ near-zone (closed, restroom)  -- closer but closed
// ---------------------------------------------------------------------------

const FX_ZONES: Zone[] = [
  makeZone('origin'),
  makeZone('near-zone'),
  makeZone('far-zone'),
  makeZone('gate1', 'gate'),
  makeZone('gate2', 'gate'),
];

const FX_EDGES: Edge[] = [
  makeEdge('origin', 'near-zone', 30),
  makeEdge('near-zone', 'origin', 30),
  makeEdge('near-zone', 'far-zone', 30),
  makeEdge('far-zone', 'near-zone', 30),
  makeEdge('near-zone', 'gate1', 30),
  makeEdge('gate1', 'near-zone', 30),
  makeEdge('origin', 'gate2', 90),
  makeEdge('gate2', 'origin', 90),
];

const FX_POIS: Poi[] = [
  makePoi('close-poi', 'restroom', 'near-zone', 'open'),
  makePoi('far-poi', 'restroom', 'far-zone', 'open'),
  makePoi('closed-at-near', 'restroom', 'near-zone', 'closed'),
];

const FX_GATE_STATUS: Record<string, 'open' | 'congested' | 'closed'> = {
  gate1: 'open',
  gate2: 'congested',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveDestination — kind: zone', () => {
  it('returns the zone id directly when it exists', () => {
    const result = resolveDestination(
      { kind: 'zone', zoneId: 'near-zone' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS
    );
    expect(result).toBe('near-zone');
  });

  it('returns unknown_zone error for non-existent zone id', () => {
    const result = resolveDestination(
      { kind: 'zone', zoneId: 'hallucinated-zone-999' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS
    );
    expect(result).toEqual({ error: 'unknown_zone' });
  });
});

describe('resolveDestination — kind: poiType', () => {
  it('returns the nearest open POI zone by graph distance', () => {
    const result = resolveDestination(
      { kind: 'poiType', poiType: 'restroom' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS,
      {}, FX_GATE_STATUS
    );
    // near-zone is 30s away; far-zone is 60s away → should pick near-zone
    expect(result).toBe('near-zone');
  });

  it('skips closed POIs even if they are geometrically closest', () => {
    // Add a closed poi that is at origin itself (distance 0) — it must be skipped
    const poisWithClosedAtOrigin: Poi[] = [
      makePoi('very-close-closed', 'restroom', 'origin', 'closed'),
      ...FX_POIS,
    ];

    const result = resolveDestination(
      { kind: 'poiType', poiType: 'restroom' },
      'origin',
      FX_EDGES, FX_ZONES, poisWithClosedAtOrigin,
      {}, FX_GATE_STATUS
    );
    // closed-at-origin skipped → nearest open is near-zone
    expect(result).toBe('near-zone');
  });

  it('respects poiStatus overrides (runtime close)', () => {
    // Provide a runtime poiStatus that closes close-poi → should fall through to far-poi
    const result = resolveDestination(
      { kind: 'poiType', poiType: 'restroom' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS,
      { 'close-poi': 'closed' },  // runtime override
      FX_GATE_STATUS
    );
    expect(result).toBe('far-zone');
  });

  it('returns no_matching_poi when no open POIs of type exist', () => {
    const result = resolveDestination(
      { kind: 'poiType', poiType: 'atm' }, // no ATMs in fixture
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS
    );
    expect(result).toEqual({ error: 'no_matching_poi' });
  });

  it('returns no_matching_poi when all matching POIs are closed', () => {
    const allClosedPois: Poi[] = [
      makePoi('p1', 'restroom', 'near-zone', 'closed'),
      makePoi('p2', 'restroom', 'far-zone', 'closed'),
    ];
    const result = resolveDestination(
      { kind: 'poiType', poiType: 'restroom' },
      'origin',
      FX_EDGES, FX_ZONES, allClosedPois
    );
    expect(result).toEqual({ error: 'no_matching_poi' });
  });
});

describe('resolveDestination — kind: nearestExit', () => {
  it('returns the nearest open gate', () => {
    const result = resolveDestination(
      { kind: 'nearestExit' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS,
      {}, FX_GATE_STATUS
    );
    // gate1 is 60s away (origin→near-zone→gate1) and 'open'
    // gate2 is 90s away and 'congested'
    // Should prefer open gate1
    expect(result).toBe('gate1');
  });

  it('falls back to congested gate when no open gates exist', () => {
    const allCongestedStatus: Record<string, 'open' | 'congested' | 'closed'> = {
      gate1: 'congested',
      gate2: 'congested',
    };
    const result = resolveDestination(
      { kind: 'nearestExit' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS,
      {}, allCongestedStatus
    );
    // Should still return a gate (nearest congested)
    expect(typeof result).toBe('string');
    expect((result as string).startsWith('gate')).toBe(true);
  });

  it('returns no_open_exit when all gates are closed', () => {
    const allClosedGates: Record<string, 'open' | 'congested' | 'closed'> = {
      gate1: 'closed',
      gate2: 'closed',
    };
    const result = resolveDestination(
      { kind: 'nearestExit' },
      'origin',
      FX_EDGES, FX_ZONES, FX_POIS,
      {}, allClosedGates
    );
    expect(result).toEqual({ error: 'no_open_exit' });
  });

  it('prefers open gate over congested gate even when congested is geometrically closer', () => {
    /**
     * Fixture where:
     *   origin --10s--> gate2 (congested)
     *   origin --20s--> gate1 (open)
     *
     * nearestExit should pick gate1 (open) over gate2 (congested, closer in distance).
     */
    const twoGateEdges: Edge[] = [
      makeEdge('origin', 'gate2', 10),
      makeEdge('gate2', 'origin', 10),
      makeEdge('origin', 'gate1', 20),
      makeEdge('gate1', 'origin', 20),
    ];
    const twoGateStatus: Record<string, 'open' | 'congested' | 'closed'> = {
      gate1: 'open',
      gate2: 'congested',
    };

    const result = resolveDestination(
      { kind: 'nearestExit' },
      'origin',
      twoGateEdges,
      FX_ZONES,
      FX_POIS,
      {}, twoGateStatus
    );
    expect(result).toBe('gate1');
  });
});
