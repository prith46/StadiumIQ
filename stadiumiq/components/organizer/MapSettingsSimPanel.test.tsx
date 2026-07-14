import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MapSettingsSimPanel } from './MapSettingsSimPanel';
import { useSimStore } from '@/lib/store/simStore';
import { ZONES } from '@/lib/venue/venue';

describe('MapSettingsSimPanel', () => {
  beforeEach(() => {
    useSimStore.setState({
      density: Object.fromEntries(ZONES.map((z) => [z.id, 0.3])),
      manualDensityOverrides: {},
      manualGateStatusOverrides: {},
    });
  });

  it('manual density buttons override ONLY the selected zone (whole-map freeze regression)', () => {
    render(<MapSettingsSimPanel />);

    const select = screen.getByRole('combobox');
    act(() => {
      fireEvent.change(select, { target: { value: 'sec-105' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /medium \(0\.5\)/i }));
    });

    const overrides = useSimStore.getState().manualDensityOverrides;
    // The old bug spread the ENTIRE live density map into the patch, turning
    // every zone into a frozen manual override. Exactly one key may exist.
    expect(Object.keys(overrides)).toEqual(['sec-105']);
    expect(overrides['sec-105'].value).toBe(0.5);
    // Other zones' live density values are untouched.
    expect(useSimStore.getState().density['sec-101']).toBe(0.3);
    expect(useSimStore.getState().density['sec-105']).toBe(0.5);
  });
});
