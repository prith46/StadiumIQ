import { describe, it, expect, beforeEach } from 'vitest';
import { useSimStore } from '../store/simStore';
import {
  getActiveForecastSource,
  getForecastService,
  getPeakCrushService,
  getForecastForAllZonesService,
} from './forecastService';
import type { DensityFrame } from '../types';

describe('Forecast Service Glue', () => {
  beforeEach(() => {
    // Reset simulation store
    useSimStore.getState().reset([]);
  });

  it('detects and constructs timeline source when timeline is present in the store', () => {
    const mockTimeline: DensityFrame[] = [
      {
        atSec: 100,
        density: { 'sec-101': 0.5 },
        gateStatus: {},
      },
    ];

    useSimStore.setState({
      timeline: mockTimeline,
      density: { 'sec-101': 0.1 },
    });

    const source = getActiveForecastSource();
    expect(source.kind).toBe('timeline');
    expect(source.kind === 'timeline' ? source.frames : []).toEqual(mockTimeline);
  });

  it('detects and constructs projection source when timeline is empty in the store', () => {
    useSimStore.setState({
      timeline: [],
      density: { 'sec-101': 0.4 },
    });

    const source = getActiveForecastSource();
    expect(source.kind).toBe('projection');
    expect(source.kind === 'projection' ? source.currentDensity['sec-101'] : 0).toBe(0.4);
  });

  it('correctly maps getForecastService calls through active source', () => {
    const mockTimeline: DensityFrame[] = [
      { atSec: 0, density: { 'sec-101': 0.3 }, gateStatus: {} },
      { atSec: 600, density: { 'sec-101': 0.9 }, gateStatus: {} },
    ];

    useSimStore.setState({
      matchClockSec: 0,
      timeline: mockTimeline,
    });

    // 10 minutes ahead = 600s
    const res = getForecastService('sec-101', 10);
    expect(res.zoneId).toBe('sec-101');
    expect(res.predictedDensity).toBeCloseTo(0.9, 5);
    expect(res.extrapolated).toBe(false);
  });

  it('correctly maps getPeakCrushService calls', () => {
    const mockTimeline: DensityFrame[] = [
      { atSec: 0, density: { 'sec-101': 0.3 }, gateStatus: {} },
      { atSec: 600, density: { 'sec-101': 0.9 }, gateStatus: {} },
      { atSec: 1200, density: { 'sec-101': 0.1 }, gateStatus: {} },
    ];

    useSimStore.setState({
      matchClockSec: 0,
      timeline: mockTimeline,
    });

    const peak = getPeakCrushService('sec-101', 30);
    expect(peak.peakMatchClockSec).toBe(600);
    expect(peak.peakDensity).toBeCloseTo(0.9, 5);
    expect(peak.minutesFromNow).toBe(10);
  });

  it('correctly maps getForecastForAllZonesService calls', () => {
    const mockTimeline: DensityFrame[] = [
      { atSec: 0, density: { 'sec-101': 0.3, 'sec-102': 0.5 }, gateStatus: {} },
      { atSec: 600, density: { 'sec-101': 0.9, 'sec-102': 0.1 }, gateStatus: {} },
    ];

    useSimStore.setState({
      matchClockSec: 0,
      timeline: mockTimeline,
    });

    const res = getForecastForAllZonesService(10);
    expect(res['sec-101']).toBeCloseTo(0.9, 5);
    expect(res['sec-102']).toBeCloseTo(0.1, 5);
  });
});
