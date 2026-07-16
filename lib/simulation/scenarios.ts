import { Scenario } from '../types';

/**
 * M19 God Mode preset scenarios.
 * Grounded in real MetLife Stadium zone/gate IDs from F2 venue layout.
 */
export const GOD_MODE_SCENARIOS: Scenario[] = [
  {
    id: 'train-bottleneck',
    label: 'Train Bottleneck',
    patch: {
      density: {
        'transit-train': 0.95,
        'gate-b': 0.90,
        'sec-102': 0.85,
        'sec-103': 0.80,
      },
      gateStatus: {
        'gate-b': 'congested',
      },
    },
  },
  {
    id: 'gate-closure',
    label: 'Gate Closure',
    patch: {
      gateStatus: {
        'gate-a': 'closed',
      },
      density: {
        'sec-115': 0.90,
        'sec-116': 0.90,
        'sec-101': 0.85,
        'sec-215': 0.85,
        'sec-216': 0.80,
      },
    },
  },
  {
    id: 'emergency',
    label: 'Emergency Evacuation',
    patch: {
      density: {
        'sec-101': 0.90,
        'sec-102': 0.90,
        'sec-103': 0.95,
        'sec-104': 0.95,
        'sec-105': 0.90,
        'sec-201': 0.85,
        'sec-202': 0.85,
        'sec-203': 0.85,
        'sec-301': 0.80,
        'sec-302': 0.80,
      },
      incidents: [
        {
          id: 'inc-god-emergency',
          type: 'evacuation',
          zoneId: 'sec-104',
          note: 'Emergency evacuation simulation active. Section 104 fire lane blockage.',
          status: 'pending',
          createdAt: 600,
        },
      ],
    },
  },
];
