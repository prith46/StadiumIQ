import { describe, it, expect, vi } from 'vitest';
import { evaluateTriggers, TriageInput, DestinationQuery, RouteResult, RouteError } from './alertTriage';
import type { FanContext } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('Alert Triage Engine', () => {
  // Base default context for a fan
  const defaultFanContext: FanContext = {
    language: 'en',
    location: 'sec-101',
    accessibility: false,
    leavingEarly: false,
  };

  // Base state inputs for simulation state
  const baseInput: TriageInput = {
    matchClockSec: 0,
    density: {
      'gate-a': 0.0,
      'gate-b': 0.0,
      'gate-c': 0.0,
      'gate-d': 0.0,
      'concourse-1-n': 0.0,
    },
    gateStatus: {
      'gate-a': 'open',
      'gate-b': 'open',
      'gate-c': 'open',
      'gate-d': 'open',
    },
    fanContext: defaultFanContext,
    alreadyFired: {},
  };

  // Mocks a successful computeRouteFn execution
  const mockComputeRoute = (path: string[], etaSec: number) => {
    return vi.fn().mockImplementation((origin: string, dest: DestinationQuery) => {
      const res: RouteResult = {
        path,
        etaSec,
        reason: { crowdedZones: [], avoidedGates: [], etaSec },
        accessible: false,
      };
      return res;
    });
  };

  // ---------------------------------------------------------------------------
  // 1. Automated Purity Enforcements
  // ---------------------------------------------------------------------------

  it('enforces direct import constraints on alertTriage.ts to maintain engine purity', () => {
    const filePath = path.resolve(__dirname, './alertTriage.ts');
    const sourceCode = fs.readFileSync(filePath, 'utf-8');

    // Matches any direct value/state imports from react, zustand, simStore, routing, routingService
    const imports = sourceCode.match(/import\s+[^]*?from\s+['"].*?['"]/g) || [];
    
    for (const imp of imports) {
      // Direct imports of react or zustand are strictly banned
      expect(imp).not.toMatch(/['"](react|zustand)['"]/);
      // Imports of routing or store modules must be compile-time type-only imports
      if (imp.includes('simStore') || imp.includes('routing') || imp.includes('routingService') || imp.includes('destinationResolver')) {
        expect(imp).toMatch(/import\s+type\s+/);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Pre-emptive Exit Nudge Rules
  // ---------------------------------------------------------------------------

  it('exit-nudge fires in late-game window when nearest gate density > 0.7', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 6000, // In late-game window [5700, 6300]
      density: {
        'gate-a': 0.8, // Congested nearest gate
        'gate-b': 0.2, // Clearest gate
        'gate-c': 0.5,
        'gate-d': 0.9,
      },
    };

    // Route calculation returns a path terminating at gate-a (nearest)
    const computeRouteFn = mockComputeRoute(['sec-101', 'concourse-1-n', 'gate-a'], 45);
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(1);
    expect(alerts[0].triggerKey).toBe('exit-nudge');
    expect(alerts[0].alert.zoneId).toBe('gate-b'); // Recommends clearest gate
    expect(alerts[0].alert.priority).toBe(2);
    expect(alerts[0].alert.action).toBe('Show route');
    expect(computeRouteFn).toHaveBeenCalledTimes(1);
  });

  it('exit-nudge does NOT fire outside late-game window even if density is high', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 4000, // Outside window
      density: { 'gate-a': 0.8 },
    };

    const computeRouteFn = mockComputeRoute(['sec-101', 'concourse-1-n', 'gate-a'], 45);
    const alerts = evaluateTriggers(input, computeRouteFn);

    // Should short-circuit and NOT trigger, making ZERO computeRoute calls
    expect(alerts.length).toBe(0);
    expect(computeRouteFn).not.toHaveBeenCalled();
  });

  it('exit-nudge does NOT fire if nearest gate density is clear (<= 0.7)', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 6000,
      density: { 'gate-a': 0.6 }, // Clear nearest gate
    };

    const computeRouteFn = mockComputeRoute(['sec-101', 'concourse-1-n', 'gate-a'], 45);
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(0);
    expect(computeRouteFn).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 3. Transit Nudge Rules
  // ---------------------------------------------------------------------------

  it('transit-nudge fires only when leavingEarly is true and next train is within N=5 buffer', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 2500,
      fanContext: {
        ...defaultFanContext,
        leavingEarly: true,
      },
    };

    // Train departs at matchClockSec 2700 (next 15m mark).
    // Walk to transit takes 150 seconds.
    // Projected arrival: 2500 + 150 = 2650.
    // Train departure 2700 is within buffer [2650, 2950] and we make it (2650 <= 2700).
    const computeRouteFn = mockComputeRoute(['sec-101', 'transit-train'], 150);
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(1);
    expect(alerts[0].triggerKey).toBe('transit-nudge');
    expect(alerts[0].alert.zoneId).toBe('transit-train');
    expect(alerts[0].alert.priority).toBe(2);
    expect(computeRouteFn).toHaveBeenCalledTimes(1);
  });

  it('transit-nudge does NOT fire if leavingEarly is false, even if timing matches', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 2500,
      fanContext: {
        ...defaultFanContext,
        leavingEarly: false, // False preconditions
      },
    };

    const computeRouteFn = mockComputeRoute(['sec-101', 'transit-train'], 150);
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(0);
    expect(computeRouteFn).not.toHaveBeenCalled(); // Short-circuits
  });

  it('transit-nudge does NOT fire if we would miss the next train (arrival > departure)', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 2600,
      fanContext: {
        ...defaultFanContext,
        leavingEarly: true,
      },
    };

    // Next train departs at 2700.
    // Walk to transit takes 150 seconds.
    // Projected arrival: 2600 + 150 = 2750.
    // We arrive after departure (2750 > 2700) -> no nudge (we would miss it)
    const computeRouteFn = mockComputeRoute(['sec-101', 'transit-train'], 150);
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Halftime Concourse Nudge Rules
  // ---------------------------------------------------------------------------

  // MAP BUILD SPEC §22.4: restroom POIs now attach to their nearest SECTION
  // (not a stand/tier concourse — concourse nodes are now per-section routing
  // nodes, not amenity locations). For fanContext.location 'sec-101', the
  // nearest restroom POI (r=0.565, angles 35/125/215/305) resolves to 'sec-202'.
  it('halftime-nudge fires during halftime phase when nearest restroom is not congested (< 0.4)', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 3000, // halftime phase [2700, 3600]
      density: {
        'sec-202': 0.2, // Section nearest the nearest restroom POI is clear
      },
    };

    const computeRouteFn = vi.fn();
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(1);
    expect(alerts[0].triggerKey).toBe('halftime-nudge');
    expect(alerts[0].alert.zoneId).toBe('sec-202');
    expect(alerts[0].alert.priority).toBe(3);
    // Halftime nudge is coordinate-based and does NOT make routing calls
    expect(computeRouteFn).not.toHaveBeenCalled();
  });

  it('halftime-nudge does NOT fire during halftime if nearest restroom section is congested', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 3000,
      density: {
        'sec-202': 0.6, // Congested section nearest the restroom POI
      },
    };

    const computeRouteFn = vi.fn();
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(0);
  });

  it('halftime-nudge does NOT fire outside halftime window', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 2000, // In firstHalf
      density: { 'concourse-1-n': 0.2 },
    };

    const computeRouteFn = vi.fn();
    const alerts = evaluateTriggers(input, computeRouteFn);

    expect(alerts.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 5. Dijkstra Calling Count Boundaries
  // ---------------------------------------------------------------------------

  it('strictly bounds computeRouteFn call counts per tick to at most 2', () => {
    const input: TriageInput = {
      ...baseInput,
      matchClockSec: 6000, // Late game window (triggers exit check)
      fanContext: {
        ...defaultFanContext,
        leavingEarly: true, // Triggers transit check
      },
      density: { 'gate-a': 0.8 },
    };

    const computeRouteFn = vi.fn().mockImplementation((origin: string, dest: DestinationQuery) => {
      const res: RouteResult = {
        path: ['sec-101', 'gate-a'],
        etaSec: 30,
        reason: { crowdedZones: [], avoidedGates: [], etaSec: 30 },
        accessible: false,
      };
      return res;
    });

    evaluateTriggers(input, computeRouteFn);

    // 1 call for exit-nudge, 1 call for transit-nudge. Halftime is outside halftime clock window.
    // Worst-case call count is strictly bounded to 2.
    expect(computeRouteFn).toHaveBeenCalledTimes(2);
  });
});
