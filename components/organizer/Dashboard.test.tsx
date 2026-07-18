import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import { useSimStore } from '@/lib/store/simStore';
import { useAlertStore } from '@/lib/store/alertStore';

// Mock prefers-reduced-motion to false
vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("framer-motion")>();
  return {
    ...original,
    useReducedMotion: () => false,
  };
});

describe('Dashboard Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    
    // Clear simulator state
    useSimStore.setState({
      matchClockSec: 600,
      incidents: [],
      gateStatus: {
        'gate-a': 'open',
        'gate-b': 'open',
        'gate-c': 'open',
        'gate-d': 'open',
      },
      sos: { active: false, triggeredBy: null, triggeredAtSec: 0 },
      fanContext: {
        language: 'en',
        location: 'sec-101',
        accessibility: false,
      },
    });

    // Clear alert store state
    useAlertStore.setState({
      activeAlerts: [],
      dismissedAlertIds: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders title, quick metrics, and coming soon placeholders', () => {
    render(<Dashboard />);

    // Renders Console Header
    expect(screen.getByText('StadiumIQ Ops Console')).toBeInTheDocument();

    // Renders coming soon labels, Dispatch Queue, Copilot, God Mode, and Upload panel
    expect(screen.queryByText('Coming in M17')).toBeNull();
    expect(screen.getByTestId('dispatch-queue-container')).toBeInTheDocument();
    expect(screen.queryByText('Coming in M18')).toBeNull();
    expect(screen.getByTestId('copilot-container')).toBeInTheDocument();
    expect(screen.queryByText('Coming in M19')).toBeNull();
    expect(screen.getByTestId('god-mode-container')).toBeInTheDocument();
    expect(screen.getByTestId('upload-panel-container')).toBeInTheDocument();

    // Renders total section counts
    expect(screen.getByText('60')).toBeInTheDocument();
  });

  it('formats the match clock as MM:SS during normal play (positive matchClockSec)', () => {
    useSimStore.setState({ matchClockSec: 605 }); // 10:05
    render(<Dashboard />);
    expect(screen.getByText('10:05')).toBeInTheDocument();
  });

  it('never displays a raw negative match clock and instead shows a "Kickoff in" countdown pre-match', () => {
    useSimStore.setState({ matchClockSec: -1800 }); // MATCH_START_SEC — 30 min before kickoff
    render(<Dashboard />);

    // The exact malformed string this bug produced must never appear.
    expect(screen.queryByText('-30:00')).toBeNull();
    expect(screen.queryByText(/^-\d/)).toBeNull();

    expect(screen.getByText('Kickoff in 30:00')).toBeInTheDocument();
  });

  it('formats a non-round negative match clock correctly (no negative minutes/seconds)', () => {
    useSimStore.setState({ matchClockSec: -95 }); // 1 min 35 sec before kickoff
    render(<Dashboard />);
    expect(screen.getByText('Kickoff in 01:35')).toBeInTheDocument();
  });

  it('renders calm empty state when no incidents are active', () => {
    render(<Dashboard />);
    expect(screen.getByTestId('calm-no-incidents')).toBeInTheDocument();
    expect(screen.getByText(/No active incidents\. MetLife Stadium operations running smoothly\./i)).toBeInTheDocument();
  });

  it('renders active alerts from the alertStore', () => {
    useAlertStore.setState({
      activeAlerts: [
        {
          id: 'alert-1',
          kind: 'ops',
          priority: 2,
          title: 'Gate A Congestion',
          body: 'High delay detected at Gate A. Diverting fans.',
          zoneId: 'gate-a',
          createdAt: 600,
        },
      ],
    });

    render(<Dashboard />);

    expect(screen.getByText('Gate A Congestion')).toBeInTheDocument();
    expect(screen.getByText('High delay detected at Gate A. Diverting fans.')).toBeInTheDocument();
  });

  it('reflects an active incident in the Operations Alerts Feed instead of showing "No active alerts" (M16 item 10)', () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-999',
          type: 'medical',
          zoneId: 'sec-101',
          note: 'Fan collapsed in section 101 seat 5',
          status: 'pending',
          createdAt: 600,
        },
      ],
    });

    render(<Dashboard />);

    // The stale "operating normally" placeholder must NOT be shown while a
    // real, unresolved incident exists.
    expect(screen.queryByText('No active alerts')).toBeNull();
    expect(screen.queryByText('System is operating normally.')).toBeNull();

    // The incident must be surfaced as an alert card in the feed.
    expect(screen.getByText(/Medical incident — sec-101/i)).toBeInTheDocument();
    expect(screen.getByText('Fan collapsed in section 101 seat 5')).toBeInTheDocument();

    // Active Incidents KPI must agree with the feed (both read the same state).
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('stops showing a resolved incident in the Operations Alerts Feed', () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-1000',
          type: 'crowd',
          zoneId: 'gate-a',
          note: 'Crowd surge reported',
          status: 'resolved',
          createdAt: 600,
        },
      ],
    });

    render(<Dashboard />);

    expect(screen.queryByText(/Crowd incident — gate-a/i)).toBeNull();
    expect(screen.getByText('No active alerts')).toBeInTheDocument();
  });

  it('renders incident detail panel when clicking a zone with an active incident', async () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-123',
          type: 'medical',
          zoneId: 'sec-101',
          note: 'Fan collapsed in section 101 seat 5',
          status: 'pending',
          createdAt: 600,
        },
      ],
    });

    const { container } = render(<Dashboard />);

    // Click section 101 to activate zone click
    const section101 = container.querySelector('#sec-101');
    expect(section101).not.toBeNull();

    act(() => {
      fireEvent.click(section101!);
    });

    // Check if details are shown
    const detailPanel = screen.getByTestId('incident-detail-panel');
    expect(detailPanel).toBeInTheDocument();
    expect(within(detailPanel).getByText(/Fan collapsed in section 101 seat 5/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText('sec-101')).toBeInTheDocument();
    expect(within(detailPanel).getByText('medical')).toBeInTheDocument();

    // Click close to hide panel
    const closeBtn = screen.getByText('✕ Close');
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(screen.queryByTestId('incident-detail-panel')).not.toBeInTheDocument();
  });
});
