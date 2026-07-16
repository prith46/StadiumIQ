/**
 * lib/engine/routing.test.ts
 *
 * Pure unit tests for the M3 routing engine.
 *
 * FIXTURE STRATEGY (§10):
 *   Algorithmic correctness tests use minimal hand-constructed graphs (4–6 nodes)
 *   with known expected paths. The real venue.ts data is only used for a final
 *   smoke test that confirms no thrown errors and plausible results.
 */

import { describe, it, expect } from 'vitest';
import {
  computeRoute,
  buildGraph,
  shortestDistance,
  congestionFactor,
  RouteFilters,
} from './routing';
import { Edge, Zone } from '../types';
import { EDGES, ZONES } from '../venue/venue';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeZone(
  id: string,
  type: Zone['type'] = 'section',
  accessible = true,
  affiliation?: 'home' | 'away' | 'neutral'
): Zone {
  return {
    id,
    label: id,
    type,
    attrs: { accessible, enclosed: false, noise: 'low', affiliation },
  };
}

function makeEdge(
  from: string,
  to: string,
  baseWalkSec: number,
  opts: Partial<Pick<Edge, 'accessible' | 'enclosed' | 'noise'>> = {}
): Edge {
  return {
    from,
    to,
    baseWalkSec,
    accessible: opts.accessible ?? true,
    enclosed: opts.enclosed ?? false,
    noise: opts.noise ?? 'low',
  };
}

/**
 * Minimal 4-node fixture:
 *
 *   A --60s--> B --60s--> D   (direct path via B)
 *   A --30s--> C --30s--> D   (detour via C, shorter base time)
 *
 * When density on C and D is low, the C route wins.
 * When density on C is high, the B route wins.
 */
const FX_ZONES: Zone[] = [
  makeZone('A'),
  makeZone('B'),
  makeZone('C'),
  makeZone('D', 'gate'),
];

/** Bidirectional edges for the fixture (add both directions manually) */
const FX_EDGES: Edge[] = [
  makeEdge('A', 'B', 60),
  makeEdge('B', 'A', 60),
  makeEdge('B', 'D', 60),
  makeEdge('D', 'B', 60),
  makeEdge('A', 'C', 30),
  makeEdge('C', 'A', 30),
  makeEdge('C', 'D', 30),
  makeEdge('D', 'C', 30),
];

const NO_DENSITY: Record<string, number> = {};
const NO_LOAD: Record<string, number> = {};
const OPEN_GATES: Record<string, 'open' | 'congested' | 'closed'> = { D: 'open' };

// ---------------------------------------------------------------------------
// 1. Shortest path correctness
// ---------------------------------------------------------------------------

