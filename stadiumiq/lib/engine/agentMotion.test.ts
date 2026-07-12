import { describe, it, expect } from 'vitest';
import { spawnAgents, stepAgents, MAX_AGENTS } from './agentMotion';
import { ZONES } from '../venue/venue';

describe('agentMotion', () => {
  it('respects the MAX_AGENTS cap even when density would demand more', () => {
    const density: Record<string, number> = {};
    for (const zone of ZONES) {
      density[zone.id] = 1; // maximal density everywhere -> heavy demand
    }

    const agents = spawnAgents(density, 42);

    expect(agents.length).toBeLessThanOrEqual(MAX_AGENTS);
    expect(agents.length).toBeGreaterThan(0);
  });

  it('moves agents (position changes) between steps given nonzero velocity', () => {
    const zoneId = ZONES.find((z) => z.type === 'section')!.id;
    const agents = [{ id: 0, x: 100, y: 100, vx: 5, vy: 5, zoneId }];

    const stepped = stepAgents(agents, { [zoneId]: 0.2 }, 100);

    expect(stepped[0].x).not.toBe(100);
    expect(stepped[0].y).not.toBe(100);
  });

  it('produces a deterministic spawn given the same seed', () => {
    const zoneId = ZONES.find((z) => z.type === 'section')!.id;
    const density = { [zoneId]: 0.8 };

    const first = spawnAgents(density, 7);
    const second = spawnAgents(density, 7);

    expect(second).toEqual(first);
  });
});
