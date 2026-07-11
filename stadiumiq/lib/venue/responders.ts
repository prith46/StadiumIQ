import { Responder } from '../types';

/**
 * M17 responder fixture data.
 * 8 responders spread acrossMetLife Stadium zones with varied skills.
 * One responder (resp-ops-2) is set to unavailable: false to test exclusion rules.
 */
export const RESPONDERS: Responder[] = [
  {
    id: 'resp-med-1',
    label: 'Medical Team Alpha',
    zoneId: 'sec-101',
    skills: ['medical'],
    available: true,
  },
  {
    id: 'resp-med-2',
    label: 'Medical Team Beta',
    zoneId: 'sec-112',
    skills: ['medical'],
    available: true,
  },
  {
    id: 'resp-sec-1',
    label: 'Security Unit A',
    zoneId: 'sec-205',
    skills: ['security', 'crowd'],
    available: true,
  },
  {
    id: 'resp-sec-2',
    label: 'Security Unit B',
    zoneId: 'sec-218',
    skills: ['security', 'evacuation'],
    available: true,
  },
  {
    id: 'resp-ast-1',
    label: 'Guest Services Team 1',
    zoneId: 'sec-305',
    skills: ['assistance'],
    available: true,
  },
  {
    id: 'resp-ast-2',
    label: 'Guest Services Team 2',
    zoneId: 'sec-318',
    skills: ['assistance'],
    available: true,
  },
  {
    id: 'resp-ops-1',
    label: 'Ops Crew Red',
    zoneId: 'gate-a',
    skills: ['crowd', 'evacuation'],
    available: true,
  },
  {
    id: 'resp-ops-2',
    label: 'Safety Officer Davis',
    zoneId: 'gate-c',
    skills: ['medical', 'assistance', 'security', 'evacuation', 'crowd'],
    available: false,
  },
];
