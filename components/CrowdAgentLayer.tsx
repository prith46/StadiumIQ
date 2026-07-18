"use client";

import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { spawnAgents, stepAgents, Agent } from "@/lib/engine/agentMotion";

export interface CrowdAgentLayerProps {
  enabled: boolean;
  density: Record<string, number>;
  seed?: number;
}

// Update at most every 2 animation frames (~30fps at a 60Hz display) to
// bound CPU cost, per M28's efficiency requirement.
const FRAME_THROTTLE = 2;

/**
 * Cosmetic, opt-in crowd-agent visualization. Owns its own animation state
 * via refs/local state (NOT Zustand) so its ~30fps re-renders are isolated
 * to this component and never propagate to the rest of `<StadiumMap>`.
 * Renders nothing when disabled, when `prefers-reduced-motion` is set (hard
 * override), or once agents have been spawned as an empty list.
 */
export const CrowdAgentLayer: React.FC<CrowdAgentLayerProps> = ({ enabled, density, seed = 1 }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const agentsRef = useRef<Agent[]>([]);
  const densityRef = useRef(density);
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  // Same source of truth as every other animated component in the app
  // (VoiceInputButton, AppShell, page.tsx): framer-motion's reactive
  // reduced-motion hook, instead of a hand-rolled matchMedia listener.
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  const active = enabled && !prefersReducedMotion;

  // Spawn once per activation (or seed change) from the latest known density —
  // agent goals don't need to track every subsequent density tick (no
  // per-agent pathfinding), per M28's scope. The spawn is written to the ref
  // here and PUBLISHED to render state from the first animation frame, so all
  // setState happens inside async rAF callbacks (never synchronously in the
  // effect body) and stale agents can never be shown: rendering is gated on
  // `active`, and every activation restarts this effect with a fresh spawn.
  useEffect(() => {
    if (!active) {
      agentsRef.current = [];
      return;
    }

    agentsRef.current = spawnAgents(densityRef.current, seed);
    lastTimeRef.current = null;
    frameCountRef.current = 0;

    const tick = (time: number) => {
      rafRef.current = requestAnimationFrame(tick);
      frameCountRef.current += 1;
      if (frameCountRef.current === 1) {
        // First frame after (re)activation: publish the fresh spawn.
        setAgents(agentsRef.current);
      }
      if (frameCountRef.current % FRAME_THROTTLE !== 0) return;

      const last = lastTimeRef.current;
      lastTimeRef.current = time;
      if (last === null) return;

      const deltaMs = time - last;
      if (deltaMs <= 0 || agentsRef.current.length === 0) return;

      agentsRef.current = stepAgents(agentsRef.current, densityRef.current, deltaMs);
      setAgents(agentsRef.current);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, seed]);

  if (!active || agents.length === 0) return null;

  return (
    <g id="crowd-agent-layer" style={{ pointerEvents: "none" }} data-testid="crowd-agent-layer">
      {agents.map((agent) => (
        <circle
          key={agent.id}
          cx={agent.x}
          cy={agent.y}
          r={1.4}
          fill="var(--color-accent)"
          opacity={0.35}
        />
      ))}
    </g>
  );
};
