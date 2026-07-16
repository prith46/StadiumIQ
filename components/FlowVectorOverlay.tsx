"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { pt, cx, cy } from "@/lib/venue/geometry";
import { Zone } from "@/lib/types";
import { FlowVector } from "@/lib/engine/flowVectors";

export interface FlowVectorOverlayProps {
  flowVectors: FlowVector[];
  zones: Zone[];
}

// M22: neutral slate, visually distinct from FIFA-blue route highlights and heatmap bands.
const ARROW_COLOR = "#64748B";
const ARROW_OPACITY = 0.6;

function getZoneCenter(zone: Zone): { x: number; y: number } {
  if (zone.id === "field-center" || zone.type === "field") {
    return { x: cx, y: cy };
  }
  const angle = zone.angle ?? 0;
  const rInner = zone.rInner ?? 0;
  const rOuter = zone.rOuter ?? 0;
  const r = (rInner + rOuter) / 2;
  return pt(r, angle);
}

const FlowVectorOverlayComponent: React.FC<FlowVectorOverlayProps> = ({ flowVectors, zones }) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mq.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, []);

  const arrows = useMemo(() => {
    return flowVectors
      .map((vec) => {
        const fromZone = zones.find((z) => z.id === vec.from);
        const toZone = zones.find((z) => z.id === vec.to);
        if (!fromZone || !toZone) return null;
        const from = getZoneCenter(fromZone);
        const to = getZoneCenter(toZone);
        // Scale 0.5x-1.5x base size by magnitude.
        const scale = 0.5 + Math.min(1, Math.max(0, vec.magnitude)) * 1;
        return { edgeId: vec.edgeId, from, to, scale };
      })
      .filter((a): a is { edgeId: string; from: { x: number; y: number }; to: { x: number; y: number }; scale: number } => a !== null);
  }, [flowVectors, zones]);

  if (arrows.length === 0) return null;

  return (
    <g id="flow-vector-layer" style={{ pointerEvents: "none" }} data-testid="flow-vector-layer">
      <defs>
        <marker
          id="flow-vector-arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR} />
        </marker>
      </defs>
      {prefersReducedMotion ? (
        arrows.map((arrow) => (
          <line
            key={arrow.edgeId}
            data-testid="flow-vector-arrow"
            x1={arrow.from.x}
            y1={arrow.from.y}
            x2={arrow.to.x}
            y2={arrow.to.y}
            stroke={ARROW_COLOR}
            strokeWidth={1.5 * arrow.scale}
            opacity={ARROW_OPACITY}
            markerEnd="url(#flow-vector-arrow)"
          />
        ))
      ) : (
        <AnimatePresence>
          {arrows.map((arrow) => (
            <motion.line
              key={arrow.edgeId}
              data-testid="flow-vector-arrow"
              x1={arrow.from.x}
              y1={arrow.from.y}
              x2={arrow.to.x}
              y2={arrow.to.y}
              stroke={ARROW_COLOR}
              strokeWidth={1.5 * arrow.scale}
              markerEnd="url(#flow-vector-arrow)"
              initial={{ opacity: 0, scale: arrow.scale * 0.8 }}
              animate={{ opacity: ARROW_OPACITY, scale: arrow.scale }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            />
          ))}
        </AnimatePresence>
      )}
    </g>
  );
};

export const FlowVectorOverlay = React.memo(FlowVectorOverlayComponent);
