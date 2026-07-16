"use client";

import React, { useState } from "react";
import { ZONES } from "@/lib/venue/venue";
import { Cascade } from "@/lib/engine/cascadePrediction";

export interface CascadeAlertCardProps {
  cascades: Cascade[];
  currentSec: number;
}

function zoneLabel(zoneId: string): string {
  return ZONES.find((z) => z.id === zoneId)?.label ?? zoneId;
}

function minutesFromNow(predictedCrossingSec: number, currentSec: number): number {
  return Math.max(0, Math.round((predictedCrossingSec - currentSec) / 60));
}

function chainText(cascade: Cascade, currentSec: number): string {
  return cascade.chain
    .map((link) => `${zoneLabel(link.zoneId)} (${minutesFromNow(link.predictedCrossingSec, currentSec)} min)`)
    .join(" → ");
}

const CascadeAlertCardComponent: React.FC<CascadeAlertCardProps> = ({ cascades, currentSec }) => {
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([]);

  if (cascades.length === 0) return null;

  const handleDismiss = (key: string) => {
    setDismissedKeys((prev) => [...prev, key]);
  };

  const visibleCascades = cascades.filter((cascade, i) => {
    const key = cascade.chain.map((l) => l.zoneId).join("-") || String(i);
    return !dismissedKeys.includes(key);
  });

  if (visibleCascades.length === 0) return null;

  return (
    <>
      {visibleCascades.map((cascade, i) => {
        const key = cascade.chain.map((l) => l.zoneId).join("-") || String(i);
        return (
          <div
            key={key}
            role="alert"
            data-testid="cascade-alert-card"
            className="w-full max-w-sm rounded-xl border border-border shadow-card p-4 relative border-l-4 border-l-amber-500 bg-white flex flex-col gap-1.5 pr-8"
          >
            <h3 className="font-display font-extrabold text-sm text-text-primary">Cascade Alert</h3>
            <p className="text-xs text-text-secondary leading-relaxed">{chainText(cascade, currentSec)}</p>
            <button
              onClick={() => handleDismiss(key)}
              aria-label="Dismiss alert"
              className="absolute top-3 right-3 text-text-secondary hover:text-text-primary rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </>
  );
};

export const CascadeAlertCard = React.memo(CascadeAlertCardComponent);
