"use client";

import React, { useState } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import { GOD_MODE_SCENARIOS } from '@/lib/simulation/scenarios';
import { ZONES } from '@/lib/venue/venue';
import {
  Settings,
  Train,
  DoorClosed,
  AlertTriangle,
  RotateCcw,
  Zap
} from 'lucide-react';

export function GodMode() {
  const applyScenario = useSimStore((s) => s.applyScenario);
  const reset = useSimStore((s) => s.reset);
  
  // Local state to track which scenario has been activated by the user
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);

  // Trigger a scenario patch. Restores baseline first to avoid cumulative stacking.
  const handleTriggerScenario = (scenarioId: string) => {
    const scenario = GOD_MODE_SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return;

    // Reset simulator state first to clear any other active scenarios
    reset(ZONES);

    // Apply new scenario patch
    applyScenario(scenario.patch, true);
    setActiveScenarioId(scenarioId);
  };

  // Restores baseline state
  const handleReset = () => {
    reset(ZONES);
    setActiveScenarioId(null);
  };

  const activeScenario = GOD_MODE_SCENARIOS.find((s) => s.id === activeScenarioId);

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="god-mode-container" role="region" aria-label="Simulation Controls">
      {/* 1. Header Active Indicator */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <span className="text-[10px] text-text-secondary uppercase font-bold tracking-wider">Live Simulation State</span>
        <span
          data-testid="active-scenario-indicator"
          className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border flex items-center gap-1 animate-pulse ${
            activeScenarioId
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-green-50 text-green-700 border-green-200 animate-none'
          }`}
        >
          <Zap className="w-3.5 h-3.5 shrink-0" />
          {activeScenario ? `Active: ${activeScenario.label}` : 'Active: Baseline Model'}
        </span>
      </div>

      {/* 2. Scenario Presets Row — stacked in a single column, not a 3-across
           grid: this card lives as 1-of-3 columns in the Dashboard's bottom
           row, so a fixed 3-column button grid squeezed each label/description
           into ~70-80px, clipping text (e.g. "Emergency"'s description). A
           single column gives each button the card's full width to wrap. */}
      <div className="grid grid-cols-1 gap-3">
        {/* Train Bottleneck */}
        <button
          type="button"
          onClick={() => handleTriggerScenario('train-bottleneck')}
          data-testid="scenario-btn-train-bottleneck"
          className={`py-3 px-4 rounded-xl border flex items-center gap-3 transition-all cursor-pointer text-left select-none shadow-sm min-w-0 ${
            activeScenarioId === 'train-bottleneck'
              ? 'bg-accent/10 border-accent text-accent ring-1 ring-accent'
              : 'bg-canvas border-border text-text-primary hover:bg-canvas/80'
          }`}
        >
          <Train className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <span className="font-bold text-[11px] block">Train Bottleneck</span>
            <span className="text-[10px] text-text-secondary block leading-snug mt-0.5">Spike train terminal and Gate B</span>
          </div>
        </button>

        {/* Gate Closure */}
        <button
          type="button"
          onClick={() => handleTriggerScenario('gate-closure')}
          data-testid="scenario-btn-gate-closure"
          className={`py-3 px-4 rounded-xl border flex items-center gap-3 transition-all cursor-pointer text-left select-none shadow-sm min-w-0 ${
            activeScenarioId === 'gate-closure'
              ? 'bg-accent/10 border-accent text-accent ring-1 ring-accent'
              : 'bg-canvas border-border text-text-primary hover:bg-canvas/80'
          }`}
        >
          <DoorClosed className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <span className="font-bold text-[11px] block">Gate Closure</span>
            <span className="text-[10px] text-text-secondary block leading-snug mt-0.5">Close Gate A and congest north stands</span>
          </div>
        </button>

        {/* Emergency Evacuation */}
        <button
          type="button"
          onClick={() => handleTriggerScenario('emergency')}
          data-testid="scenario-btn-emergency"
          className={`py-3 px-4 rounded-xl border flex items-center gap-3 transition-all cursor-pointer text-left select-none shadow-sm min-w-0 ${
            activeScenarioId === 'emergency'
              ? 'bg-red-500/10 border-red-500 text-red-700 ring-1 ring-red-500'
              : 'bg-canvas border-border text-text-primary hover:bg-canvas/80'
          }`}
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="min-w-0">
            <span className="font-bold text-[11px] block text-red-700">Emergency</span>
            <span className="text-[10px] text-text-secondary block leading-snug mt-0.5">Spike east stand and trigger evacuation</span>
          </div>
        </button>
      </div>

      {/* 3. Reset Button */}
      <div className="flex items-center justify-end mt-1">
        <button
          type="button"
          onClick={handleReset}
          disabled={!activeScenarioId}
          data-testid="scenario-btn-reset"
          className="py-1.5 px-3 rounded-lg border border-border bg-canvas hover:bg-canvas/80 disabled:opacity-40 disabled:hover:bg-canvas font-bold text-[10px] text-text-secondary transition-colors cursor-pointer flex items-center gap-1.5 select-none"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset Baseline
        </button>
      </div>
    </div>
  );
}
