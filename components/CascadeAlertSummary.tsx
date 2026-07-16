"use client";

import React, { useState, useEffect } from "react";
import { Cascade } from "@/lib/engine/cascadePrediction";
import { CascadeAlertCard } from "./CascadeAlertCard";

export interface CascadeAlertSummaryProps {
  cascades: Cascade[];
  currentSec: number;
}

export function CascadeAlertSummary({ cascades, currentSec }: CascadeAlertSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([]);

  // Cleanup dismissed keys that are no longer in the active cascades list
  useEffect(() => {
    const activeKeys = new Set(
      cascades.map((c, i) => c.chain.map((l) => l.zoneId).join("-") || String(i))
    );
    setDismissedKeys((prev) => prev.filter((k) => activeKeys.has(k)));
  }, [cascades]);

  if (!cascades || cascades.length === 0) return null;

  const visibleCascades = cascades.filter((cascade, i) => {
    const key = cascade.chain.map((l) => l.zoneId).join("-") || String(i);
    return !dismissedKeys.includes(key);
  });

  if (visibleCascades.length === 0) return null;

  const handleClearAll = () => {
    const keys = cascades.map((cascade, i) => cascade.chain.map((l) => l.zoneId).join("-") || String(i));
    setDismissedKeys(keys);
  };

  if (visibleCascades.length === 1) {
    return <CascadeAlertCard cascades={visibleCascades} currentSec={currentSec} />;
  }

  return (
    <div
      role="alert"
      data-testid="cascade-alert-summary"
      className="w-full max-w-sm rounded-xl border border-border shadow-card p-4 border-l-4 border-l-amber-500 bg-white flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display font-extrabold text-sm text-text-primary">
          {visibleCascades.length} Active Cascades
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearAll}
            className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
            data-testid="clear-all-cascades-btn"
          >
            Clear All
          </button>
          <span className="text-border">|</span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs font-semibold text-accent hover:underline cursor-pointer"
            data-testid="toggle-summary-btn"
          >
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-3 mt-1 pl-1 border-l border-border/80">
          <CascadeAlertCard cascades={visibleCascades} currentSec={currentSec} />
        </div>
      )}
    </div>
  );
}
