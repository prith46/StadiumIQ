"use client";

import React from 'react';
import { useSimStore } from '../../lib/store/simStore';

interface ChangeSeatControlProps {
  onChangeSeat: () => void;
}

export function ChangeSeatControl({ onChangeSeat }: ChangeSeatControlProps) {
  const location = useSimStore((s) => s.fanContext.location);

  if (!location) return null;

  // Extract the numeric section label (e.g., "sec-214" -> "214")
  const sectionLabel = location.replace('sec-', '');

  return (
    <div 
      className="flex items-center gap-2.5 px-3 py-1 bg-accent/10 border border-accent/20 rounded-pill text-xs font-semibold text-accent"
      role="status"
      aria-label={`Current location set to Section ${sectionLabel}`}
    >
      <span className="font-display">Section {sectionLabel}</span>
      <span className="w-1.5 h-1.5 rounded-full bg-accent/40" aria-hidden="true" />
      <button
        type="button"
        onClick={onChangeSeat}
        className="text-[11px] text-accent hover:text-accent/80 font-bold uppercase tracking-wider focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-1 transition-colors cursor-pointer"
      >
        Change
      </button>
    </div>
  );
}
