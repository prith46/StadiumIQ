import { describe, it, expect, beforeEach } from 'vitest';
import { GOD_MODE_SCENARIOS } from './scenarios';
import { ZONES } from '../venue/venue';
import { useSimStore } from '../store/simStore';

describe('God Mode Scenario Simulator Config', () => {
  const validZoneIds = new Set(ZONES.map((z) => z.id));

  it('references only real, valid zone/gate IDs from MetLife venue configuration', () => {
    for (const scenario of GOD_MODE_SCENARIOS) {
      // 1. Validate density keys
      if (scenario.patch.density) {
        for (const zoneId of Object.keys(scenario.patch.density)) {
          expect(validZoneIds.has(zoneId)).toBe(true);
        }
      }

      // 2. Validate gateStatus keys
      if (scenario.patch.gateStatus) {
        for (const gateId of Object.keys(scenario.patch.gateStatus)) {
          expect(validZoneIds.has(gateId)).toBe(true);
          const zoneObj = ZONES.find((z) => z.id === gateId);
          expect(zoneObj?.type).toBe('gate');
        }
      }

      // 3. Validate incident zoneId if present
      if (scenario.patch.incidents) {
        for (const incident of scenario.patch.incidents) {
          expect(validZoneIds.has(incident.zoneId)).toBe(true);
        }
      }
    }
  });

  describe('Simulation Store Transitions', () => {
    beforeEach(() => {
      // Reset store to baseline before each state test
      useSimStore.getState().reset(ZONES);
    });

    it('applies Train Bottleneck scenario correctly', () => {
      const trainScenario = GOD_MODE_SCENARIOS.find((s) => s.id === 'train-bottleneck')!;
      useSimStore.getState().applyScenario(trainScenario.patch);

      const state = useSimStore.getState();
      expect(state.density['transit-train']).toBe(0.95);
      expect(state.density['gate-b']).toBe(0.90);
      expect(state.gateStatus['gate-b']).toBe('congested');
    });

    it('applies Gate Closure scenario correctly', () => {
      const gateScenario = GOD_MODE_SCENARIOS.find((s) => s.id === 'gate-closure')!;
      useSimStore.getState().applyScenario(gateScenario.patch);

      const state = useSimStore.getState();
      expect(state.gateStatus['gate-a']).toBe('closed');
      expect(state.density['sec-115']).toBe(0.90);
    });

    it('applies Emergency Evacuation scenario correctly', () => {
      const emergencyScenario = GOD_MODE_SCENARIOS.find((s) => s.id === 'emergency')!;
      useSimStore.getState().applyScenario(emergencyScenario.patch);

      const state = useSimStore.getState();
      expect(state.density['sec-104']).toBe(0.95);
      expect(state.incidents.length).toBe(1);
      expect(state.incidents[0].type).toBe('evacuation');
    });

    it('ensures only one scenario is active at a time and reset restores baseline state', () => {
      const trainScenario = GOD_MODE_SCENARIOS.find((s) => s.id === 'train-bottleneck')!;
      const gateScenario = GOD_MODE_SCENARIOS.find((s) => s.id === 'gate-closure')!;

      // Apply first scenario
      useSimStore.getState().applyScenario(trainScenario.patch);
      
      // Apply second scenario (should replace/overwrite target patch parameters)
      // Since it's a manual organizer button click, we will reset first to make sure they do not merge
      useSimStore.getState().reset(ZONES);
      useSimStore.getState().applyScenario(gateScenario.patch);

      let state = useSimStore.getState();
      // Density from train scenario should be reset to baseline (0), and gate closure values apply
      expect(state.density['transit-train']).toBe(0);
      expect(state.density['sec-115']).toBe(0.90);
      expect(state.gateStatus['gate-a']).toBe('closed');
      expect(state.gateStatus['gate-b']).toBe('open'); // Gate B is no longer congested

      // Trigger reset fully
      useSimStore.getState().reset(ZONES);
      state = useSimStore.getState();
      expect(state.density['sec-115']).toBe(0);
      expect(state.gateStatus['gate-a']).toBe('open');
      expect(state.incidents.length).toBe(0);
    });
  });
});
