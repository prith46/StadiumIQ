"use client";

import React, { useEffect, useState } from "react";
import { ZONES } from "@/lib/venue/venue";
import { useSimStore } from "@/lib/store/simStore";
import { Button } from "@/components/ui/button";

// Moved here from the dev-only `/map-preview` route (M29 Fix 9) — this is
// the only piece of that page that's an actual operational tool (manual
// density overrides for demoing/testing); the rest of that page was
// StadiumMap ref-API scratch tooling and was removed, not duplicated.
export function MapSettingsSimPanel() {
  const applyScenario = useSimStore((s) => s.applyScenario);
  const density = useSimStore((s) => s.density);
  const showCrowdAgents = useSimStore((s) => s.showCrowdAgents);
  const setShowCrowdAgents = useSimStore((s) => s.setShowCrowdAgents);
  const clearManualOverrides = useSimStore((s) => s.clearManualOverrides);

  const [manualDensityZoneId, setManualDensityZoneId] = useState<string>(ZONES[0]?.id ?? "sec-101");

  const DENSITY_LEVELS = { light: 0.2, medium: 0.5, heavy: 0.85 } as const;

  const handleRandomizeDensity = () => {
    const patch: Record<string, number> = {};
    ZONES.forEach((zone) => {
      patch[zone.id] = Math.round(Math.random() * 100) / 100;
    });
    applyScenario({ density: patch });
  };

  const handleSetManualDensity = (level: keyof typeof DENSITY_LEVELS) => {
    const value = DENSITY_LEVELS[level];
    applyScenario({ density: { ...density, [manualDensityZoneId]: value } });
  };

  return (
    <div className="flex flex-col gap-4 text-sm text-text-secondary">
      <div className="flex items-center justify-between">
        <span>Show Crowd Simulation (Demo)</span>
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCrowdAgents}
            onChange={(e) => setShowCrowdAgents(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
        </label>
      </div>

      <div className="pt-2 border-t border-border/60 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span>Randomize Density</span>
          <Button size="sm" variant="outline" onClick={handleRandomizeDensity}>
            Randomize
          </Button>
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 flex flex-col gap-2">
        <label className="block text-xs font-semibold">Manual Zone Density</label>
        <select
          className="w-full p-2 border border-border rounded-lg bg-surface text-text-primary text-sm"
          value={manualDensityZoneId}
          onChange={(e) => setManualDensityZoneId(e.target.value)}
        >
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label} ({z.type})
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleSetManualDensity("light")}>
            Light (0.2)
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleSetManualDensity("medium")}>
            Medium (0.5)
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleSetManualDensity("heavy")}>
            Heavy (0.85)
          </Button>
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 flex flex-col gap-2">
        <Button size="sm" className="w-full font-bold" onClick={clearManualOverrides}>
          Resume Auto / Clear Overrides
        </Button>
      </div>
    </div>
  );
}
