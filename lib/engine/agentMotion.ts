import { ZONES } from '../venue/venue';
import { pt, cx, cy } from '../venue/geometry';
import { mulberry32 } from '../simulation/engine';
import type { Zone } from '../types';

// M28: hard cap on rendered crowd agents — non-negotiable given perf risk.
export const MAX_AGENTS = 300;

export interface Agent {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  zoneId: string;
}

const GOAL_ATTRACTION = 0.9; // per-second acceleration toward the zone's goal point
const REPULSION_RADIUS = 6; // px
const REPULSION_STRENGTH = 60; // per-second acceleration at zero distance
const BASE_MAX_SPEED = 14; // px/sec
const SPAWN_SCATTER_RADIUS = 8; // px, scatter around zone center at spawn

const zoneById = new Map<string, Zone>(ZONES.map((z) => [z.id, z]));

/**
 * Cosmetic display-only helper — NOT part of the routing/forecast/dispatch
 * engine pipeline. Reuses the venue's own zone-center geometry (mirrors
 * StadiumMap's internal `getZoneCenter`) purely as a goal point for agents to
 * drift toward; it never feeds back into density, forecast, or routing.
 */
function zoneCenter(zoneId: string): { x: number; y: number } {
  const zone = zoneById.get(zoneId);
  if (!zone || zone.id === 'field-center' || zone.type === 'field') {
    return { x: cx, y: cy };
  }
  const r = ((zone.rInner ?? 0) + (zone.rOuter ?? 0)) / 2;
  return pt(r, zone.angle ?? 0);
}

/**
 * Deterministic given the same `density` + `seed` — the seeded PRNG
 * (`mulberry32`, reused from `lib/simulation/engine.ts` unmodified) is only
 * consulted at spawn time, never per animation frame.
 */
export function spawnAgents(
  density: Record<string, number>,
  seed: number,
  maxAgents: number = MAX_AGENTS
): Agent[] {
  const zoneIds = Object.keys(density).filter((id) => zoneById.has(id));
  const totalDensity = zoneIds.reduce((sum, id) => sum + Math.max(0, density[id] ?? 0), 0);
  if (totalDensity <= 0 || zoneIds.length === 0) return [];

  const rand = mulberry32(seed);
  const agents: Agent[] = [];
  let id = 0;

  for (const zoneId of zoneIds) {
    if (agents.length >= maxAgents) break;
    const share = Math.max(0, density[zoneId] ?? 0) / totalDensity;
    const count = Math.min(Math.round(share * maxAgents), maxAgents - agents.length);
    const center = zoneCenter(zoneId);

    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = rand() * SPAWN_SCATTER_RADIUS;
      agents.push({
        id: id++,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        vx: (rand() - 0.5) * 2,
        vy: (rand() - 0.5) * 2,
        zoneId,
      });
    }
  }

  return agents;
}

/**
 * Per-tick agent motion: drifts each agent toward its zone's goal point with
 * lightweight nearest-neighbor repulsion (no full physics engine, no
 * per-agent pathfinding). `density` only damps top speed in crowded zones —
 * it is read, never written; this never feeds back into the authoritative
 * `density` state.
 */
export function stepAgents(agents: Agent[], density: Record<string, number>, deltaMs: number): Agent[] {
  const dt = Math.max(0, deltaMs) / 1000;
  if (dt === 0) return agents;

  return agents.map((agent, i) => {
    const goal = zoneCenter(agent.zoneId);
    let ax = (goal.x - agent.x) * GOAL_ATTRACTION;
    let ay = (goal.y - agent.y) * GOAL_ATTRACTION;

    for (let j = 0; j < agents.length; j++) {
      if (j === i) continue;
      const other = agents[j];
      const dx = agent.x - other.x;
      const dy = agent.y - other.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > 0 && distSq < REPULSION_RADIUS * REPULSION_RADIUS) {
        const dist = Math.sqrt(distSq);
        const force = ((REPULSION_RADIUS - dist) / REPULSION_RADIUS) * REPULSION_STRENGTH;
        ax += (dx / dist) * force;
        ay += (dy / dist) * force;
      }
    }

    let vx = agent.vx + ax * dt;
    let vy = agent.vy + ay * dt;

    // Crowding in the agent's own zone damps its top speed — cosmetic only.
    const localDensity = Math.max(0, Math.min(1, density[agent.zoneId] ?? 0));
    const maxSpeed = BASE_MAX_SPEED * (1 - localDensity * 0.5);
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > maxSpeed && speed > 0) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }

    return {
      ...agent,
      x: agent.x + vx * dt,
      y: agent.y + vy * dt,
      vx,
      vy,
    };
  });
}
