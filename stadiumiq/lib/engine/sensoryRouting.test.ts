import { describe, it, expect } from 'vitest';
import { computeRoute } from './routing';
import { Edge, Zone } from '../types';

describe('Hyper-Sensory / Emotional Routing (M10)', () => {
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

  const mockZones: Zone[] = [
    makeZone('A'),
    makeZone('B', 'section', true, 'away'),
    makeZone('C'),
    makeZone('D'),
    makeZone('E'),
  ];

  const density = {};
  const routedLoad = {};
  const gateStatus = {};

  it('quiet: true avoids noisy edges when a comparable quiet alternative exists', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10, { noise: 'high' }), // Path 1: A -> B -> D (20s, noisy)
      makeEdge('A', 'C', 12),
      makeEdge('C', 'D', 10),                    // Path 2: A -> C -> D (22s, quiet)
    ];

    // Baseline route (no filters) should choose shortest direct path (A -> B -> D)
    const baseline = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus);
    expect(!('error' in baseline) && baseline.path).toEqual(['A', 'B', 'D']);

    // Quiet filter should redirect to A -> C -> D because of noise penalty on B -> D
    const sensory = { quiet: true };
    const result = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, sensory);
    expect(!('error' in result) && result.path).toEqual(['A', 'C', 'D']);
  });

  it('openAir: true avoids enclosed edges when a comparable open alternative exists', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10, { enclosed: true }), // Path 1: A -> B -> D (20s, enclosed)
      makeEdge('A', 'C', 12),
      makeEdge('C', 'D', 10),                     // Path 2: A -> C -> D (22s, openAir)
    ];

    // Baseline
    const baseline = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus);
    expect(!('error' in baseline) && baseline.path).toEqual(['A', 'B', 'D']);

    // OpenAir filter
    const sensory = { openAir: true };
    const result = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, sensory);
    expect(!('error' in result) && result.path).toEqual(['A', 'C', 'D']);
  });

  it('avoidAffiliation: away avoids away-affiliated zones when a neutral alternative exists', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10), // Path 1: A -> B -> D (20s, B is 'away' affiliated)
      makeEdge('A', 'C', 12),
      makeEdge('C', 'D', 10), // Path 2: A -> C -> D (22s, all neutral)
    ];

    // Baseline
    const baseline = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus);
    expect(!('error' in baseline) && baseline.path).toEqual(['A', 'B', 'D']);

    // Avoid Affiliation filter
    const sensory = { avoidAffiliation: 'away' as const };
    const result = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, sensory);
    expect(!('error' in result) && result.path).toEqual(['A', 'C', 'D']);
  });

  it('applies sensory penalties additively when multiple preferences are active', () => {
    // 3 Paths:
    // Path 1: A -> B -> D (20s, B is noisy: high-noise penalty = +5s)
    // Path 2: A -> C -> D (20s, C is enclosed: enclosed penalty = +5s)
    // Path 3: A -> E -> D (22s, clean path: no penalties)
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10, { noise: 'high' }),
      makeEdge('A', 'C', 10),
      makeEdge('C', 'D', 10, { enclosed: true }),
      makeEdge('A', 'E', 12),
      makeEdge('E', 'D', 10),
    ];

    // 1. Quiet only: avoids Path 1 (25s), prefers Path 2 (20s) over Path 3 (22s)
    const resultQuiet = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, { quiet: true });
    expect(!('error' in resultQuiet) && resultQuiet.path).toEqual(['A', 'C', 'D']);

    // 2. OpenAir only: avoids Path 2 (25s), prefers Path 1 (20s) over Path 3 (22s)
    const resultOpenAir = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, { openAir: true });
    expect(!('error' in resultOpenAir) && resultOpenAir.path).toEqual(['A', 'B', 'D']);

    // 3. Combined Quiet + OpenAir: both Path 1 and Path 2 are penalized to 25s, so Path 3 (22s) is selected
    const resultCombined = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, { quiet: true, openAir: true });
    expect(!('error' in resultCombined) && resultCombined.path).toEqual(['A', 'E', 'D']);
  });

  it('gracefully degrades and returns the only available route even if it violates sensory preferences', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10, { noise: 'high', enclosed: true }), // Only path, heavily penalized
    ];

    const sensory = { quiet: true, openAir: true, avoidAffiliation: 'away' as const };
    const result = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, sensory);

    // Should not fail or error out, but return the only path
    expect(!('error' in result)).toBe(true);
    if (!('error' in result)) {
      expect(result.path).toEqual(['A', 'B', 'D']);
      // 10s + 10s + 5s (noise penalty) + 5s (enclosed penalty) + 5s (affiliation penalty) = 35 seconds
      expect(result.etaSec).toBe(35);
    }
  });

  it('returns identical route to baseline M3 when no filters are passed', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10, { noise: 'high', enclosed: true }),
      makeEdge('A', 'C', 15),
      makeEdge('C', 'D', 10),
    ];

    const baseline = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus);
    const sensoryEmpty = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {}, {});

    expect(!('error' in baseline) && !('error' in sensoryEmpty) && baseline.path).toEqual(sensoryEmpty.path);
  });
});
