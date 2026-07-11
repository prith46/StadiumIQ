import { describe, it, expect } from 'vitest';
import { evaluateSmartBribe, buildIncentiveQrPayload, SmartBribeInput } from './smartBribe';
import { parseIncentivePayload } from '../onboarding/qr';
import type { FanContext } from '../types';

describe('Smart Bribe Incentives (M9)', () => {
  const defaultFanContext: FanContext = {
    language: 'en',
    location: 'sec-101',
    accessibility: false,
  };

  const defaultInput: SmartBribeInput = {
    matchClockSec: 1000,
    density: {
      'gate-a': 0.1,
      'gate-b': 0.1,
      'gate-c': 0.1,
      'gate-d': 0.1,
    },
    gateStatus: {
      'gate-a': 'open',
      'gate-b': 'open',
      'gate-c': 'open',
      'gate-d': 'open',
    },
    routedLoad: {},
    fanContext: defaultFanContext,
    activeIncentiveIds: new Set<string>(),
  };

  it('detects a bottleneck gate and generates an incentive with correct fields', () => {
    const input: SmartBribeInput = {
      ...defaultInput,
      density: {
        ...defaultInput.density,
        'gate-a': 0.8, // busy
      },
      gateStatus: {
        ...defaultInput.gateStatus,
        'gate-a': 'congested', // congested
      },
    };

    const incentives = evaluateSmartBribe(input);
    expect(incentives.length).toBe(1);
    expect(incentives[0].fromZone).toBe('gate-a');
    expect(incentives[0].expiresAt).toBe(1600); // 1000 + 600
    expect(incentives[0].reward).toContain('10% off at concession near');
  });

  it('does not generate incentives if there are no bottlenecks', () => {
    const input: SmartBribeInput = {
      ...defaultInput,
      density: {
        ...defaultInput.density,
        'gate-a': 0.5, // not busy
      },
      gateStatus: {
        ...defaultInput.gateStatus,
        'gate-a': 'open',
      },
    };

    const incentives = evaluateSmartBribe(input);
    expect(incentives.length).toBe(0);
  });

  it('selects the alternative gate with the lowest routedLoad (M8 integration)', () => {
    const input: SmartBribeInput = {
      ...defaultInput,
      density: {
        ...defaultInput.density,
        'gate-a': 0.8, // bottleneck
      },
      gateStatus: {
        ...defaultInput.gateStatus,
        'gate-a': 'congested',
      },
      routedLoad: {
        'gate-b': 5, // higher virtual load
        'gate-c': 1, // lowest virtual load
        'gate-d': 3,
      },
    };

    const incentives = evaluateSmartBribe(input);
    expect(incentives.length).toBe(1);
    expect(incentives[0].fromZone).toBe('gate-a');
    expect(incentives[0].toZone).toBe('gate-c'); // lowest virtual load selected
  });

  it('prevents duplicates for the same bottleneck in the same minute using activeIncentiveIds', () => {
    const input: SmartBribeInput = {
      ...defaultInput,
      density: {
        ...defaultInput.density,
        'gate-a': 0.8,
      },
      gateStatus: {
        ...defaultInput.gateStatus,
        'gate-a': 'congested',
      },
      activeIncentiveIds: new Set<string>([
        `incentive-gate-a-gate-b-${Math.floor(1000 / 60)}`, // gate-b is the next best alternative alphabetically
      ]),
    };

    const incentives = evaluateSmartBribe(input);
    // Since the ID is already marked active, it should skip generating a duplicate
    expect(incentives.length).toBe(0);
  });

  it('generates a new incentive once the match clock rolls to a new minute', () => {
    const input: SmartBribeInput = {
      ...defaultInput,
      matchClockSec: 1060, // next minute (1060 / 60 = 17, vs 1000 / 60 = 16)
      density: {
        ...defaultInput.density,
        'gate-a': 0.8,
      },
      gateStatus: {
        ...defaultInput.gateStatus,
        'gate-a': 'congested',
      },
      activeIncentiveIds: new Set<string>([
        `incentive-gate-a-gate-b-${Math.floor(1000 / 60)}`, // older minute ID
      ]),
    };

    const incentives = evaluateSmartBribe(input);
    expect(incentives.length).toBe(1);
    expect(incentives[0].id).toBe(`incentive-gate-a-gate-b-17`);
  });

  it('buildIncentiveQrPayload produces a stable deterministic string compatible with M1 parser', () => {
    const incentive = {
      id: 'incentive-gate-a-gate-b-16',
      fromZone: 'gate-a',
      toZone: 'gate-b',
      reward: '10% off concession',
      expiresAt: 1600,
    };

    const payload = buildIncentiveQrPayload(incentive);
    const payload2 = buildIncentiveQrPayload(incentive);
    expect(payload).toBe(payload2); // stable

    // Validate using onboarding's parseIncentivePayload to confirm structural compatibility
    const parsed = parseIncentivePayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.fromZone).toBe('gate-a');
    expect(parsed?.toZone).toBe('gate-b');
    expect(parsed?.reward).toBe('10% off concession');
  });
});
