import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DispatchQueue } from './DispatchQueue';
import { useSimStore } from '@/lib/store/simStore';

// The AI report is generated server-side via /api/incident-report — mock fetch.
const fetchSpy = vi.fn();

describe('DispatchQueue Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);

    useSimStore.setState({
      matchClockSec: 600,
      density: {},
      routedLoad: {},
      gateStatus: {},
      incidents: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders a calm empty state when no incidents are in queue', () => {
    render(<DispatchQueue />);
    expect(screen.getByTestId('dispatch-empty-state')).toBeInTheDocument();
  });

  it('renders incidents and handles dispatch assignment correctly', async () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-001',
          type: 'medical',
          zoneId: 'sec-105',
          note: 'Medical issue in lower tier',
          status: 'pending',
          createdAt: 200,
        },
      ],
    });

    render(<DispatchQueue />);

    // Renders the pending incident notes (typographic quotes in the JSX)
    expect(screen.getByText('“Medical issue in lower tier”')).toBeInTheDocument();
    
    // Finds the assign responder button
    const assignBtn = screen.getByRole('button', { name: /assign nearest responder/i });
    expect(assignBtn).toBeInTheDocument();

    act(() => {
      fireEvent.click(assignBtn);
    });

    // Check store updated: status should become dispatched and responder assigned
    const storeIncidents = useSimStore.getState().incidents;
    expect(storeIncidents[0].status).toBe('dispatched');
    expect(storeIncidents[0].responderId).toBe('resp-med-1'); // sec-101 is nearest to sec-105 (lower tier)
    expect(storeIncidents[0].etaSec).toBeDefined();
  });

  it('renders the SLA Breach badge fully intact (not clipped) alongside ETA and responder info (M16 item 11)', () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-breach',
          type: 'medical',
          zoneId: 'sec-105',
          note: 'Medical issue in lower tier',
          status: 'dispatched',
          createdAt: 200,
          responderId: 'resp-med-1',
          etaSec: 400, // > 300s SLA threshold — must trigger the breach badge
        },
      ],
    });

    render(<DispatchQueue />);

    // The full, untruncated badge text must be present as a single text node
    // — a truncated render (the reported "SLA BREA[CH]" bug) would fail this.
    const breachBadge = screen.getByText('SLA Breach');
    expect(breachBadge).toBeInTheDocument();
    // Must not be allowed to wrap/clip mid-word.
    expect(breachBadge.className).toContain('whitespace-nowrap');

    // ETA value and responder name must both still be present and legible
    // (not overlapping/replaced by the badge).
    expect(screen.getByText('400s')).toBeInTheDocument();
    expect(screen.getByText('Medical Team Alpha')).toBeInTheDocument();
  });

  it('handles resolved incident transition and fetches LLM report summary', async () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-002',
          type: 'assistance',
          zoneId: 'sec-308',
          note: 'Blocked stairs',
          status: 'dispatched',
          createdAt: 400,
          responderId: 'resp-ast-1',
          etaSec: 45,
        },
      ],
    });

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        report: 'AI Audit Summary: Blocked stairs resolved by Guest Services Team 1.',
      }),
    });

    render(<DispatchQueue />);

    const resolveBtn = screen.getByRole('button', { name: /mark as resolved/i });
    expect(resolveBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(resolveBtn);
    });

    // Verify the server-side report generation was requested
    expect(fetchSpy).toHaveBeenCalledWith('/api/incident-report', expect.any(Object));

    // Verify incident updated in store to resolved
    const storeIncidents = useSimStore.getState().incidents;
    expect(storeIncidents[0].status).toBe('resolved');

    // Verify the report text appears inline
    expect(screen.getByText('AI Post-Incident Report Summary')).toBeInTheDocument();
    expect(screen.getByText('AI Audit Summary: Blocked stairs resolved by Guest Services Team 1.')).toBeInTheDocument();
  });

  it('does not drop incidents created while the resolve report fetch is in flight (stale-closure regression)', async () => {
    useSimStore.setState({
      incidents: [
        {
          id: 'inc-race',
          type: 'assistance',
          zoneId: 'sec-308',
          note: 'Blocked stairs',
          status: 'dispatched',
          createdAt: 400,
          responderId: 'resp-ast-1',
          etaSec: 45,
        },
      ],
    });

    // Hold the report fetch open until we've injected a new incident.
    let releaseFetch: () => void = () => {};
    fetchSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFetch = () =>
            resolve({ ok: true, json: async () => ({ report: 'done' }) });
        })
    );

    render(<DispatchQueue />);
    const resolveBtn = screen.getByRole('button', { name: /mark as resolved/i });

    await act(async () => {
      fireEvent.click(resolveBtn);
    });

    // While the report request is in flight, another incident arrives (e.g. a
    // sequencer auto-incident or a fan SOS from another tab).
    act(() => {
      useSimStore.setState({
        incidents: [
          ...useSimStore.getState().incidents,
          {
            id: 'inc-late',
            type: 'crowd',
            zoneId: 'sec-101',
            note: 'Arrived mid-flight',
            status: 'pending',
            createdAt: 410,
          },
        ],
      });
    });

    await act(async () => {
      releaseFetch();
    });

    // The fix reads the LIVE incidents list at resolve time — the mid-flight
    // incident must survive, and the original one must be resolved.
    const incidents = useSimStore.getState().incidents;
    expect(incidents.map((i) => i.id)).toContain('inc-late');
    expect(incidents.find((i) => i.id === 'inc-race')?.status).toBe('resolved');
  });
});
