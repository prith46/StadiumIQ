"use client";

/**
 * components/StadiumMapLayers.tsx
 *
 * Static / prop-driven presentational SVG layers extracted from StadiumMap.tsx.
 * These layers hold NO internal state — they render purely from module
 * constants (venue graph) and read-only props — so pulling them out of the
 * 1000-line StadiumMap keeps that component focused on the stateful overlay
 * (route/highlight/pin) logic while leaving the rendered DOM byte-for-byte
 * identical. The stateful overlay layer is intentionally NOT extracted (its
 * imperative-handle state and Framer-Motion promise-resolution flow are the
 * component's core and are covered by exact-DOM tests).
 */
import { memo } from "react";
import { ZONES } from "@/lib/venue/venue";
import { pt, cx, cy, densityToBand } from "@/lib/venue/geometry";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Zone } from "@/lib/types";

/** Arrow markers for the route destination (default FIFA-blue + M14 emergency crimson). */
export function MapDefs() {
  return (
    <defs>
      <marker
        id="route-arrow"
        viewBox="0 0 10 10"
        refX="5"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
      </marker>
      {/* M14: crimson variant for the SOS evacuation path (§m14-sos.md §2) */}
      <marker
        id="route-arrow-emergency"
        viewBox="0 0 10 10"
        refX="5"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
      </marker>
    </defs>
  );
}

/** §22.5 field layer — static pitch rendering centered on (cx, cy). */
export function FieldLayer() {
  return (
    <g id="field-layer">
      <rect
        x={cx - 86}
        y={cy - 50}
        width={172}
        height={100}
        rx={12}
        fill="#CDE6A6"
        stroke="#639922"
        strokeWidth={1.5}
      />
      {[1, 2, 3, 4, 5, 6].map((k) => (
        <line
          key={`yard-${k}`}
          x1={cx - 86 + k * 24.6}
          y1={cy - 50}
          x2={cx - 86 + k * 24.6}
          y2={cy + 50}
          stroke="#9FC46A"
          strokeWidth={1}
        />
      ))}
      <line x1={cx} y1={cy - 50} x2={cx} y2={cy + 50} stroke="#639922" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={14} fill="none" stroke="#639922" strokeWidth={1.5} />
    </g>
  );
}

interface GatesLayerProps {
  gateStatus: Record<string, "open" | "congested" | "closed"> | undefined;
  onZoneClick?: (zoneId: string) => void;
}

