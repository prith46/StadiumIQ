import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { IncentiveStack } from '../../components/incentives/IncentiveStack';
import { useSimStore } from '../../lib/store/simStore';
import { useIncentiveStore } from '../../lib/store/incentiveStore';
import { dispatchMapActions, StadiumMapHandle } from '../../lib/assistant/mapActionDispatcher';
import { ZONES } from '../../lib/venue/venue';

// 1. Mock mapActionDispatcher to assert actions on accept click
vi.mock('../../lib/assistant/mapActionDispatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/assistant/mapActionDispatcher')>();
  return {
    ...actual,
    dispatchMapActions: vi.fn().mockResolvedValue(undefined),
  };
});

// 2. Mock qrcode to avoid canvas errors in JSDOM environment
vi.mock('qrcode', () => {
  return {
    default: {
      toCanvas: vi.fn((canvas, text, options, cb) => {
        if (cb) cb(null);
      }),
    },
  };
});

describe('IncentiveStack Component & Reactive Ticking Tests', () => {
  const mapRef = createRef<StadiumMapHandle>();

  beforeEach(() => {
    // Reset Zustand stores
    useSimStore.getState().reset(ZONES);
    useIncentiveStore.getState().reset();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // 1. Countdown Derived from sim-clock matchClockSec (not Date.now)
  // ---------------------------------------------------------------------------

  it('renders countdown reactively based on matchClockSec, and guards against wall-clock drift', () => {
    const mockIncentive = {
      id: 'incentive-gate-a-1300',
      fromZone: 'gate-a',
      toZone: 'sec-114', // MAP BUILD SPEC §22.7: 'concourse-1-w' no longer exists (concourse nodes are now per-section, con-<sectionId>); sec-114 is a real w-stand tier-1 section.
      reward: '10% off FIFA Store T1 West',
      qrPayload: 'test-qr-payload',
      expiresAt: 1300,
    };

    // Initialize store state
    act(() => {
      useSimStore.setState({ matchClockSec: 1000 }); // 300s remaining
      useIncentiveStore.setState({ activeIncentives: [mockIncentive] });
    });

    render(<IncentiveStack mapRef={mapRef} />);

    // Verify initial simulated time remaining: 300 seconds => 5:00
    expect(screen.getByText('5:00')).toBeDefined();

    // REGRESSION GUARD: Pass real wall clock time without changing matchClockSec
    act(() => {
      vi.advanceTimersByTime(2000); // 2 seconds pass in the real world
    });
    // The countdown MUST still read 5:00 because matchClockSec has NOT advanced
    expect(screen.getByText('5:00')).toBeDefined();

    // Now advance matchClockSec to 1120 (180s simulated time remaining => 3:00)
    act(() => {
      useSimStore.setState({ matchClockSec: 1120 });
    });
    expect(screen.getByText('3:00')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 2. Expiry Dimming & Auto-Dismiss Grace Period
  // ---------------------------------------------------------------------------

  it('enters expired state at expiresAt, and auto-dismisses after 10s grace period', () => {
    const mockIncentive = {
      id: 'incentive-gate-a-1300',
      fromZone: 'gate-a',
      toZone: 'sec-114', // MAP BUILD SPEC §22.7: 'concourse-1-w' no longer exists (concourse nodes are now per-section, con-<sectionId>); sec-114 is a real w-stand tier-1 section.
      reward: '10% off FIFA Store T1 West',
      qrPayload: 'test-qr-payload',
      expiresAt: 1300,
    };

    act(() => {
      useSimStore.setState({ matchClockSec: 1000 });
      useIncentiveStore.setState({ activeIncentives: [mockIncentive] });
    });

    render(<IncentiveStack mapRef={mapRef} />);

    // 1. Advance exactly to expiry (1300s)
    act(() => {
      useSimStore.setState({ matchClockSec: 1300 });
    });
    // Displays 0:00 and the Expired tag should render
    expect(screen.getByText('0:00')).toBeDefined();
    expect(screen.getByText('Expired')).toBeDefined();

    // 2. Advance past the 10s simulated grace period (1311s)
    act(() => {
      useSimStore.setState({ matchClockSec: 1311 });
    });

    // Run pending timers (for Framer Motion exit fade out)
    act(() => {
      vi.runAllTimers();
    });

    // The card has auto-dismissed and is no longer in active list
    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Dispatching Map Actions on Accept Click
  // ---------------------------------------------------------------------------

  it('triggers dispatchMapActions routing to the reward POI when card is clicked', () => {
    const mockIncentive = {
      id: 'incentive-gate-a-1300',
      fromZone: 'gate-a', // standard open gate
      toZone: 'sec-114', // MAP BUILD SPEC §22.7: 'concourse-1-w' no longer exists (concourse nodes are now per-section, con-<sectionId>); sec-114 is a real w-stand tier-1 section.
      reward: '10% off FIFA Store T1 West',
      qrPayload: 'test-qr-payload',
      expiresAt: 1300,
    };

    act(() => {
      useSimStore.setState({
        matchClockSec: 1000,
        gateStatus: { 'gate-a': 'open', 'gate-b': 'open' },
      });
      useIncentiveStore.setState({ activeIncentives: [mockIncentive] });
    });

    render(<IncentiveStack mapRef={mapRef} />);

    const button = screen.getByRole('button', { name: 'View Clear Reroute' });
    fireEvent.click(button);

    // Confirm dispatchMapActions called with route, highlight and pin operations
    expect(dispatchMapActions).toHaveBeenCalled();
    const calls = vi.mocked(dispatchMapActions).mock.calls;
    expect(calls.length).toBe(1);

    const firstArg = calls[0][0];
    expect(firstArg).toContainEqual(
      expect.objectContaining({ op: 'route' })
    );
    expect(firstArg).toContainEqual(
      expect.objectContaining({ op: 'highlight', zoneId: 'sec-114' })
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Independent Multi-Incentive Management
  // ---------------------------------------------------------------------------

  it('supports multiple simultaneous incentives with independent dismiss states', () => {
    const inc1 = {
      id: 'incentive-gate-a-1300',
      fromZone: 'gate-a',
      toZone: 'sec-114', // MAP BUILD SPEC §22.7: 'concourse-1-w' no longer exists (concourse nodes are now per-section, con-<sectionId>); sec-114 is a real w-stand tier-1 section.
      reward: '10% off FIFA Store T1 West',
      qrPayload: 'test-qr-payload-1',
      expiresAt: 1300,
    };

    const inc2 = {
      id: 'incentive-gate-b-1400',
      fromZone: 'gate-b',
      toZone: 'concourse-2-e',
      reward: 'Free drink at Concourse Grill',
      qrPayload: 'test-qr-payload-2',
      expiresAt: 1400,
    };

    act(() => {
      useSimStore.setState({ matchClockSec: 1000 });
      useIncentiveStore.setState({ activeIncentives: [inc1, inc2] });
    });

    render(<IncentiveStack mapRef={mapRef} />);

    // Both cards should be rendered
    expect(screen.getByText('10% off FIFA Store T1 West')).toBeDefined();
    expect(screen.getByText('Free drink at Concourse Grill')).toBeDefined();

    // Dismiss only the first incentive
    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissButtons[0]);

    act(() => {
      vi.runAllTimers();
    });

    // The first card should be removed, but the second card must survive
    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('incentive-gate-b-1400');
  });

  // ---------------------------------------------------------------------------
  // 5. Dynamic Routing at Accept Time (M9 Follow-up)
  // ---------------------------------------------------------------------------

  it('computes the accepted route dynamically using live state at accept time', () => {
    const mockIncentive = {
      id: 'incentive-sec-101-transit',
      fromZone: 'sec-101',
      toZone: 'transit-train',
      reward: '10% off concession',
      qrPayload: 'test-qr-payload',
      expiresAt: 1300,
    };

    // 1. Initial State: no congestion
    act(() => {
      useSimStore.setState({
        matchClockSec: 1000,
        density: {},
        routedLoad: {},
        gateStatus: { 'gate-a': 'open', 'gate-b': 'open', 'gate-c': 'open', 'gate-d': 'open' },
      });
      useIncentiveStore.setState({ activeIncentives: [mockIncentive] });
    });

    const { unmount } = render(<IncentiveStack mapRef={mapRef} />);

    // Click CTA button
    const button = screen.getByRole('button', { name: 'View Clear Reroute' });
    fireEvent.click(button);

    expect(dispatchMapActions).toHaveBeenCalled();
    const calls1 = vi.mocked(dispatchMapActions).mock.calls;
    expect(calls1.length).toBe(1);
    const initialRouteAction = calls1[0][0].find((x) => x.op === 'route');
    expect(initialRouteAction).toBeDefined();
    const initialPath = initialRouteAction?.path;
    expect(initialPath).toBeDefined();

    // Find the gate that was used in this clear route
    const clearGate = [...(initialPath || [])].reverse().find((id) => id.startsWith('gate-'));
    expect(clearGate).toBeDefined();

    if (clearGate) {
      // Clean up mock calls & unmount to render fresh state
      vi.clearAllMocks();
      unmount();

      // 2. Introduce herding load on the chosen gate
      act(() => {
        useSimStore.setState({
          matchClockSec: 1000,
          density: {},
          routedLoad: { [clearGate]: 30.0 }, // high herding load
          gateStatus: { 'gate-a': 'open', 'gate-b': 'open', 'gate-c': 'open', 'gate-d': 'open' },
        });
        useIncentiveStore.setState({ activeIncentives: [mockIncentive] });
      });

      render(<IncentiveStack mapRef={mapRef} />);

      // Click accept again
      const button2 = screen.getByRole('button', { name: 'View Clear Reroute' });
      fireEvent.click(button2);

      const calls2 = vi.mocked(dispatchMapActions).mock.calls;
      expect(calls2.length).toBe(1);
      const congestedRouteAction = calls2[0][0].find((x) => x.op === 'route');
      expect(congestedRouteAction).toBeDefined();
      const congestedPath = congestedRouteAction?.path;

      // MAP BUILD SPEC §22.7: transit-train now connects to exactly ONE nearest
      // gate (previously it could connect to 2, allowing a reroute around
      // herding load). With only one physical edge into transit-train, the
      // congested run must still traverse the same gate — there is nowhere
      // else to go. (ETA inflation under this same herding load is proven
      // directly against the pure engine in routingService.test.ts, since the
      // dispatched map action here doesn't carry etaSec.)
      expect(congestedPath).toContain(clearGate);
      expect(congestedPath).toEqual(initialPath);
    }
  });
});
