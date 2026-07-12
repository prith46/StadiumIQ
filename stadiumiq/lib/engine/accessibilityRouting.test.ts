import { describe, it, expect } from 'vitest';
import { computeRoute } from './routing';
import { prioritizeAccessibleFacilities } from './facilities';
import { Edge, Zone, Poi } from '../types';

describe('Accessibility-First Routing (M11)', () => {
  function makeZone(
    id: string,
    type: Zone['type'] = 'section',
    accessible = true
  ): Zone {
    return {
      id,
      label: id,
      type,
      attrs: { accessible, enclosed: false, noise: 'low' },
    };
  }

  function makeEdge(
    from: string,
    to: string,
    baseWalkSec: number,
    accessible = true
  ): Edge {
    return {
      from,
      to,
      baseWalkSec,
      accessible,
      enclosed: false,
      noise: 'low',
    };
  }

  const mockZones: Zone[] = [
    makeZone('A'),
    makeZone('B'),
    makeZone('C'),
    makeZone('D'),
  ];

  const density = {};
  const routedLoad = {};
  const gateStatus = {};

  it('accessibleOnly: true avoids stair edges and uses elevator path', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10),
      makeEdge('B', 'D', 10, false), // Stair edge (inaccessible)
      makeEdge('A', 'C', 15, true),  // Elevator path (longer but accessible)
      makeEdge('C', 'D', 10, true),
    ];

    // Baseline route uses shortest direct route (A -> B -> D)
    const baseline = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, {});
    expect(!('error' in baseline) && baseline.path).toEqual(['A', 'B', 'D']);

    // accessibleOnly should steer away from stairs, returning A -> C -> D
    const result = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, { accessibleOnly: true });
    expect(!('error' in result) && result.path).toEqual(['A', 'C', 'D']);
  });

  it('accessibleOnly: true returns noRouteFound when no accessible path exists', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10, false), // only way out is a stair
      makeEdge('B', 'D', 10, true),
    ];

    const result = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, { accessibleOnly: true });

    // Verify AccessibleRouteResult shape on error
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('no_accessible_route_found');
      expect((result as any).path).toBeNull();
      expect((result as any).accessible).toBe(false);
      expect((result as any).noRouteFound).toBe(true);
      expect((result as any).etaSec).toBeNull();
    }
  });

  it('returns identical route to baseline when accessibleOnly is false or omitted', () => {
    const mockEdges: Edge[] = [
      makeEdge('A', 'B', 10, false),
      makeEdge('B', 'D', 10, true),
      makeEdge('A', 'C', 15, true),
      makeEdge('C', 'D', 10, true),
    ];

    const routeOmitted = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus);
    const routeFalse = computeRoute('A', 'D', mockEdges, mockZones, density, routedLoad, gateStatus, { accessibleOnly: false });

    const pathOmitted = !('error' in routeOmitted) ? routeOmitted.path : [];
    const pathFalse = !('error' in routeFalse) ? routeFalse.path : [];
    expect(pathOmitted).toEqual(pathFalse);
  });

  describe('prioritizeAccessibleFacilities', () => {
    function makePoi(id: string, type: Poi['type'], nearestZone: string): Poi {
      return {
        id,
        label: id,
        type,
        nearestZone,
        status: 'open',
        angle: 0,
        r: 0,
      };
    }

    it('prioritizes accessible restrooms within tolerance of the closest standard variant', () => {
      const pois: Poi[] = [
        makePoi('poi-standard-1', 'restroom', 'sec-102'),           // Closest standard (distance ~1 step)
        makePoi('poi-accessible-1', 'restroom_accessible', 'sec-104'), // Accessible (distance ~3 steps, same tier, delta = 2)
        makePoi('poi-standard-2', 'restroom', 'sec-120'),
      ];

      // If user does NOT need accessibility, returns closest standard variant first
      const normalResult = prioritizeAccessibleFacilities(pois, 'sec-101', false);
      expect(normalResult[0].id).toBe('poi-standard-1');

      // If user needs accessibility, accessible POI is within tolerance so promoted first
      const accessResult = prioritizeAccessibleFacilities(pois, 'sec-101', true);
      expect(accessResult[0].id).toBe('poi-accessible-1');
    });

    it('does not prioritize accessible restroom if it is outside tolerance', () => {
      const pois: Poi[] = [
        makePoi('poi-standard-1', 'restroom', 'sec-102'),           // Closest standard (distance ~1 step)
        makePoi('poi-accessible-1', 'restroom_accessible', 'sec-112'), // Accessible (same tier, delta = 10 -> outside tolerance)
      ];

      // Even with accessibility needed, accessible restroom is too far, so closest standard remains first
      const accessResult = prioritizeAccessibleFacilities(pois, 'sec-101', true);
      expect(accessResult[0].id).toBe('poi-standard-1');
    });
  });
});
