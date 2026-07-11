"use client";

import * as React from "react";
import { useSimStore } from "../../lib/store/simStore";
import { Switch } from "../ui/switch";

const AFFILIATION_OPTIONS = [
  { value: undefined, label: "Off" },
  { value: "home" as const, label: "Avoid Home" },
  { value: "away" as const, label: "Avoid Away" },
];

/**
 * Persistent sensory-routing preferences control (M10).
 *
 * Writes directly to `FanContext.sensory` via `simStore`'s `setSensoryPreferences`
 * action, so every subsequent computeRoute call across chat (M2), alerts (M6), and
 * incentives (M9) picks up the preference via `sensoryToRouteFilters` without the
 * fan having to re-state it. See docs/M10-hypersensory.md for the full mapping.
 */
export function SensoryPreferences() {
  const sensory = useSimStore((s) => s.fanContext.sensory);
  const setSensoryPreferences = useSimStore((s) => s.setSensoryPreferences);

  const quiet = sensory?.quiet ?? false;
  const openAir = sensory?.openAir ?? false;
  const avoidAffiliation = sensory?.avoidAffiliation;

  const activeLabels = [
    quiet && "Quiet mode: on",
    openAir && "Open-air: on",
    avoidAffiliation && `Avoiding ${avoidAffiliation === "home" ? "Home" : "Away"} section`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-3 px-3 py-1.5 bg-surface border border-border rounded-control"
        role="group"
        aria-label="Sensory route preferences"
      >
        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary cursor-pointer">
          <Switch
            size="sm"
            checked={quiet}
            onCheckedChange={(checked: boolean) => setSensoryPreferences({ quiet: checked })}
            aria-label="Quiet route"
          />
          Quiet
        </label>

        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary cursor-pointer">
          <Switch
            size="sm"
            checked={openAir}
            onCheckedChange={(checked: boolean) => setSensoryPreferences({ openAir: checked })}
            aria-label="Prefer open-air"
          />
          Open-air
        </label>

        <div
          className="flex items-center gap-1 border-l border-border pl-3"
          role="radiogroup"
          aria-label="Avoid rival section"
        >
          {AFFILIATION_OPTIONS.map((opt) => {
            const selected = avoidAffiliation === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={opt.label}
                onClick={() => setSensoryPreferences({ avoidAffiliation: opt.value })}
                className={`px-2 py-1 text-[11px] font-semibold rounded-control transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  selected
                    ? "bg-accent text-inverse"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeLabels.length > 0 && (
        <span
          role="status"
          aria-label="Sensory preference active"
          className="px-2.5 py-1 bg-accent/10 border border-accent/20 rounded-pill text-[11px] font-semibold text-accent whitespace-nowrap"
        >
          {activeLabels.join(" · ")}
        </span>
      )}
    </div>
  );
}
