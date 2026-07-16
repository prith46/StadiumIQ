import { describe, it, expect } from 'vitest';
import { evaluateStressEscalation, StressEscalationInput } from './stressEscalation';
import { FanContext, Incident } from '../types';

describe('Stress Escalation Engine', () => {
  const fanContext: FanContext = {
    language: 'en',
    location: 'sec-101',
    accessibility: false,
  };

  const defaultInput: Omit<StressEscalationInput, 'message'> = {
    fanContext,
    matchClockSec: 1200,
    existingIncidents: [],
  };

  it('returns null if no stress is detected', () => {
    const input: StressEscalationInput = {
      ...defaultInput,
      message: 'Hi, where is the nearest popcorn stand?',
    };

    const incident = evaluateStressEscalation(input);
    expect(incident).toBeNull();
  });

  it('returns a new incident if stress is detected and no prior recent incidents exist', () => {
    const input: StressEscalationInput = {
      ...defaultInput,
      message: 'HELP!! I am stuck in the turnstile',
    };

    const incident = evaluateStressEscalation(input);

    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('assistance');
    expect(incident!.zoneId).toBe('sec-101');
    expect(incident!.note).toBe('HELP!! I am stuck in the turnstile');
    expect(incident!.status).toBe('pending');
    expect(incident!.createdAt).toBe(1200);
  });

  it('returns high-severity medical incident for critical keywords', () => {
    const input: StressEscalationInput = {
      ...defaultInput,
      message: 'help me chest pain',
    };

    const incident = evaluateStressEscalation(input);

    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('medical');
  });

  it('returns null (deduped) if there is an active incident at the same location within the cooldown window', () => {
    const existingIncidents: Incident[] = [
      {
        id: 'inc-1',
        type: 'assistance',
        zoneId: 'sec-101',
        note: 'Stuck in turnstile',
        status: 'pending',
        createdAt: 1000,
      },
    ];

    // Attempting another stress report at sec-101 at clock 1200 (200s difference, within 300s cooldown)
    const input: StressEscalationInput = {
      ...defaultInput,
      matchClockSec: 1200,
      existingIncidents,
      message: 'Help, stuck again!',
    };

    const incident = evaluateStressEscalation(input);
    expect(incident).toBeNull(); // Deduplicated
  });

  it('allows creating a new incident if outside the cooldown window', () => {
    const existingIncidents: Incident[] = [
      {
        id: 'inc-1',
        type: 'assistance',
        zoneId: 'sec-101',
        note: 'Stuck in turnstile',
        status: 'pending',
        createdAt: 800,
      },
    ];

    // Attempting at clock 1200 (400s difference, outside 300s cooldown)
    const input: StressEscalationInput = {
      ...defaultInput,
      matchClockSec: 1200,
      existingIncidents,
      message: 'Help, stuck again!',
    };

    const incident = evaluateStressEscalation(input);
    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('assistance');
  });
});
