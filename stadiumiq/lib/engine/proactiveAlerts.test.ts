import { describe, it, expect } from 'vitest';
import { evaluateProactiveAlerts, ProactiveAlertInput } from './proactiveAlerts';
import { DensityFrame } from './forecast';

describe('Proactive Exit Alerts (M6)', () => {
  const mockTimeline: DensityFrame[] = [
    {
      atSec: 0,
      density: { 'gate-a': 0.2, 'gate-b': 0.1, 'gate-c': 0.1, 'gate-d': 0.1 },
    },
    {
      atSec: 900,
      density: { 'gate-a': 0.8, 'gate-b': 0.3, 'gate-c': 0.1, 'gate-d': 0.1 }, // gate-a peaks at 0.8 (congested)
    },
    {
      atSec: 1800,
      density: { 'gate-a': 0.5, 'gate-b': 0.3, 'gate-c': 0.1, 'gate-d': 0.1 },
    },
  ];

  const defaultInput: ProactiveAlertInput = {
    matchClockSec: 0,
    density: { 'gate-a': 0.2, 'gate-b': 0.1, 'gate-c': 0.1, 'gate-d': 0.1 },
    gateStatus: { 'gate-a': 'open', 'gate-b': 'open', 'gate-c': 'open', 'gate-d': 'open' },
    fanContext: { language: 'en', location: 'sec-101', accessibility: false, leavingEarly: true },
    timeline: mockTimeline,
    dismissedAlertIds: new Set<string>(),
    computeRouteFn: (origin, dest) => {
      // Mock route compute: returning a dummy route where gate-b is faster
      const gateId = (dest as any).zoneId ?? 'gate-b';
      return {
        path: [origin, gateId],
        etaSec: gateId === 'gate-b' ? 120 : 300,
        reason: { crowdedZones: [], avoidedGates: [], etaSec: 120 },
        accessible: true,
      };
    },
  };

  it('Trigger 1: Forecasted density crossing threshold within horizon triggers correct alert with alternative routing', () => {
    const input: ProactiveAlertInput = {
      ...defaultInput,
      currentRoute: { path: ['sec-101', 'gate-a'], etaSec: 300, targetGate: 'gate-a' },
    };

    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(1);
    expect(alerts[0].id).toBe('proactive-exitalert-gate-a-congestion');
    expect(alerts[0].priority).toBe(2);
    expect(alerts[0].zoneId).toBe('gate-b'); // Recommends the faster gate-b
    expect(alerts[0].body).toContain('Gate A is predicted to be congested');
    expect(alerts[0].body).toContain('Re-routing via Gate B is 3m faster');
  });

  it('Trigger 1: Density below threshold does not fire congestion alert', () => {
    const lowTimeline = [
      { atSec: 0, density: { 'gate-a': 0.2, 'gate-b': 0.1 } },
      { atSec: 900, density: { 'gate-a': 0.5, 'gate-b': 0.1 } },
    ];
    const input: ProactiveAlertInput = {
      ...defaultInput,
      timeline: lowTimeline,
      currentRoute: { path: ['sec-101', 'gate-a'], etaSec: 300, targetGate: 'gate-a' },
    };

    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(0);
  });

  it('Trigger 2: Egress-risk window (late regulation) + leavingEarly triggers priority 1 alert', () => {
    const input: ProactiveAlertInput = {
      ...defaultInput,
      matchClockSec: 5800, // Late regulation window
      fanContext: { ...defaultInput.fanContext, leavingEarly: true },
    };

    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(1);
    expect(alerts[0].priority).toBe(1);
    expect(alerts[0].id).toBe('proactive-exitalert-egress-risk-late-game');
    expect(alerts[0].body).toContain('You indicated leaving early');
  });

  it('Trigger 2: Egress-risk window (late regulation) + imminent peak crush triggers priority 1 alert', () => {
    const lateGameTimeline: DensityFrame[] = [
      { atSec: 5700, density: { 'gate-a': 0.1 } },
      { atSec: 6000, density: { 'gate-a': 0.9, 'gate-b': 0.9 } }, // peak crush here
      { atSec: 6300, density: { 'gate-a': 0.1 } },
    ];
    const input: ProactiveAlertInput = {
      ...defaultInput,
      matchClockSec: 5800, // inside late-game
      timeline: lateGameTimeline,
      fanContext: { ...defaultInput.fanContext, leavingEarly: false }, // not leaving early
    };

    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(1);
    expect(alerts[0].priority).toBe(1);
    expect(alerts[0].id).toBe('proactive-exitalert-egress-risk-late-game');
    expect(alerts[0].body).toContain('High crowd density peak is imminent');
  });

  it('Dismissal: Dismissed alert is not re-fired', () => {
    const dismissedAlertIds = new Set<string>(['proactive-exitalert-gate-a-congestion']);
    const input: ProactiveAlertInput = {
      ...defaultInput,
      currentRoute: { path: ['sec-101', 'gate-a'], etaSec: 300, targetGate: 'gate-a' },
      dismissedAlertIds,
    };

    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(0);
  });

  it('Duplicate suppression: multiple evaluations with same active trigger do not produce duplicate Alert entries', () => {
    const input: ProactiveAlertInput = {
      ...defaultInput,
      currentRoute: { path: ['sec-101', 'gate-a'], etaSec: 300, targetGate: 'gate-a' },
    };

    const alerts1 = evaluateProactiveAlerts(input);
    const alerts2 = evaluateProactiveAlerts(input);
    expect(alerts1.length).toBe(1);
    expect(alerts2.length).toBe(1);
    expect(alerts1[0].id).toEqual(alerts2[0].id);
  });

  it('Robustness: missing currentRoute skips congestion alert without throwing', () => {
    const input: ProactiveAlertInput = {
      ...defaultInput,
      currentRoute: undefined,
    };

    expect(() => evaluateProactiveAlerts(input)).not.toThrow();
    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(0);
  });

  it('Priority sorting: multiple triggers are sorted priority-first (Priority 1 before Priority 2)', () => {
    const timelineWithLatePeak: DensityFrame[] = [
      ...mockTimeline,
      {
        atSec: 6700, // 5800 + 900
        density: { 'gate-a': 0.8, 'gate-b': 0.1, 'gate-c': 0.1, 'gate-d': 0.1 },
      },
    ];

    const input: ProactiveAlertInput = {
      ...defaultInput,
      timeline: timelineWithLatePeak,
      matchClockSec: 5800, // Late regulation
      currentRoute: { path: ['sec-101', 'gate-a'], etaSec: 300, targetGate: 'gate-a' },
      fanContext: { ...defaultInput.fanContext, leavingEarly: true },
    };

    const alerts = evaluateProactiveAlerts(input);
    expect(alerts.length).toBe(2);
    expect(alerts[0].priority).toBe(1); // Egress warning first
    expect(alerts[1].priority).toBe(2); // Congestion alert second
  });
});
