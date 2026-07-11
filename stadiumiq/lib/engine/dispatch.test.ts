import { describe, it, expect } from 'vitest';
import { assignResponder, isBreachPredicted } from './dispatch';
import { Incident, Responder } from '../types';

describe('Dispatch Assignment Engine', () => {
  const responders: Responder[] = [
    {
      id: 'resp-med-1',
      label: 'Medical Alpha',
      zoneId: 'sec-101',
      skills: ['medical'],
      available: true,
    },
    {
      id: 'resp-med-2',
      label: 'Medical Beta',
      zoneId: 'sec-112',
      skills: ['medical'],
      available: true,
    },
    {
      id: 'resp-ops-1',
      label: 'Ops Red',
      zoneId: 'gate-a',
      skills: ['medical', 'assistance'],
      available: false, // Unavailable
    },
  ];

  const dummyGraphDistance = (from: string, to: string) => {
    // Simple mock distances:
    // sec-101 -> sec-105 = 80s
    // sec-112 -> sec-105 = 200s
    if (from === 'sec-101' && to === 'sec-105') return 80;
    if (from === 'sec-112' && to === 'sec-105') return 200;
    if (from === 'gate-a') return 20; // Closest but unavailable!
    return Infinity;
  };

  it('assigns the closest available responder with the matching skill', () => {
    const incident: Incident = {
      id: 'inc-1',
      type: 'medical',
      zoneId: 'sec-105',
      note: 'Needs assistance',
      status: 'pending',
      createdAt: 100,
    };

    const assignment = assignResponder(incident, responders, dummyGraphDistance);

    expect(assignment.responderId).toBe('resp-med-1');
    expect(assignment.etaSec).toBe(80);
    expect(assignment.predictedBreach).toBe(false);
  });

  it('returns responderId null if no responder has matching skill', () => {
    const incident: Incident = {
      id: 'inc-2',
      type: 'security', // No responder has security skill
      zoneId: 'sec-105',
      note: 'Fight reported',
      status: 'pending',
      createdAt: 100,
    };

    const assignment = assignResponder(incident, responders, dummyGraphDistance);

    expect(assignment.responderId).toBeNull();
    expect(assignment.etaSec).toBeNull();
    expect(assignment.predictedBreach).toBe(false);
  });

  it('returns responderId null if all matching responders are unavailable', () => {
    const incident: Incident = {
      id: 'inc-3',
      type: 'assistance', // Only ops-1 has assistance, but it is unavailable
      zoneId: 'sec-105',
      note: 'Lost keys',
      status: 'pending',
      createdAt: 100,
    };

    const assignment = assignResponder(incident, responders, dummyGraphDistance);

    expect(assignment.responderId).toBeNull();
    expect(assignment.etaSec).toBeNull();
  });

  it('correctly calculates SLA breach boundaries', () => {
    expect(isBreachPredicted(299)).toBe(false);
    expect(isBreachPredicted(300)).toBe(false); // Exact boundary
    expect(isBreachPredicted(301)).toBe(true); // Exceeded
    expect(isBreachPredicted(150, 100)).toBe(true); // Custom SLA
  });
});
