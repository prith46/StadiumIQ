import * as React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Copilot } from './Copilot';
import { useSimStore } from '@/lib/store/simStore';

describe('Copilot React Component', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());

    useSimStore.setState({
      matchClockSec: 600,
      density: { 'sec-101': 0.4 },
      gateStatus: { 'gate-a': 'open' as const },
      incidents: [],
      timeline: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders input, submits query, and injects the reply into the same chat thread as a normal message', async () => {
    const mockFetch = vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: 'MetLife Stadium is currently stable. A minor congestion risk is present.',
        topRisks: [
          { description: 'Queue building up', zoneId: 'sec-101', priority: 2 }
        ],
        recommendedActions: ['Monitor gate-a closely.']
      }),
    } as any);

    render(<Copilot />);

    const input = screen.getByPlaceholderText(/Ask copilot:/i);
    const submitBtn = screen.getByTestId('copilot-submit-btn');

    act(() => {
      fireEvent.change(input, { target: { value: 'what are my risks' } });
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/copilot', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('what are my risks'),
    }));

    // The user's own query appears as a chat bubble too (same thread).
    expect(screen.getByText('what are my risks')).toBeInTheDocument();

    // Assistant reply renders as one message's text, not a separate fixed block.
    expect(screen.getByText(/MetLife Stadium is currently stable/)).toBeInTheDocument();
    expect(screen.getByText(/Queue building up/)).toBeInTheDocument();
    expect(screen.getByText(/Monitor gate-a closely\./)).toBeInTheDocument();
  });

  it('injects the forecast result into the chat thread when the header forecast button is clicked', async () => {
    const mockFetch = vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        peakAtSec: 1500,
        topZones: [{ zoneId: 'sec-101', density: 0.85 }],
        narrative: 'A peak crowd of 85% is predicted in 15 minutes.',
        staffingRecommendation: 'Deploy extra stewards to sec-101.'
      }),
    } as any);

    render(<Copilot />);

    const forecastBtn = screen.getByTestId('copilot-forecast-btn');

    await act(async () => {
      fireEvent.click(forecastBtn);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/copilot', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"type":"forecast"'),
    }));

    // All of narrative, peak time, top zones, and staffing advice render as
    // part of one assistant chat message — not separate cards.
    expect(screen.getByText(/A peak crowd of 85% is predicted in 15 minutes\./)).toBeInTheDocument();
    expect(screen.getByText(/Clock 25:00/)).toBeInTheDocument(); // 1500s is 25:00
    expect(screen.getByText(/sec-101: 85% Density/)).toBeInTheDocument();
    expect(screen.getByText(/Deploy extra stewards to sec-101\./)).toBeInTheDocument();
  });

  it('never renders a raw unrounded float in the forecast peak time (Fix 7)', async () => {
    const mockFetch = vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        peakAtSec: 60.9990000000000023,
        topZones: [],
        narrative: 'Peak crush predicted shortly.',
        staffingRecommendation: 'Hold current staffing levels.'
      }),
    } as any);

    render(<Copilot />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('copilot-forecast-btn'));
    });

    expect(mockFetch).toHaveBeenCalled();
    expect(screen.getByText(/Clock 01:00/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.999/)).not.toBeInTheDocument();
  });

  it('displays a warning banner when the copilot request fails', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network disconnected'));

    render(<Copilot />);

    const forecastBtn = screen.getByTestId('copilot-forecast-btn');

    await act(async () => {
      fireEvent.click(forecastBtn);
    });

    expect(screen.getByTestId('copilot-error')).toBeInTheDocument();
    expect(screen.getByText('Network disconnected')).toBeInTheDocument();
  });
});
