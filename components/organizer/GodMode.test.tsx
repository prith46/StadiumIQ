import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GodMode } from './GodMode';
import { useSimStore } from '@/lib/store/simStore';
import { ZONES } from '@/lib/venue/venue';

describe('God Mode React Component', () => {
  beforeEach(() => {
    // Start with clean store state
    useSimStore.getState().reset(ZONES);
  });

  it('renders all buttons and indicates baseline by default', () => {
    render(<GodMode />);

    expect(screen.getByText('Active: Baseline Model')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Train Bottleneck/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gate Closure/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Emergency/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset Baseline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset Baseline/i })).toBeDisabled();
  });

  it('activates Train Bottleneck scenario and sets active styling', () => {
    render(<GodMode />);

    const trainBtn = screen.getByRole('button', { name: /Train Bottleneck/i });
    
    act(() => {
      fireEvent.click(trainBtn);
    });

    // Active indicator updates
    expect(screen.getByText('Active: Train Bottleneck')).toBeInTheDocument();

    // Check store updated
    const state = useSimStore.getState();
    expect(state.density['transit-train']).toBe(0.95);
    expect(state.gateStatus['gate-b']).toBe('congested');

    // Reset button is now enabled
    const resetBtn = screen.getByRole('button', { name: /Reset Baseline/i });
    expect(resetBtn).toBeEnabled();
  });

  it('resets simulator state back to baseline on reset click', () => {
    render(<GodMode />);

    const emergencyBtn = screen.getByRole('button', { name: /Emergency/i });
    const resetBtn = screen.getByRole('button', { name: /Reset Baseline/i });

    act(() => {
      fireEvent.click(emergencyBtn);
    });

    expect(useSimStore.getState().incidents.length).toBe(1);

    act(() => {
      fireEvent.click(resetBtn);
    });

    expect(screen.getByText('Active: Baseline Model')).toBeInTheDocument();
    expect(useSimStore.getState().incidents.length).toBe(0);
    expect(resetBtn).toBeDisabled();
  });
});