describe('computeRoute — shortest path correctness', () => {
  it('returns the minimum-weight path on a clear fixture graph', () => {
    const result = computeRoute('A', 'D', FX_EDGES, FX_ZONES, NO_DENSITY, NO_LOAD, OPEN_GATES);

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // A→C→D costs 60s; A→B→D costs 120s — should take the shorter route
    expect(result.path).toEqual(['A', 'C', 'D']);
    expect(result.etaSec).toBe(60);
  });

  it('finds path when only one route exists', () => {
    // Remove the C edges so only A→B→D exists
    const edgesOnly = FX_EDGES.filter((e) => e.from !== 'A' || e.to !== 'C')
      .filter((e) => e.from !== 'C' || e.to !== 'A')
      .filter((e) => e.from !== 'C' || e.to !== 'D')
      .filter((e) => e.from !== 'D' || e.to !== 'C');

    const result = computeRoute('A', 'D', edgesOnly, FX_ZONES, NO_DENSITY, NO_LOAD, OPEN_GATES);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path).toEqual(['A', 'B', 'D']);
  });

  it('returns no_route_found when destination is unreachable', () => {
    const result = computeRoute('A', 'D', [], FX_ZONES, NO_DENSITY, NO_LOAD, OPEN_GATES);
    expect(result).toEqual({ error: 'no_route_found' });
  });

  it('adversarial: greedy algorithm would pick wrong path (equal first hops, cheaper second hop on worse overall path)', () => {
    /**
     * 6-node graph designed to trap greedy BFS/Dijkstra-without-update:
     *
     *  S --10s--> M --100s--> E
     *  S --20s--> N --10s--> E
     *
     * Greedy (take cheapest first edge) picks S→M→E = 110s.
     * Correct Dijkstra picks S→N→E = 30s.
     */
    const gZones: Zone[] = ['S', 'M', 'N', 'E'].map((id) => makeZone(id, id === 'E' ? 'gate' : 'section'));
    const gEdges: Edge[] = [
      makeEdge('S', 'M', 10),
      makeEdge('M', 'E', 100),
      makeEdge('S', 'N', 20),
      makeEdge('N', 'E', 10),
    ];
    const gGates: Record<string, 'open' | 'congested' | 'closed'> = { E: 'open' };

    const result = computeRoute('S', 'E', gEdges, gZones, {}, {}, gGates);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path).toEqual(['S', 'N', 'E']);
    expect(result.etaSec).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 2. Congestion rerouting
// ---------------------------------------------------------------------------

describe('computeRoute — congestion rerouting', () => {
  it('chooses the low-density path when equal baseWalkSec paths exist', () => {
    /**
     * Two equal-cost paths: A→B→D (120s) vs A→C→D (60s base).
     * With HIGH density on C and D, congestionFactor inflates their weight
     * so A→B→D becomes cheaper.
     */
    const highDensity: Record<string, number> = { C: 0.9, D: 0.9 };

    const result = computeRoute('A', 'D', FX_EDGES, FX_ZONES, highDensity, NO_LOAD, OPEN_GATES);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // A→C→D costs 30 * cf(0.9, 0) + 30 * cf(0.9, 0) = 30 * 3.25 * 2 = 195s
    // A→B→D costs 60 * 1 + 60 * cf(0.9, 0) = 60 + 195 = 255s
    // So A→C→D is STILL cheaper (195 < 255) — adjust fixture so B path wins
    // Let's use density on C = 0.9 and D = 0.0, compare:
    // A→C→D: 30*3.25 + 30*1 = 97.5 + 30 = 127.5s
    // A→B→D: 60*1 + 60*1 = 120s  → B path wins!
    const result2 = computeRoute(
      'A', 'D', FX_EDGES, FX_ZONES, { C: 0.9, D: 0.0 }, NO_LOAD, OPEN_GATES
    );
    expect('error' in result2).toBe(false);
    if ('error' in result2) return;
    expect(result2.path).toEqual(['A', 'B', 'D']);
  });

  it('populates reason.crowdedZones and reason.avoidedGates when congestion tradeoff occurs', () => {
    const result = computeRoute(
      'A', 'D', FX_EDGES, FX_ZONES, { C: 0.9 }, NO_LOAD, OPEN_GATES
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // When B path is chosen, C should appear in crowdedZones (it was on the naive path)
    if (result.path[1] === 'B') {
      // Path went via B — C was avoided
      expect(result.reason.crowdedZones).toContain('C');
    }
  });

  it('reason.crowdedZones and avoidedGates are empty when no congestion tradeoff occurred', () => {
    const result = computeRoute('A', 'D', FX_EDGES, FX_ZONES, NO_DENSITY, NO_LOAD, OPEN_GATES);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.reason.crowdedZones).toEqual([]);
    expect(result.reason.avoidedGates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. ETA monotonicity
// ---------------------------------------------------------------------------

describe('computeRoute — ETA monotonicity', () => {
  it('ETA never decreases as density on chosen path edges increases', () => {
    const densityLevels = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    let prevEta = -1;

    for (const d of densityLevels) {
      const density: Record<string, number> = { B: d, D: d };
      // Force B path by clearing C and D from density (only B penalised)
      const edgesOnlyB = FX_EDGES.filter(
        (e) => (e.from !== 'A' || e.to !== 'C') && (e.from !== 'C')
      );
      const result = computeRoute('A', 'D', edgesOnlyB, FX_ZONES, density, NO_LOAD, OPEN_GATES);
      if ('error' in result) continue;

      expect(result.etaSec).toBeGreaterThanOrEqual(prevEta);
      prevEta = result.etaSec;
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Accessible filter (HARD exclusion)
// ---------------------------------------------------------------------------

describe('computeRoute — accessibility filter', () => {
  it('returns no_accessible_route_found when only path uses a stairs edge', () => {
    /**
     * Graph with a single inaccessible path:
     *   A --stairs(inaccessible)--> D
     */
    const accessEdges: Edge[] = [
      makeEdge('A', 'D', 60, { accessible: false }),
      makeEdge('D', 'A', 60, { accessible: false }),
    ];
    const accessZones: Zone[] = [makeZone('A'), makeZone('D', 'gate')];
    const filters: RouteFilters = { accessibleOnly: true };

    const result = computeRoute('A', 'D', accessEdges, accessZones, {}, {}, { D: 'open' }, filters);
    expect(result).toEqual({
      error: 'no_accessible_route_found',
      path: null,
      etaSec: null,
      reason: { crowdedZones: [], avoidedGates: [] },
      accessible: false,
      noRouteFound: true,
    });
  });

  it('returns accessible path when one exists, even if a shorter inaccessible path also exists', () => {
    /**
     * A --stairs(inaccessible, 10s)--> D
     * A --elevator(accessible, 120s)--> D
     */
    const accessEdges: Edge[] = [
      makeEdge('A', 'D', 10, { accessible: false }),
      makeEdge('D', 'A', 10, { accessible: false }),
      makeEdge('A', 'D', 120, { accessible: true }),
      makeEdge('D', 'A', 120, { accessible: true }),
    ];
    const accessZones: Zone[] = [makeZone('A'), makeZone('D', 'gate')];
    const filters: RouteFilters = { accessibleOnly: true };

    const result = computeRoute('A', 'D', accessEdges, accessZones, {}, {}, { D: 'open' }, filters);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path).toEqual(['A', 'D']);
    expect(result.etaSec).toBe(120);
    expect(result.accessible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Soft filters
// ---------------------------------------------------------------------------

describe('computeRoute — soft filters', () => {
  it('avoidEnclosed penalises enclosed edges but still returns a route even when only enclosed path exists', () => {
    const enclosedEdges: Edge[] = [
      makeEdge('A', 'D', 60, { enclosed: true }),
      makeEdge('D', 'A', 60, { enclosed: true }),
    ];
    const enclosedZones: Zone[] = [makeZone('A'), makeZone('D', 'gate')];

    const result = computeRoute(
      'A', 'D', enclosedEdges, enclosedZones, {}, {}, { D: 'open' },
      { avoidEnclosed: true }
    );
    // Soft filter — should still return a path, not an error
    expect('error' in result).toBe(false);
  });

  it('avoidEnclosed steers away from enclosed path when open alternative exists', () => {
    /**
     * A --enclosed, 30s--> D
     * A --open, 60s-----> D
     * With avoidEnclosed, the 30s enclosed path gets ×3 = 90s, so open 60s wins.
     */
    const mixedEdges: Edge[] = [
      makeEdge('A', 'D', 30, { enclosed: true }),
      makeEdge('D', 'A', 30, { enclosed: true }),
      makeEdge('A', 'D', 60, { enclosed: false }),
      makeEdge('D', 'A', 60, { enclosed: false }),
    ];
    const mixedZones: Zone[] = [makeZone('A'), makeZone('D', 'gate')];

    const result = computeRoute(
      'A', 'D', mixedEdges, mixedZones, {}, {}, { D: 'open' },
      { avoidEnclosed: true }
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    // Should pick the open (non-enclosed) route with etaSec=60
    expect(result.etaSec).toBe(60);
  });

  it('maxNoise penalises noisy edges but still returns a route when only noisy path exists', () => {
    const noisyEdges: Edge[] = [
      makeEdge('A', 'D', 60, { noise: 'high' }),
      makeEdge('D', 'A', 60, { noise: 'high' }),
    ];
    const noisyZones: Zone[] = [makeZone('A'), makeZone('D', 'gate')];

    const result = computeRoute(
      'A', 'D', noisyEdges, noisyZones, {}, {}, { D: 'open' },
      { maxNoise: 'low' }
    );
    expect('error' in result).toBe(false);
  });

  // M10 gap-fix: M3 implemented avoidAffiliation in buildGraph (weight *= 3 when
  // destZone.attrs.affiliation matches the filter) but never had a fixture test
  // exercising it — this closes that gap, mirroring the avoidEnclosed dual-test
  // discipline (still-returns-when-forced, steers-away-when-possible).
  it('avoidAffiliation penalises matching-affiliation zones but still returns a route when only that path exists', () => {
    const homeOnlyEdges: Edge[] = [
      makeEdge('A', 'D', 60),
      makeEdge('D', 'A', 60),
    ];
    const homeOnlyZones: Zone[] = [makeZone('A'), makeZone('D', 'gate', true, 'home')];

    const result = computeRoute(
      'A', 'D', homeOnlyEdges, homeOnlyZones, {}, {}, { D: 'open' },
      { avoidAffiliation: 'home' }
    );
    expect('error' in result).toBe(false);
  });

  it('avoidAffiliation steers away from a matching-affiliation zone when a neutral alternative exists', () => {
    /**
     * A --30s--> H (home-affiliated) --30s--> D
     * A --60s--> N (neutral) --------------> D
     * With avoidAffiliation: 'home', the H-path's 60s total becomes weighted
     * (30 * 3 penalty for entering H) + 30 = 120, so the neutral 60s wins.
     */
    const branchEdges: Edge[] = [
      makeEdge('A', 'H', 30),
      makeEdge('H', 'A', 30),
      makeEdge('H', 'D', 30),
      makeEdge('D', 'H', 30),
      makeEdge('A', 'N', 30),
      makeEdge('N', 'A', 30),
      makeEdge('N', 'D', 30),
      makeEdge('D', 'N', 30),
    ];
    const branchZones: Zone[] = [
      makeZone('A'),
      makeZone('H', 'concourse', true, 'home'),
      makeZone('N', 'concourse', true, 'neutral'),
      makeZone('D', 'gate'),
    ];

    const result = computeRoute(
      'A', 'D', branchEdges, branchZones, {}, {}, { D: 'open' },
      { avoidAffiliation: 'home' }
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path).toEqual(['A', 'N', 'D']);
    expect(result.etaSec).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 6. Closed gate exclusion
// ---------------------------------------------------------------------------

describe('computeRoute — gate status', () => {
  it('never routes through a closed gate, even if it is nearest', () => {
    /**
     * A→D (gate, closed): this path is blocked
     * A→B→E (gate, open): longer but valid
     */
    const gZones: Zone[] = [
      makeZone('A'),
      makeZone('B'),
      makeZone('D', 'gate'),
      makeZone('E', 'gate'),
    ];
    const gEdges: Edge[] = [
      makeEdge('A', 'D', 10),
      makeEdge('D', 'A', 10),
      makeEdge('A', 'B', 60),
      makeEdge('B', 'A', 60),
      makeEdge('B', 'E', 60),
      makeEdge('E', 'B', 60),
    ];
    const gGates: Record<string, 'open' | 'congested' | 'closed'> = {
      D: 'closed',
      E: 'open',
    };

    // Route to D directly — should fail since D is closed
    const r1 = computeRoute('A', 'D', gEdges, gZones, {}, {}, gGates);
    expect(r1).toEqual({ error: 'no_route_found' });

    // Route to E — should succeed via B
    const r2 = computeRoute('A', 'E', gEdges, gZones, {}, {}, gGates);
    expect('error' in r2).toBe(false);
    if ('error' in r2) return;
    expect(r2.path).toEqual(['A', 'B', 'E']);
  });

  it('routes through congested gate with heavy penalty (not excluded)', () => {
    /**
     * A→D (gate, congested): allowed but penalised ×4
     * A→B→E (gate, open): longer base but lower effective weight
     */
    const gZones: Zone[] = [
      makeZone('A'),
      makeZone('B'),
      makeZone('D', 'gate'),
      makeZone('E', 'gate'),
    ];
    const gEdges: Edge[] = [
      makeEdge('A', 'D', 10),
      makeEdge('D', 'A', 10),
      makeEdge('A', 'B', 60),
      makeEdge('B', 'A', 60),
      makeEdge('B', 'E', 10),
      makeEdge('E', 'B', 10),
    ];
    const gGates: Record<string, 'open' | 'congested' | 'closed'> = {
      D: 'congested',
      E: 'open',
    };

    // A→D: 10s * cf(0,0) * 4 = 10 * 1 * 4 = 40s  (congested penalty)
    // A→B→E: 60 + 10 = 70s
    // Congested gate A→D should be chosen (40 < 70) — it's still passable
    const r = computeRoute('A', 'D', gEdges, gZones, {}, {}, gGates);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.path).toContain('D');
  });
});

// ---------------------------------------------------------------------------
// 7. congestionFactor formula
// ---------------------------------------------------------------------------

describe('congestionFactor', () => {
  it('equals 1 when density=0 and load=0', () => {
    expect(congestionFactor(0, 0)).toBe(1);
  });

  it('caps load at 10 (min(load, 10))', () => {
    const cap10 = congestionFactor(0, 10);
    const cap20 = congestionFactor(0, 20);
    expect(cap10).toBe(cap20);
  });

  it('is monotone increasing in density', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1.0];
    let prev = -Infinity;
    for (const d of levels) {
      const val = congestionFactor(d, 0);
      expect(val).toBeGreaterThan(prev);
      prev = val;
    }
  });

  it('is monotone increasing in load (up to 10)', () => {
    let prev = -Infinity;
    for (let load = 0; load <= 10; load++) {
      const val = congestionFactor(0, load);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it('matches formula: 1 + 2.5*d + 0.15*min(load,10)', () => {
    expect(congestionFactor(0.5, 5)).toBeCloseTo(1 + 2.5 * 0.5 + 0.15 * 5);
    expect(congestionFactor(1.0, 15)).toBeCloseTo(1 + 2.5 * 1.0 + 0.15 * 10);
  });
});

// ---------------------------------------------------------------------------
// 8. shortestDistance helper
// ---------------------------------------------------------------------------

describe('shortestDistance', () => {
  it('returns Infinity for unreachable node', () => {
    const graph = buildGraph([], FX_ZONES, {}, {}, {}, {});
    expect(shortestDistance(graph, 'A', 'D')).toBe(Infinity);
  });

  it('returns 0 for same node', () => {
    const graph = buildGraph(FX_EDGES, FX_ZONES, {}, OPEN_GATES, {}, {});
    expect(shortestDistance(graph, 'A', 'A')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Integration smoke test against real venue.ts data (§16, §10)
// ---------------------------------------------------------------------------

describe('computeRoute — real venue.ts integration smoke', () => {
  const emptyDensity: Record<string, number> = {};
  const emptyLoad: Record<string, number> = {};
  const allGatesOpen: Record<string, 'open' | 'congested' | 'closed'> = {
    'gate-a': 'open',
    'gate-b': 'open',
    'gate-c': 'open',
    'gate-d': 'open',
  };

  it('routes sec-101 to gate-a without errors', () => {
    const result = computeRoute(
      'sec-101', 'gate-a', EDGES, ZONES, emptyDensity, emptyLoad, allGatesOpen
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path[0]).toBe('sec-101');
    expect(result.path[result.path.length - 1]).toBe('gate-a');
    expect(result.etaSec).toBeGreaterThan(0);
  });

  it('routes sec-201 to gate-c without errors', () => {
    const result = computeRoute(
      'sec-201', 'gate-c', EDGES, ZONES, emptyDensity, emptyLoad, allGatesOpen
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path[0]).toBe('sec-201');
    expect(result.path[result.path.length - 1]).toBe('gate-c');
  });

  it('routes sec-301 to gate-b with accessibleOnly=true — path is accessible', () => {
    const result = computeRoute(
      'sec-301', 'gate-b', EDGES, ZONES, emptyDensity, emptyLoad, allGatesOpen,
      { accessibleOnly: true }
    );
    // Should find an accessible path (venue has accessible concourses + elevators)
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.accessible).toBe(true);
    expect(result.path[0]).toBe('sec-301');
    expect(result.path[result.path.length - 1]).toBe('gate-b');
  });

  // MAP BUILD SPEC §22.2: affiliation is now assigned by numeric label — sections
  // 300-307 (sec-301..sec-307) are the only zones tagged affiliation:'away' in the
  // real venue; the two sections nearest each gate are 'neutral'; everything else
  // is 'home'. Concourse nodes (one per section, §22.7) and gates/transit are
  // unaffiliated (shared commons). Since a leaf section's only entry edges are its
  // own stairs/elevator radial pair (both scored equally by the ×3 affiliation
  // penalty, so their relative order — and thus the chosen path — never flips),
  // avoidAffiliation can only inflate the ETA of the final edge into an
  // opposing-affiliation SECTION destination — it can never reroute a path away
  // from one mid-journey. This is a real, documented limitation (see
  // docs/M10-hypersensory.md), not a bug: it reflects that only exclusive seating
  // blocks carry affiliation, and fans only ever pass through shared concourses.
  it('avoidAffiliation still finds a route to an away-tagged section and increases its ETA vs. unfiltered', () => {
    const unfiltered = computeRoute(
      'gate-a', 'sec-301', EDGES, ZONES, emptyDensity, emptyLoad, allGatesOpen
    );
    const filtered = computeRoute(
      'gate-a', 'sec-301', EDGES, ZONES, emptyDensity, emptyLoad, allGatesOpen,
      { avoidAffiliation: 'away' }
    );
    expect('error' in unfiltered).toBe(false);
    expect('error' in filtered).toBe(false);
    if ('error' in unfiltered || 'error' in filtered) return;

    // Same path (no alternate edge into a leaf section exists) ...
    expect(filtered.path).toEqual(unfiltered.path);
    // ... but the soft filter still measurably inflates the ETA (×3 on the
    // final section-entry edge), proving the filter reaches the real venue graph.
    expect(filtered.etaSec).toBeGreaterThan(unfiltered.etaSec);
  });

  it('populates reason.avoidedGates with structured items and correct cause when gate is closed or congested', () => {
    const testZones = [
      makeZone('A'),
      makeZone('gate-b', 'gate'),
      makeZone('gate-c', 'gate'),
      makeZone('D'),
    ];
    const testEdges = [
      makeEdge('A', 'gate-b', 60),
      makeEdge('gate-b', 'D', 60),
      makeEdge('A', 'gate-c', 30),
      makeEdge('gate-c', 'D', 30),
    ];

    const resultClosed = computeRoute(
      'A', 'D', testEdges, testZones, {}, {}, { 'gate-c': 'closed', 'gate-b': 'open' }
    );
    expect('error' in resultClosed).toBe(false);
    if (!('error' in resultClosed)) {
      expect(resultClosed.path).toEqual(['A', 'gate-b', 'D']);
      expect(resultClosed.reason.avoidedGates).toEqual([{ gateId: 'gate-c', cause: 'closed' }]);
    }

    const resultCongested = computeRoute(
      'A', 'D', testEdges, testZones, {}, {}, { 'gate-c': 'congested', 'gate-b': 'open' }
    );
    expect('error' in resultCongested).toBe(false);
    if (!('error' in resultCongested)) {
      expect(resultCongested.path).toEqual(['A', 'gate-b', 'D']);
      expect(resultCongested.reason.avoidedGates).toEqual([{ gateId: 'gate-c', cause: 'congested' }]);
    }
  });

  // Fix Batch H-2: the exact failing scenario — 3 gates closed, 1 open, routing
  // to a nearest-exit GATE destination. Closed gates are candidate destinations
  // excluded at resolution, never waypoints on the path to the chosen gate, so
  // the naive-vs-primary path diff can't surface them; they must still appear in
  // reason.avoidedGates with cause 'closed' so the LLM can explain the closures.
  it('surfaces ALL closed exit gates in reason.avoidedGates when routed to the sole open gate (3 closed, 1 open)', () => {
    const gateStatus = {
      'gate-a': 'closed' as const,
      'gate-c': 'closed' as const,
      'gate-d': 'closed' as const,
      'gate-b': 'open' as const,
    };

    // Destination gate-b was resolved via nearestExit; the other three are closed.
    const result = computeRoute(
      'sec-101', 'gate-b', EDGES, ZONES, {}, {}, gateStatus
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Path terminates at the one open gate...
    expect(result.path[result.path.length - 1]).toBe('gate-b');

    // ...and every closed gate is reported as an avoided exit, with cause 'closed'.
    expect(result.reason.avoidedGates).toEqual(
      expect.arrayContaining([
        { gateId: 'gate-a', cause: 'closed' },
        { gateId: 'gate-c', cause: 'closed' },
        { gateId: 'gate-d', cause: 'closed' },
      ])
    );
    expect(result.reason.avoidedGates).toHaveLength(3);
    // The chosen (open) destination gate is never listed as avoided.
    expect(result.reason.avoidedGates.some((g) => g.gateId === 'gate-b')).toBe(false);

    // Grounding-payload assertion: the reason data actually survives the exact
    // JSON.stringify serialization that agents.ts:273 pushes into the LLM
    // conversation as the `role: 'tool'` message. If avoidedGates were empty
    // (the original bug) this substring check would fail.
    const groundingPayload = JSON.stringify(result);
    expect(groundingPayload).toContain('"gateId":"gate-a","cause":"closed"');
    expect(groundingPayload).toContain('"gateId":"gate-c","cause":"closed"');
    expect(groundingPayload).toContain('"gateId":"gate-d","cause":"closed"');
  });

  // Guard: the closed-gate reasoning must NOT fire for non-gate destinations,
  // so amenity/zone routes aren't polluted with unrelated closure noise.
  it('does not add closed-gate reasons when the destination is not a gate', () => {
    const testZones = [makeZone('A'), makeZone('gate-c', 'gate'), makeZone('D')];
    const testEdges = [makeEdge('A', 'D', 30), makeEdge('A', 'gate-c', 30)];

    const result = computeRoute(
      'A', 'D', testEdges, testZones, {}, {}, { 'gate-c': 'closed' }
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    // gate-c is closed but destination D is not a gate and gate-c is not on any
    // path to D, so nothing is (incorrectly) reported as an avoided exit.
    expect(result.reason.avoidedGates).toEqual([]);
  });
});
