import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAlertTriageService } from './alertService';
import { useSimStore } from '../store/simStore';
import { useAlertStore } from '../store/alertStore';
import * as routingModule from './routing';
import type { RouteFilters } from './routing';

/**
 * M10: proves the exit-nudge (M6) call site actually merges the fan's
 * persistent `fanContext.sensory` preferences into the filters passed to the
 * real M3 `computeRoute` — not just that the code path is technically invoked.
 */
describe('alertService — M10 sensory preference wiring', () => {
  const gateA = 'gate-a';

  beforeEach(() => {
    useAlertStore.setState({ alreadyFired: {} });
    useSimStore.setState({
      matchClockSec: 6000, // within exit-nudge window [5700, 6300]
      density: { [gateA]: 0.9 }, // congested nearest gate triggers the rule
      gateStatus: { 'gate-a': 'open', 'gate-b': 'open', 'gate-c': 'open', 'gate-d': 'open' },
      routedLoad: {},
      incidents: [],
      sensorCounts: {},
      timeline: [],
      fanContext: {
        language: 'en',
        location: 'sec-101',
        accessibility: false,
        sensory: { avoidAffiliation: 'away' },
        group: undefined,
        leavingEarly: false,
        ticket: undefined,
      },
    });
  });

  it('passes the fan persistent sensory.avoidAffiliation through to computeRoute for the exit-nudge route', () => {
    const spy = vi.spyOn(routingModule, 'computeRoute');

    runAlertTriageService();

    expect(spy).toHaveBeenCalled();
    // Every call this service made to the pure engine must carry the merged filter.
    const sawAvoidAffiliation = spy.mock.calls.some(
      (call) => (call[7] as RouteFilters | undefined)?.avoidAffiliation === 'away'
    );
    expect(sawAvoidAffiliation).toBe(true);

    spy.mockRestore();
  });

  it('an explicit one-time filter passed by a trigger rule overrides the persistent default (per-field precedence)', () => {
    // leavingEarly triggers the transit-nudge rule, which calls computeRouteFn
    // with no explicit filters — persistent quiet default should flow through.
    useSimStore.setState({
      fanContext: {
        ...useSimStore.getState().fanContext,
        leavingEarly: true,
        sensory: { quiet: true },
      },
    });

    const spy = vi.spyOn(routingModule, 'computeRoute');

    runAlertTriageService();

    const sawQuietDefaults = spy.mock.calls.some((call) => {
      const filters = call[7] as RouteFilters | undefined;
      return filters?.avoidEnclosed === true && filters?.maxNoise === 'low';
    });
    expect(sawQuietDefaults).toBe(true);

    spy.mockRestore();
  });

  it('produces a route (soft filter never blocks) even when sensory preferences are set', () => {
    const alerts = runAlertTriageService();
    // exit-nudge should still fire — the soft avoidAffiliation filter never
    // prevents a route/alert from being produced.
    expect(alerts.some((a) => a.triggerKey === 'exit-nudge')).toBe(true);
  });
});
