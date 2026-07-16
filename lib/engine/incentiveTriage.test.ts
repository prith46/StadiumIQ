import { describe, it, expect } from 'vitest';
import { detectBottlenecks, IncentiveTriageInput } from './incentiveTriage';
import { ZONES } from '../venue/venue';
import * as fs from 'fs';
import * as path from 'path';

describe('Incentive Triage Engine (Pure logic)', () => {
  const NO_OFFERED: Record<string, number> = {};

  // Find some real gates from ZONES
  const gates = ZONES.filter((z) => z.type === 'gate');
  const gateA = gates[0]?.id || 'gate-a';
  const gateB = gates[1]?.id || 'gate-b';
  const gateC = gates[2]?.id || 'gate-c';

  // ---------------------------------------------------------------------------
  // 1. Live Density Triggers
  // ---------------------------------------------------------------------------

  it('triggers a bottleneck when gate density exceeds 0.7', () => {
    const input: IncentiveTriageInput = {
      matchClockSec: 1000,
      density: { [gateA]: 0.8 }, // congested
      routedLoad: {},
      gateStatus: { [gateA]: 'open' },
      alreadyOffered: NO_OFFERED,
    };

    const results = detectBottlenecks(input);
    expect(results).toContain(gateA);
  });

  // ---------------------------------------------------------------------------
  // 2. Predictive routedLoad Imbalance Triggers (M8 integration)
  // ---------------------------------------------------------------------------

  it('triggers bottleneck on predictive load imbalance (>1.5x mean load) even with low density', () => {
    // 3 open gates: gateA load = 6, gateB load = 1, gateC load = 1.
    // Mean load = (6+1+1)/3 = 2.66.
    // gateA has load 6, which is > 1.5 * 2.66 (4.0) and >= 2.
    // It should trigger even if density is 0!
    
    const input: IncentiveTriageInput = {
      matchClockSec: 1000,
      density: { [gateA]: 0.1, [gateB]: 0.1, [gateC]: 0.1 },
      routedLoad: { [gateA]: 6, [gateB]: 1, [gateC]: 1 },
      gateStatus: { [gateA]: 'open', [gateB]: 'open', [gateC]: 'open' },
      alreadyOffered: NO_OFFERED,
    };

    const results = detectBottlenecks(input);
    expect(results).toContain(gateA);
    expect(results).not.toContain(gateB);
  });

  it('does NOT trigger bottleneck on load imbalance if load is below baseline minimum (2)', () => {
    // gateA load = 1. gateB = 0, gateC = 0.
    // Mean load = 0.33. 1.5 * 0.33 = 0.5. Load 1 is > 0.5, but load is < 2.
    // So it should NOT trigger.
    
    const input: IncentiveTriageInput = {
      matchClockSec: 1000,
      density: {},
      routedLoad: { [gateA]: 1 },
      gateStatus: { [gateA]: 'open', [gateB]: 'open', [gateC]: 'open' },
      alreadyOffered: NO_OFFERED,
    };

    const results = detectBottlenecks(input);
    expect(results).not.toContain(gateA);
  });

  it('does NOT trigger a bottleneck when density and load are in normal ranges', () => {
    const input: IncentiveTriageInput = {
      matchClockSec: 1000,
      density: { [gateA]: 0.3 },
      routedLoad: { [gateA]: 1, [gateB]: 1 },
      gateStatus: { [gateA]: 'open', [gateB]: 'open' },
      alreadyOffered: NO_OFFERED,
    };

    const results = detectBottlenecks(input);
    expect(results).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 3. Cooldown Verification
  // ---------------------------------------------------------------------------

  it('filters out bottleneck zones that are within the 300s cooldown window', () => {
    const input: IncentiveTriageInput = {
      matchClockSec: 1000,
      density: { [gateA]: 0.8 },
      routedLoad: {},
      gateStatus: { [gateA]: 'open' },
      alreadyOffered: { [gateA]: 800 }, // offered 200s ago (within 300s cooldown)
    };

    const results = detectBottlenecks(input);
    expect(results).not.toContain(gateA);
  });

  it('permits trigger for bottleneck zones once the 300s cooldown has expired', () => {
    const input: IncentiveTriageInput = {
      matchClockSec: 1000,
      density: { [gateA]: 0.8 },
      routedLoad: {},
      gateStatus: { [gateA]: 'open' },
      alreadyOffered: { [gateA]: 650 }, // offered 350s ago (outside 300s cooldown)
    };

    const results = detectBottlenecks(input);
    expect(results).toContain(gateA);
  });

  // ---------------------------------------------------------------------------
  // 4. Code Purity Assertions
  // ---------------------------------------------------------------------------

  it('ensures incentiveTriage.ts contains no direct imports of Zustand or React', () => {
    const filePath = path.resolve(__dirname, './incentiveTriage.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Grep-style regex asserting no React/Zustand imports
    const forbiddenPatterns = [
      /import.*from.*['"]react['"]/i,
      /import.*from.*['"]zustand['"]/i,
      /import.*from.*['"]\.\.\/store\/.*['"]/i,
    ];

    forbiddenPatterns.forEach((pattern) => {
      expect(content).not.toMatch(pattern);
    });
  });
});
