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

  it('renders input, submits query, and displays structured brief', async () => {
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

    // Verify loader and then final response rendering
    expect(mockFetch).toHaveBeenCalledWith('/api/copilot', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('what are my risks'),
    }));

    expect(screen.getByText('MetLife Stadium is currently stable. A minor congestion risk is present.')).toBeInTheDocument();
    expect(screen.getByText('"Queue building up"')).toBeInTheDocument();
    expect(screen.getByText('Monitor gate-a closely.')).toBeInTheDocument();
  });

  it('renders forecast response when Generate Forecast button is clicked', async () => {
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

    expect(screen.getByText('A peak crowd of 85% is predicted in 15 minutes.')).toBeInTheDocument();
    expect(screen.getByText('Clock 25:00')).toBeInTheDocument(); // 1500s is 25:00
    expect(screen.getByText('sec-101')).toBeInTheDocument();
    expect(screen.getByText('85% Density')).toBeInTheDocument();
    expect(screen.getByText('Deploy extra stewards to sec-101.')).toBeInTheDocument();
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
