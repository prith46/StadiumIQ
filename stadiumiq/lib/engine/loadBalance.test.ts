import { describe, it, expect } from 'vitest';
import { routedLoadPenalty, incrementRoutedLoad, decayRoutedLoad } from './loadBalance';
import { computeRoute } from './routing';
import { Edge, Zone } from '../types';

describe('Anti-Herding Load-Balancer (M8)', () => {
  // 1. routedLoadPenalty Tests
  describe('routedLoadPenalty', () => {
    it('produces higher penalty for higher routedLoad (monotonic increasing)', () => {
      const load1 = { 'gate-a': 2 };
      const load2 = { 'gate-a': 5 };
      const load3 = { 'gate-a': 15 }; // beyond cap

      expect(routedLoadPenalty(load1, 'gate-a')).toBeCloseTo(0.3, 5); // 0.15 * 2
      expect(routedLoadPenalty(load2, 'gate-a')).toBeCloseTo(0.75, 5); // 0.15 * 5
      expect(routedLoadPenalty(load3, 'gate-a')).toBeCloseTo(1.5, 5); // capped at 10: 0.15 * 10

      expect(routedLoadPenalty(load2, 'gate-a')).toBeGreaterThan(routedLoadPenalty(load1, 'gate-a'));
      expect(routedLoadPenalty(load3, 'gate-a')).toBe(routedLoadPenalty({ 'gate-a': 10 }, 'gate-a'));
    });

    it('returns 0 for gates with no load or missing keys', () => {
      expect(routedLoadPenalty({}, 'gate-a')).toBe(0);
      expect(routedLoadPenalty({ 'gate-b': 5 }, 'gate-a')).toBe(0);
    });
  });

  // 2. incrementRoutedLoad Tests
  describe('incrementRoutedLoad', () => {
    it('increments target gate and leaves others unchanged without mutating input', () => {
      const initial = { 'gate-a': 1, 'gate-b': 3 };
      const result = incrementRoutedLoad(initial, 'gate-a');

      expect(result['gate-a']).toBe(2);
      expect(result['gate-b']).toBe(3);
      // Immutability check
      expect(initial['gate-a']).toBe(1);
      expect(result).not.toBe(initial);
    });

    it('handles missing gate key by starting at 1', () => {
      const initial = { 'gate-b': 3 };
      const result = incrementRoutedLoad(initial, 'gate-a');
      expect(result['gate-a']).toBe(1);
    });
  });

  // 3. decayRoutedLoad Tests
  describe('decayRoutedLoad', () => {
    it('applies exponential decay correctly, prunes values < 0.01, and ignores zero values', () => {
      const initial = { 'gate-a': 10, 'gate-b': 0.05, 'gate-c': 0.01 };
      const result = decayRoutedLoad(initial, 0.9);

      // gate-a: 10 * 0.9 = 9
      expect(result['gate-a']).toBeCloseTo(9, 5);
      // gate-b: 0.05 * 0.9 = 0.045 (>= 0.01, kept)
      expect(result['gate-b']).toBeCloseTo(0.045, 5);
      // gate-c: 0.01 * 0.9 = 0.009 (< 0.01, pruned)
      expect(result['gate-c']).toBeUndefined();
    });

    it('leaves unaffected gates with no load untouched', () => {
      expect(decayRoutedLoad({})).toEqual({});
    });
  });

  // 4. M3 Congestion Integration Tests
  describe('M3 Routing Integration with routedLoad', () => {
    // Simple 3-node mock graph: Section 101 can exit through Gate A (10s) or Gate B (20s)
    const mockZones: Zone[] = [
      { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'low' } },
      { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'low' } },
      { id: 'gate-b', label: 'Gate B', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'low' } },
    ];

    const mockEdges: Edge[] = [
      { from: 'sec-101', to: 'gate-a', baseWalkSec: 10, accessible: true, enclosed: false, noise: 'low' },
      { from: 'sec-101', to: 'gate-b', baseWalkSec: 20, accessible: true, enclosed: false, noise: 'low' },
    ];

    const density = {};
    const gateStatus = { 'gate-a': 'open' as const, 'gate-b': 'open' as const };

    it('routing with empty routedLoad selects the geographically closest gate (baseline M3)', () => {
      const routeA = computeRoute('sec-101', 'gate-a', mockEdges, mockZones, density, {}, gateStatus);
      const routeB = computeRoute('sec-101', 'gate-b', mockEdges, mockZones, density, {}, gateStatus);

      expect('error' in routeA).toBe(false);
      expect('error' in routeB).toBe(false);
      if (!('error' in routeA) && !('error' in routeB)) {
        expect(routeA.etaSec).toBe(10);
        expect(routeB.etaSec).toBe(20);
      }
    });

    it('routing spills over to alternative gate when routedLoad on closest gate is elevated', () => {
      // Under no load: Gate A (10s) is preferred over Gate B (20s)
      // If we put heavy routedLoad on Gate A, say 8 routed recommendations:
      // Weight Gate A = 10 * congestionFactor(0, 8) = 10 * (1 + 0.15 * 8) = 10 * 2.2 = 22 seconds!
      // Now Gate B (20 seconds) has lower weight than Gate A (22 seconds)!
      const routedLoad = { 'gate-a': 8 };

      const routeA = computeRoute('sec-101', 'gate-a', mockEdges, mockZones, density, routedLoad, gateStatus);
      const routeB = computeRoute('sec-101', 'gate-b', mockEdges, mockZones, density, routedLoad, gateStatus);

      expect('error' in routeA).toBe(false);
      expect('error' in routeB).toBe(false);
      if (!('error' in routeA) && !('error' in routeB)) {
        // Gate A's weight has inflated from 10s to 22s!
        expect(routeA.etaSec).toBe(22);
        expect(routeB.etaSec).toBe(20);
      }
    });

    it('decayed load has zero or reduced routing influence', () => {
      let routedLoad: Record<string, number> = { 'gate-a': 8 };

      // Apply decay multiple times until it prunes
      for (let i = 0; i < 70; i++) {
        routedLoad = decayRoutedLoad(routedLoad, 0.9);
      }

      // Load is fully decayed/empty
      expect(Object.keys(routedLoad).length).toBe(0);

      const routeA = computeRoute('sec-101', 'gate-a', mockEdges, mockZones, density, routedLoad, gateStatus);
      expect('error' in routeA).toBe(false);
      if (!('error' in routeA)) {
        // Returns back to baseline 10s
        expect(routeA.etaSec).toBe(10);
      }
    });
  });
});