/** §22.3 gate markers — clickable, keyboard-navigable, with status tooltip. */
export function GatesLayer({ gateStatus, onZoneClick }: GatesLayerProps) {
  return (
    <g id="gates-layer">
      {ZONES.filter((z) => z.type === "gate").map((gate) => {
        const p = pt(gate.rInner ?? 0, gate.angle ?? 0);
        const status = gateStatus?.[gate.id] || "open";
        const label = gate.label.replace("Gate ", "");

        return (
          <Tooltip key={gate.id}>
            <TooltipTrigger
              render={
                <g
                  id={gate.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  className="cursor-pointer map-interactive"
                  onClick={() => onZoneClick?.(gate.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onZoneClick?.(gate.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${gate.label}, status: ${status}`}
                >
                  <rect x={-25} y={-9} width={50} height={18} rx={5} fill="var(--color-accent)" />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="bold"
                    fill="#FFFFFF"
                  >
                    Gate {label}
                  </text>
                </g>
              }
            />
            <TooltipContent className="bg-white text-black rounded-[8px] p-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-100 text-xs isolate z-50">
              <div className="font-semibold">{gate.label}</div>
              <div className="text-[10px] text-gray-500 capitalize">Status: {status}</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </g>
  );
}

interface TransitLayerProps {
  onZoneClick?: (zoneId: string) => void;
}

/** §22.3 transit markers (train/bus/taxi/parking) — clickable + keyboard-navigable. */
export function TransitLayer({ onZoneClick }: TransitLayerProps) {
  return (
    <g id="transit-layer">
      {ZONES.filter((z) => z.type === "transit").map((transit) => {
        const p = pt(transit.rInner ?? 0, transit.angle ?? 0);
        const width = transit.label.length * 7 + 16;

        return (
          <Tooltip key={transit.id}>
            <TooltipTrigger
              render={
                <g
                  id={transit.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  className="cursor-pointer map-interactive"
                  onClick={() => onZoneClick?.(transit.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onZoneClick?.(transit.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={transit.label}
                >
                  <rect x={-width / 2} y={-9} width={width} height={18} rx={5} fill="#E4E1D8" stroke="#B4B2A9" strokeWidth={1} />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fontSize="11"
                    fill="#444441"
                  >
                    {transit.label}
                  </text>
                </g>
              }
            />
            <TooltipContent className="bg-white text-black rounded-[8px] p-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-100 text-xs isolate z-50 font-semibold">
              {transit.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </g>
  );
}

/**
 * Maps a section's density value to its short status word. Exported so the a11y
 * screen-reader list in StadiumMap labels sections with the same words the
 * visual tooltip uses.
 */
export function getStatusText(densityVal: number | undefined): string {
  if (densityVal === undefined) return "Unknown";
  if (densityVal < 0.34) return "Clear";
  if (densityVal < 0.67) return "Busy";
  return "Crowded";
}

// Optimized seat-section shape — memo() so a parent re-render on a sim tick
// doesn't re-render all 60 sections. Takes a STABLE onSelect(zoneId) (not a
// per-section inline closure) so the memo actually holds.
interface SectionShapeProps {
  id: string;
  d: string;
  density: number | undefined;
  onSelect?: (zoneId: string) => void;
  ariaLabel: string;
}

function SectionShapeComponent({ id, d, density, onSelect, ariaLabel }: SectionShapeProps) {
  const isPending = density === undefined;
  const band = isPending ? null : densityToBand(density);
  const fillColor = isPending ? "var(--color-border)" : band!.fill;
  const strokeColor = isPending ? "rgba(0,0,0,0.06)" : band!.stroke;

  return (
    <path
      id={id}
      d={d}
      fill={fillColor}
      className={`map-interactive ${isPending ? "shimmer-active" : "transition-colors-all"}`}
      style={{
        stroke: strokeColor,
        strokeWidth: "0.8px",
        cursor: "pointer",
        transition: "fill 0.2s ease, stroke 0.2s ease, filter 0.2s ease",
      }}
      onClick={() => onSelect?.(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(id);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
    />
  );
}

const SectionShape = memo(SectionShapeComponent);

interface SectionPathObj {
  id: string;
  d: string;
  zone: Zone;
}

interface SectionLayerProps {
  sectionPaths: SectionPathObj[];
  density: Record<string, number> | undefined;
  sensorCounts: Record<string, number> | undefined;
  mode: "fan" | "organizer";
  onSelect: (zoneId: string) => void;
}

/**
 * §22.2 seating sections layer: 60 memoized section shapes with density-driven
 * heatmap fill and a hover tooltip (status, plus organizer-only density and
 * active-session counts), followed by the section number labels. Pure
 * presentational — every input is a read-only prop.
 */
export function SectionLayer({ sectionPaths, density, sensorCounts, mode, onSelect }: SectionLayerProps) {
  return (
    <g id="seating-layer">
      {sectionPaths.map((pathObj) => {
        const dVal = density?.[pathObj.id];
        const percentStr = dVal !== undefined ? `${Math.round(dVal * 100)}%` : "N/A";
        const decimalStr = dVal !== undefined ? dVal.toFixed(2) : "N/A";
        const status = getStatusText(dVal);
        const sensorCountVal = sensorCounts?.[pathObj.id] ?? 0;
        const labelText = `Section ${pathObj.zone.label}, Tier ${pathObj.zone.tier}, status: ${status}${
          mode === "organizer" && dVal !== undefined ? `, density: ${percentStr}` : ""
        }${mode === "organizer" ? `, active sessions: ${sensorCountVal}` : ""}`;

        return (
          <Tooltip key={pathObj.id}>
            <TooltipTrigger
              render={
                <SectionShape
                  id={pathObj.id}
                  d={pathObj.d}
                  density={dVal}
                  onSelect={onSelect}
                  ariaLabel={labelText}
                />
              }
            />
            <TooltipContent className="bg-white text-black rounded-[8px] p-3 shadow-[0_4px_12px_rgba(0,0,0,0.08)] border border-gray-100 flex flex-col gap-1 text-xs isolate z-50">
              <div className="font-semibold text-sm">Section {pathObj.zone.label}</div>
              <div className="text-gray-500">Tier {pathObj.zone.tier}</div>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: dVal === undefined ? "var(--color-border)" : densityToBand(dVal).stroke
                  }}
                />
                <span className="font-medium text-gray-700">
                  {dVal === undefined ? "Loading..." : status}
                </span>
              </div>
              {mode === "organizer" && dVal !== undefined && (
                <div className="mt-1 pt-1 border-t border-gray-100 flex items-center justify-between gap-4 text-gray-500">
                  <span>Density:</span>
                  <span className="font-semibold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                    {percentStr} ({decimalStr})
                  </span>
                </div>
              )}
              {/* Fix 4: fan-as-sensor active session count, organizer-only, same tooltip pattern as density */}
              {mode === "organizer" && (
                <div className="flex items-center justify-between gap-4 text-gray-500">
                  <span>Active sessions:</span>
                  <span
                    className="font-semibold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded text-[10px]"
                    data-testid={`sensor-count-${pathObj.id}`}
                  >
                    {sensorCounts?.[pathObj.id] ?? 0}
                  </span>
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {sectionPaths.map((pathObj) => {
        const labelPt = pt(((pathObj.zone.rInner ?? 0) + (pathObj.zone.rOuter ?? 0)) / 2, pathObj.zone.angle ?? 0);
        return (
          <text
            key={`label-${pathObj.id}`}
            x={labelPt.x}
            y={labelPt.y}
            fontSize="10.5"
            fill="#2C2C2A"
            textAnchor="middle"
            style={{ pointerEvents: "none" }}
          >
            {pathObj.zone.label}
          </text>
        );
      })}
    </g>
  );
}
