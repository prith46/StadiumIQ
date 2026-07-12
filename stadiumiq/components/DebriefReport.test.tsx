import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DebriefReport } from './organizer/DebriefReport';
import { useSimStore } from '@/lib/store/simStore';

describe('DebriefReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables the Generate Debrief button before full-time', () => {
    useSimStore.setState({
      matchClockSec: 600, // firstHalf
      density: {},
      gateStatus: {},
      incidents: [],
      timeline: [],
    });

    render(<DebriefReport />);

    expect(screen.getByTestId('generate-debrief-btn')).toBeDisabled();
  });

  it('shows a loading state while generating', async () => {
    useSimStore.setState({
      matchClockSec: 7000, // fullTime
      density: {},
      gateStatus: {},
      incidents: [],
      timeline: [],
    });

    let resolveFetch: (value: any) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(global.fetch).mockReturnValue(pending as any);

    render(<DebriefReport />);

    const btn = screen.getByTestId('generate-debrief-btn');
    expect(btn).not.toBeDisabled();

    act(() => {
      fireEvent.click(btn);
    });

    expect(screen.getByTestId('debrief-loading')).toBeInTheDocument();

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ report: '## Summary\nAll clear.' }) });
    });
  });

  it('renders the mocked report', async () => {
    useSimStore.setState({
      matchClockSec: 7000,
      density: {},
      gateStatus: {},
      incidents: [],
      timeline: [],
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ report: '## Summary\nOperations ran smoothly with one bottleneck.' }),
    } as any);

    render(<DebriefReport />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-debrief-btn'));
    });

    expect(screen.getByTestId('debrief-report-content')).toBeInTheDocument();
    expect(screen.getByText('Operations ran smoothly with one bottleneck.')).toBeInTheDocument();
  });

  it('renders an error state on failure', async () => {
    useSimStore.setState({
      matchClockSec: 7000,
      density: {},
      gateStatus: {},
      incidents: [],
      timeline: [],
    });

    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as any);

    render(<DebriefReport />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-debrief-btn'));
    });

    expect(screen.getByTestId('debrief-error')).toBeInTheDocument();
    expect(screen.getByTestId('debrief-retry-btn')).toBeInTheDocument();
  });
});
