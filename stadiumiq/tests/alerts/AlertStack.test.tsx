import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { AlertStack } from '@/components/alerts/AlertStack';
import { useSimStore } from '@/lib/store/simStore';
import { useAlertStore } from '@/lib/store/alertStore';
import { EXIT_FADE_MS } from '@/lib/venue/overlayAnimations';
import { dispatchMapActions, StadiumMapHandle } from '@/lib/assistant/mapActionDispatcher';
import { ZONES } from '@/lib/venue/venue';

// Mock mapActionDispatcher to assert action triggers
vi.mock('@/lib/assistant/mapActionDispatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assistant/mapActionDispatcher')>();
  return {
    ...actual,
    dispatchMapActions: vi.fn().mockResolvedValue(undefined),
  };
});

describe('AlertStack Component & Hook Integration', () => {
  const mapRef = createRef<StadiumMapHandle>();

  beforeEach(() => {
    // Reset stores to default state with real zones so gateStatus is populated
    useSimStore.getState().reset(ZONES);
    useAlertStore.getState().reset();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Cooldown Constant Verification
  // ---------------------------------------------------------------------------

  it('verifies the dismiss fade timing references the exact centralized constant EXIT_FADE_MS', () => {
    // Sourced from M5 timing configs
    expect(EXIT_FADE_MS).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // 2. Ticks, Triggering, and Rendering
  // ---------------------------------------------------------------------------

  it('triggers proactive alerts reactively on matchClockSec changes and displays AlertCards', () => {
    // Setup state: halftime, fan is at sec-101, concourse restroom density is low
    act(() => {
      useSimStore.setState({
        matchClockSec: 3000, // halftime
        density: { 'concourse-1-n': 0.1 },
        fanContext: {
          language: 'en',
          location: 'sec-101',
          accessibility: false,
        },
      });
    });

    render(<AlertStack mapRef={mapRef} />);

    // Since we set halftime and location, the hook useProactiveAlerts evaluates on render,
    // fires 'halftime-nudge' into the alert store, and renders it
    const alertTitle = screen.getByText('Avoid Restroom Rush');
    expect(alertTitle).toBeDefined();

    const alertBody = screen.getByText(/Heading to restroom/);
    expect(alertBody).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 3. Dismissal vs. Deduplication Independence
  // ---------------------------------------------------------------------------

  it('dismissing an alert removes it from the stack and prevents re-appearance on subsequent ticks', () => {
    vi.useFakeTimers();

    act(() => {
      useSimStore.setState({
        matchClockSec: 3000,
        density: { 'concourse-1-n': 0.1 },
        fanContext: { language: 'en', location: 'sec-101', accessibility: false },
      });
    });

    const { container } = render(<AlertStack mapRef={mapRef} />);

    // Initial alert matches
    expect(screen.queryByText('Avoid Restroom Rush')).not.toBeNull();

    // Trigger close button click
    const dismissButton = screen.getByLabelText('Dismiss alert');
    act(() => {
      fireEvent.click(dismissButton);
    });

    // During transition fade (100ms), alert is still in DOM (opacity: 0)
    act(() => {
      vi.advanceTimersByTime(EXIT_FADE_MS / 2);
    });
    expect(screen.queryByText('Avoid Restroom Rush')).not.toBeNull();

    // After full EXIT_FADE_MS, the timeout completes and removes it from activeAlerts
    act(() => {
      vi.advanceTimersByTime(EXIT_FADE_MS / 2 + 1);
    });
    expect(screen.queryByText('Avoid Restroom Rush')).toBeNull();

    // Trigger a subsequent tick (change matchClockSec to 3001) while trigger conditions are still true
    act(() => {
      useSimStore.setState({ matchClockSec: 3001 });
    });

    // The alert MUST NOT reappear because the dismissal registry retains the dismissed ID
    expect(screen.queryByText('Avoid Restroom Rush')).toBeNull();

    vi.useRealTimers();
  });

  it('a newly-generated alert (new id, same triggerKey) appears after cooldown even if prior was dismissed', () => {
    vi.useFakeTimers();

    // 1. Trigger first alert at clock 3000
    act(() => {
      useSimStore.setState({
        matchClockSec: 3000,
        density: { 'concourse-1-n': 0.1 },
        fanContext: { language: 'en', location: 'sec-101', accessibility: false },
      });
    });

    const { rerender } = render(<AlertStack mapRef={mapRef} />);
    expect(screen.queryByText('Avoid Restroom Rush')).not.toBeNull();

    // 2. Dismiss the alert (id: alert-halftime-nudge-3000)
    const dismissButton = screen.getByLabelText('Dismiss alert');
    act(() => {
      fireEvent.click(dismissButton);
      vi.advanceTimersByTime(EXIT_FADE_MS + 1);
    });
    expect(screen.queryByText('Avoid Restroom Rush')).toBeNull();

    // 3. Increment clock past the 180s cooldown window (3000 + 190 = 3190)
    act(() => {
      useSimStore.setState({
        matchClockSec: 3190,
      });
    });

    // Re-render
    rerender(<AlertStack mapRef={mapRef} />);

    // Since cooldown elapsed, a NEW alert is generated (id: alert-halftime-nudge-3190).
    // Because the new ID does not match the old dismissed ID, it MUST be rendered!
    expect(screen.queryByText('Avoid Restroom Rush')).not.toBeNull();

    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // 4. Action Button Behaviour
  // ---------------------------------------------------------------------------

  it('action button executes dispatchMapActions without removing the alert card', async () => {
    act(() => {
      useSimStore.setState({
        matchClockSec: 3000,
        density: { 'concourse-1-n': 0.1 },
        fanContext: { language: 'en', location: 'sec-101', accessibility: false },
      });
    });

    render(<AlertStack mapRef={mapRef} />);
    
    const showRouteBtn = screen.getByText('Show route');
    expect(showRouteBtn).toBeDefined();

    // Tapping the button dispatches action mapping
    act(() => {
      fireEvent.click(showRouteBtn);
    });

    expect(dispatchMapActions).toHaveBeenCalled();
    // Card remains visible (not dismissed)
    expect(screen.queryByText('Avoid Restroom Rush')).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 5. WAI-ARIA and Priority Styles
  // ---------------------------------------------------------------------------

  it('assigns role="alert" for high priority, role="status" for low priority alerts', () => {
    // Halftime nudge: priority 3
    act(() => {
      useSimStore.setState({
        matchClockSec: 3000,
        density: { 'concourse-1-n': 0.1 },
        fanContext: { language: 'en', location: 'sec-101', accessibility: false },
      });
    });

    const { container, rerender } = render(<AlertStack mapRef={mapRef} />);

    // Halftime nudge has priority 3, so its container should have role="status"
    const lowPriorityCard = container.querySelector('[role="status"]');
    expect(lowPriorityCard).not.toBeNull();

    // Clean up
    act(() => {
      useAlertStore.getState().reset();
    });

    // Exit nudge: priority 2 (late game [5700, 6300], gate-a density > 0.7)
    act(() => {
      useSimStore.setState({
        matchClockSec: 6000,
        density: {
          'gate-a': 0.8,
          'gate-b': 0.1,
        },
        fanContext: {
          language: 'en',
          location: 'sec-101',
          accessibility: false,
        },
      });
    });

    rerender(<AlertStack mapRef={mapRef} />);

    // Exit nudge has priority 2, so its container should have role="alert"
    const highPriorityCard = container.querySelector('[role="alert"]');
    expect(highPriorityCard).not.toBeNull();
  });
});
