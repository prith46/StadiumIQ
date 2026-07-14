"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
  memo
} from "react";
import { motion } from "framer-motion";
import { ZONES, POIS, FACILITY_SPECS, TIERS } from "@/lib/venue/venue";
import { pt, sectorPath, pctPos, densityToBand, cx, cy } from "@/lib/venue/geometry";
import { POI_ICON_MAP } from "@/lib/venue/poiIcons";
import { useSimStore } from "@/lib/store/simStore";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Zone } from "@/lib/types";
import {
  highlightVariants,
  pinDropVariants,
  routeDrawTransition,
  EXIT_FADE_MS,
} from "@/lib/venue/overlayAnimations";
import { EDGES } from "@/lib/venue/venue";
import { computeFlowVectors, FlowVector } from "@/lib/engine/flowVectors";
import { FlowVectorOverlay } from "@/components/FlowVectorOverlay";
import { CrowdAgentLayer } from "@/components/CrowdAgentLayer";

export interface StadiumMapHandle {
  highlightZone: (zoneId: string, opts?: { pulse?: boolean }) => void;
  /**
   * M5: returns a Promise that resolves when the path-draw animation completes.
   * `variant` defaults to `'default'` (FIFA-blue). M14 SOS overlay passes
   * `'emergency'` to render the documented crimson evacuation path (§m14-sos.md
   * "Evacuation path color: #ef4444") instead of the standard route color.
   */
  drawRoute: (path: string[], variant?: 'default' | 'emergency') => Promise<void>;
  dropPin: (zoneId: string, kind: 'incident' | 'dispatch' | 'poi') => void;
  clearOverlay: () => void;
}

/**
 * §22.10 vs M5 ref API — resolved decision (not left as an open conflict):
 *
 * §22.10 specifies StadiumMap as a purely declarative component (role, density,
 * route, youAreHere, highlights, incidents, onZoneClick as props). But M2/M5/M6/M9
 * already integrate against the imperative `StadiumMapHandle` ref
 * (highlightZone/drawRoute/dropPin/clearOverlay), which this rebuild is explicitly
 * scoped to leave unchanged. The two interfaces cannot both be the single source of
 * truth for the same overlay state without a dual-write hazard (e.g. a `route` prop
 * and a `drawRoute()` ref call disagreeing about what's currently drawn).
 *
 * Resolution: the ref API remains authoritative for overlay state (route,
 * highlights, pins) — unchanged. Two §22.10 prop names that are pure, stateless
 * aliases for existing read-only props are added below (`role`, `youAreHere`)
 * since they carry no internal state and can't conflict. `density`, `route`,
 * `highlights`, and `incidents` are intentionally NOT added as props: `density`
 * is already sourced reactively from `useSimStore` internally (a prop override
 * would be redundant), and `route`/`highlights`/`incidents` would directly
 * duplicate state the ref API already owns imperatively.
 */
export interface StadiumMapProps {
  mode: 'fan' | 'organizer';
  /** §22.10 alias for `mode`. Purely cosmetic — `mode` always takes precedence if both are given. */
  role?: 'fan' | 'organizer';
  currentZoneId?: string;
  /** §22.10 alias for `currentZoneId`. Purely cosmetic — `currentZoneId` always takes precedence if both are given. */
  youAreHere?: string;
  onZoneClick?: (zoneId: string) => void;
  onPoiClick?: (poiId: string) => void;
  className?: string;
  /** Injectable test/timing hook to manually trigger drawRoute promise resolution in JSDOM */
  onRouteAnimationStart?: (resolve: () => void) => void;
}

// §22.1: canvas is viewBox="0 0 680 396" (cx=340, cy=200).
const VIEW_W = 680;
const VIEW_H = 396;

// Concourse band ellipse radii — pt() extremes at r=1.02 (§22.9).
const CONCOURSE_BAND_R = 1.02;

// Helper to determine the center coordinate of a zone, in full canvas space.
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

function getStatusText(densityVal: number | undefined): string {
  if (densityVal === undefined) return "Unknown";
  if (densityVal < 0.34) return "Clear";
  if (densityVal < 0.67) return "Busy";
  return "Crowded";
}

// Optimized subcomponent for rendering seating sections to prevent global re-renders.
// Takes a stable `onSelect(zoneId)` callback (NOT a per-section inline closure) so
// the memo() below actually holds when the parent re-renders on a sim tick.
interface SectionShapeProps {
  id: string;
  d: string;
  density: number | undefined;
  onSelect?: (zoneId: string) => void;
  ariaLabel: string;
}

const SectionShapeComponent: React.FC<SectionShapeProps> = ({
  id,
  d,
  density,
  onSelect,
  ariaLabel,
}) => {
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
};

const SectionShape = memo(SectionShapeComponent);

// memo(): parents that re-render on every 1s clock tick (e.g. the organizer
// Dashboard) must not cascade into the map when its own props are stable —
// the map re-renders from its OWN store subscriptions when live data changes.
export const StadiumMap = memo(forwardRef<StadiumMapHandle, StadiumMapProps>(
  (props, ref) => {
    const {
      mode: modeProp,
      role,
      currentZoneId: currentZoneIdProp,
      youAreHere,
      onZoneClick,
      onPoiClick,
      className,
      onRouteAnimationStart,
    } = props;
    // §22.10 aliases resolved to a single value each — see StadiumMapProps doc comment.
    const mode = modeProp ?? role ?? 'fan';

    const currentZoneId = currentZoneIdProp ?? youAreHere;

    // Stable section-select callback: reads the latest onZoneClick through a
    // ref so its identity NEVER changes — a per-render inline closure here
    // would defeat SectionShape's memo() for all 60 sections on every tick.
    const onZoneClickRef = useRef(onZoneClick);
    useEffect(() => {
      onZoneClickRef.current = onZoneClick;
    });
    const handleSectionSelect = useCallback((zoneId: string) => {
      onZoneClickRef.current?.(zoneId);
    }, []);

    // 1. Reactive subscription to simulation density and gateStatus
    const density = useSimStore((s) => s.density);
    const previousDensity = useSimStore((s) => s.previousDensity);
    const gateStatus = useSimStore((s) => s.gateStatus);
    const sensorCounts = useSimStore((s) => s.sensorCounts);

    // M28: cosmetic crowd-agent visualization — opt-in, OFF by default given perf risk.
    const showCrowdAgents = useSimStore((s) => s.showCrowdAgents);

    // M22: raw per-tick flow vectors, then retained for 2 ticks after dropping
    // below FLOW_THRESHOLD so arrows fade instead of flickering off instantly.
    // Deps are as tight as possible: [density, previousDensity] are the only
    // inputs (EDGES is a module constant), so this recomputes at most once per
    // sim tick — when the store publishes a new density snapshot — not on
    // unrelated re-renders. Full per-edge incremental diffing was left out of
    // scope on purpose: the O(edges) recompute is cheap (a few hundred edges)
    // and the flow-fade retention effect below reads the complete vector set
    // each tick, so incremental updates would add correctness risk for no gain.
    // Defensive: density/previousDensity are undefined during the loading
    // (shimmer) state; computeFlowVectors also guards internally, but pass safe
    // empty maps so the memo never hands it an undefined snapshot.
    const rawFlowVectors = useMemo(
      () => computeFlowVectors(density ?? {}, previousDensity ?? {}, EDGES),
      [density, previousDensity]
    );
    const flowFadeMapRef = useRef<Map<string, { vector: FlowVector; ticksLeft: number }>>(new Map());
    const [flowVectors, setFlowVectors] = useState<FlowVector[]>([]);
    useEffect(() => {
      const map = flowFadeMapRef.current;
      const rawIds = new Set(rawFlowVectors.map((v) => v.edgeId));
      for (const v of rawFlowVectors) {
        map.set(v.edgeId, { vector: v, ticksLeft: 2 });
      }
      for (const [id, entry] of map) {
        if (!rawIds.has(id)) {
          entry.ticksLeft -= 1;
          if (entry.ticksLeft <= 0) map.delete(id);
        }
      }
      // Keep the previous (empty) array identity when there are no vectors —
      // returning the same reference lets React bail out of the extra
      // post-effect re-render this setState otherwise forces every tick.
      setFlowVectors((prev) => (prev.length === 0 && map.size === 0 ? prev : Array.from(map.values()).map((e) => e.vector)));
    }, [rawFlowVectors]);

    // 2. Internal overlay states managed imperatively via ref
    const [highlightedZone, setHighlightedZone] = useState<{ zoneId: string; pulse?: boolean } | null>(null);
    const [route, setRoute] = useState<string[] | null>(null);
    const [routeVariant, setRouteVariant] = useState<'default' | 'emergency'>('default');
    const [routeDrawDone, setRouteDrawDone] = useState(false);
    const [pins, setPins] = useState<Array<{ zoneId: string; kind: 'incident' | 'dispatch' | 'poi' }>>([]);

    // M5: Exit-fade state — captures outgoing overlay snapshot for a cosmetic 200ms fade.
    // The PRIMARY overlay state (highlightedZone/route/pins) is always cleared synchronously
    // so test assertions never depend on animation timing. This exiting state is a
    // decorative side-channel only, cleared by setTimeout(EXIT_FADE_MS).
    const [exitingSnapshot, setExitingSnapshot] = useState<{
      highlightedZone: typeof highlightedZone;
      route: typeof route;
      routeVariant: typeof routeVariant;
      pins: typeof pins;
    } | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // M5: Resolver ref for drawRoute Promise — set when route is mounted, fired by onAnimationComplete
    const routeResolverRef = useRef<(() => void) | null>(null);

    // M5: Detect prefers-reduced-motion to skip exit fade (instant removal under reduced-motion)
    const prefersReducedMotion = useRef(false);
    useEffect(() => {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        prefersReducedMotion.current = mq.matches;
        const handler = (e: MediaQueryListEvent) => { prefersReducedMotion.current = e.matches; };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
      }
    }, []);



    const handleClearOverlay = () => {
      // Capture outgoing snapshot for cosmetic exit-fade (decorative only)
      const fadeDuration = prefersReducedMotion.current ? 0 : EXIT_FADE_MS;
      setExitingSnapshot({ highlightedZone, route, routeVariant, pins });
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => setExitingSnapshot(null), fadeDuration);

      // PRIMARY clear — synchronous, test-stable (never flaky)
      setHighlightedZone(null);
      setRoute(null);
      setRouteVariant('default');
      setRouteDrawDone(false);
      setPins([]);
      routeResolverRef.current = null;
    };

    // 3. Expose imperative ref methods
    useImperativeHandle(ref, () => ({
      highlightZone: (zoneId, opts) => {
        if (!ZONES.some((z) => z.id === zoneId)) {
          console.warn(`[StadiumMap] highlightZone called with invalid zoneId: "${zoneId}"`);
          return;
        }
        setHighlightedZone({ zoneId, pulse: opts?.pulse });
      },
      drawRoute: (path, variant = 'default') => {
        const invalidIds = path.filter((id) => !ZONES.some((z) => z.id === id));
        if (invalidIds.length > 0) {
          console.warn(`[StadiumMap] drawRoute called with invalid zoneId(s): ${JSON.stringify(invalidIds)}`);
          return Promise.resolve();
        }
        setRoute(path);
        setRouteVariant(variant);
        setRouteDrawDone(false);
        return new Promise<void>((resolve) => {
          routeResolverRef.current = resolve;
          if (onRouteAnimationStart) {
            onRouteAnimationStart(() => {
              setRouteDrawDone(true);
              resolve();
            });
          }
        });
      },
      dropPin: (zoneId, kind) => {
        if (!ZONES.some((z) => z.id === zoneId)) {
          console.warn(`[StadiumMap] dropPin called with invalid zoneId: "${zoneId}"`);
          return;
        }
        setPins((prev) => {
          const filtered = prev.filter((p) => p.zoneId !== zoneId);
          return [...filtered, { zoneId, kind }];
        });
      },
      clearOverlay: handleClearOverlay
    }));

    // 4. Memoize the section coordinates and SVG paths (static, only computed once)
    const sectionPaths = useMemo(() => {
      return ZONES.filter((z) => z.type === "section").map((zone) => {
        const centerAngle = zone.angle ?? 0;
        const tier = zone.tier ?? 1;
        const count = TIERS.find((t) => t.tier === tier)?.count ?? 16;
        const step = 360 / count;
        const gap = step * 0.16;
        const halfSpan = step / 2 - gap;
        const angleStart = centerAngle - halfSpan;
        const angleEnd = centerAngle + halfSpan;
        const d = sectorPath(angleStart, angleEnd, zone.rInner ?? 0, zone.rOuter ?? 0);
        return { id: zone.id, d, zone };
      });
    }, []);

    // Helper for rendering routes in overlay layer — builds SVG path `d` attribute
    // (uses path `d` for Framer Motion pathLength animation instead of polyline)
    const routePathD = useMemo(() => {
      if (!route || route.length === 0) return "";
      const points = route
        .map((id) => {
          const zone = ZONES.find((z) => z.id === id);
          if (!zone) return null;
          return getZoneCenter(zone);
        })
        .filter((p): p is { x: number; y: number } => p !== null);
      if (points.length < 2) return "";
      return points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
    }, [route]);

    // Destination point for the arrow marker (last zone in route)
    const routeDestPoint = useMemo(() => {
      if (!route || route.length === 0) return null;
      const lastZone = ZONES.find((z) => z.id === route[route.length - 1]);
      if (!lastZone) return null;
      return getZoneCenter(lastZone);
    }, [route]);

    // Concourse band ellipse radii (pt() extremes at r=1.02)
    const bandRx = pt(CONCOURSE_BAND_R, 0).x - cx;
    const bandRy = pt(CONCOURSE_BAND_R, 90).y - cy;

    return (
      <TooltipProvider delay={50}>
        <div className={`relative flex flex-col items-center select-none bg-canvas ${className || ""}`}>
          {/* Custom style block inside component to handle animations and reduced motion */}
          <style>{`
            @keyframes shimmer {
              0% { fill: #E5E7EB; }
              50% { fill: #F3F4F6; }
              100% { fill: #E5E7EB; }
            }
            .shimmer-active {
              animation: shimmer 1.5s infinite ease-in-out;
            }
            .transition-colors-all:hover {
              stroke: #2563EB !important;
              stroke-width: 1.5px !important;
              filter: brightness(1.05);
            }
            /* Visible keyboard-focus indicator for interactive map elements
               (sections, gates, transit, POIs). Sections/gates are SVG so use a
               stroke change; the outline covers the HTML POI markers and acts as
               a fallback. */
            .map-interactive:focus-visible {
              outline: 2.5px solid var(--color-accent);
              outline-offset: 1px;
              stroke: var(--color-accent) !important;
              stroke-width: 2.5px !important;
            }
            @keyframes pulse-ring {
              0% { r: 7px; opacity: 0.4; }
              100% { r: 14px; opacity: 0; }
            }
            .pulsing-ring {
              animation: pulse-ring 2s ease-in-out infinite;
            }
            /* M5: exit-fade applied to the exiting overlay snapshot wrapper */
            .overlay-exit-fade {
              transition: opacity var(--overlay-exit-ms, 200ms) ease;
              opacity: 0;
              pointer-events: none;
            }
            @media (prefers-reduced-motion: reduce) {
              .shimmer-active {
                animation: none !important;
                fill: #E5E7EB !important;
              }
              .pulsing-ring {
                animation: none !important;
                r: 14px !important;
                opacity: 0.3 !important;
              }
              .transition-colors-all {
                transition: none !important;
              }
              .animate-pulse {
                animation: none !important;
                opacity: 0.8 !important;
              }
              .overlay-exit-fade {
                transition: none !important;
              }
            }
          `}</style>

          {/*
            Shared-size wrapper: the HTML facility-icon overlay below is
            positioned via pctPos() percentages calibrated against the SVG's
            680x396 viewBox. It must be sized/positioned identically to the
            SVG's own rendered box — not the outer flex container, which can
            be wider than the max-w-[900px]-capped, centered SVG. Without this
            wrapper, `inset:0` on the overlay stretches it to the outer
            container's full width, shifting and rescaling every icon.
          */}
          <div className="relative w-full max-w-[900px]" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
          {/* SVG rendering the Stadium Digital Twin — light mode only, §22 REQ 4 */}
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-auto drop-shadow-sm"
            style={{ backgroundColor: "var(--color-canvas)" }}
            role="img"
            aria-label="Stadium Interactive Seating and Heatmap Map"
          >
            {/* 1. DEFS — arrow marker for route destination */}
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

            {/* 2. CONCOURSE BAND LAYER */}
            <g id="concourse-band-layer">
              <ellipse
                cx={cx}
                cy={cy}
                rx={bandRx}
                ry={bandRy}
                fill="none"
                stroke="#ECEAE1"
                strokeWidth={15}
              />
            </g>

            {/* 3. SEATING SECTIONS LAYER (+ labels) */}
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
                          onSelect={handleSectionSelect}
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

            {/* 4. FIELD LAYER — §22.5 */}
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

            {/* 5. GATE MARKERS LAYER — §22.3 */}
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

            {/* 6. TRANSIT MARKERS LAYER — §22.3 */}
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

            {/* M22: Crowd flow vectors — sits above the heatmap, below highlights/routes/pins */}
            <FlowVectorOverlay flowVectors={flowVectors} zones={ZONES} />

            {/* M28: cosmetic crowd-agent visualization — opt-in demo layer */}
            <CrowdAgentLayer enabled={showCrowdAgents} density={density} />

            {/* 7. SVG OVERLAY LAYER (route, you-are-here, highlight, pins) — §22.8 */}
            <g id="overlay-layer">

              {/* M5: Exit-fade snapshot — decorative cosmetic fade of outgoing overlay.
                  PRIMARY overlay (below) is always cleared synchronously.
                  This snapshot fades out over EXIT_FADE_MS then is removed by setTimeout. */}
              {exitingSnapshot && (
                <g className="overlay-exit-fade" aria-hidden="true" data-testid="overlay-exit-snapshot">
                  {/* Render exiting route */}
                  {exitingSnapshot.route && exitingSnapshot.route.length >= 2 && (() => {
                    const pts = exitingSnapshot.route
                      .map((id) => { const z = ZONES.find(z2 => z2.id === id); if (!z) return null; return getZoneCenter(z); })
                      .filter((p): p is { x: number; y: number } => p !== null);
                    if (pts.length < 2) return null;
                    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
                    const exitingColor = exitingSnapshot.routeVariant === 'emergency' ? '#ef4444' : 'var(--color-accent)';
                    return (
                      <path d={d} fill="none" stroke={exitingColor} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7,5" style={{ pointerEvents: 'none' }} />
                    );
                  })()}
                </g>
              )}

              {/* Route line — M5: motion.path with pathLength draw animation, §22.8 */}
              {routePathD && (() => {
                const isEmergency = routeVariant === 'emergency';
                const routeColor = isEmergency ? '#ef4444' : 'var(--color-accent)';
                const routeShadowColor = isEmergency ? 'rgba(239, 68, 68, 0.2)' : 'rgba(37, 99, 235, 0.2)';
                const routeMarker = isEmergency ? 'url(#route-arrow-emergency)' : 'url(#route-arrow)';
                return (
                  <g id="route-overlay">
                    {/* Shadow stroke (static, instant) */}
                    <path
                      d={routePathD}
                      fill="none"
                      stroke={routeShadowColor}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Animated draw stroke */}
                    <motion.path
                      d={routePathD}
                      fill="none"
                      stroke={routeColor}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="7,5"
                      markerEnd={routeMarker}
                      style={{ pathLength: 0 }}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={routeDrawTransition(route ? route.length - 1 : 1)}
                      onAnimationComplete={() => {
                        setRouteDrawDone(true);
                        if (routeResolverRef.current) {
                          routeResolverRef.current();
                          routeResolverRef.current = null;
                        }
                      }}
                    />
                    {/* Arrow marker at destination — mounts only after draw completes */}
                    {routeDrawDone && routeDestPoint && (
                      <motion.circle
                        cx={routeDestPoint.x}
                        cy={routeDestPoint.y}
                        r={5}
                        fill={routeColor}
                        stroke="white"
                        strokeWidth="2"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                  </g>
                );
              })()}

              {/* Highlighting — M5: motion.path/circle with scale-pulse entrance */}
              {(() => {
                if (!highlightedZone) return null;
                const zoneObj = ZONES.find((z) => z.id === highlightedZone.zoneId);
                if (!zoneObj) return null;

                if (zoneObj.type === "section") {
                  const pathObj = sectionPaths.find((p) => p.id === highlightedZone.zoneId);
                  if (pathObj) {
                    return (
                      <motion.path
                        key={`highlight-${highlightedZone.zoneId}`}
                        d={pathObj.d}
                        fill="rgba(37,99,235,0.08)"
                        stroke="var(--color-accent)"
                        strokeWidth="2.5"
                        className={highlightedZone.pulse ? "animate-pulse" : ""}
                        style={{ pointerEvents: "none" }}
                        variants={highlightVariants}
                        initial="initial"
                        animate={highlightedZone.pulse ? "pulse" : "settled"}
                      />
                    );
                  }
                } else {
                  const p = getZoneCenter(zoneObj);
                  return (
                    <motion.circle
                      key={`highlight-${highlightedZone.zoneId}`}
                      cx={p.x}
                      cy={p.y}
                      r={14}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="2.5"
                      className={highlightedZone.pulse ? "animate-pulse" : ""}
                      style={{ pointerEvents: "none" }}
                      variants={highlightVariants}
                      initial="initial"
                      animate={highlightedZone.pulse ? "pulse" : "settled"}
                    />
                  );
                }
                return null;
              })()}

              {/* Pins dropped — M5: motion.g with spring bounce entrance */}
              {pins.map((pin) => {
                const zoneObj = ZONES.find((z) => z.id === pin.zoneId);
                if (!zoneObj) return null;
                const p = getZoneCenter(zoneObj);
                const pinColor = pin.kind === "incident" ? "var(--color-danger)" : pin.kind === "dispatch" ? "var(--color-accent)" : "var(--color-text-secondary)";

                return (
                  <motion.g
                    key={`pin-${pin.zoneId}-${pin.kind}`}
                    transform={`translate(${p.x}, ${p.y})`}
                    variants={pinDropVariants}
                    initial="initial"
                    animate="animate"
                  >
                    {/* White halo stroke for contrast against any background density color */}
                    <path
                      d="M 0,0 C -4,-8 -7,-12 -7,-16 A 7,7 0 1,1 7,-16 C 7,-12 4,-8 0,0 Z"
                      fill={pinColor}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                    <circle cx="0" cy="-16" r="2.5" fill="white" />
                  </motion.g>
                );
              })}

              {/* You-are-here — §22.8, rendered in the SVG overlay layer */}
              {(() => {
                if (!currentZoneId) return null;
                const zone = ZONES.find((z) => z.id === currentZoneId);
                if (!zone) return null;
                const p = getZoneCenter(zone);
                const zoneSensorCount = sensorCounts[currentZoneId] ?? 0;
                return (
                  <g id="you-are-here-marker" style={{ pointerEvents: "none" }}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="8.5"
                      fill="none"
                      stroke="var(--color-danger)"
                      strokeWidth="2"
                      className="pulsing-ring"
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="3"
                      fill="var(--color-danger)"
                      stroke="white"
                      strokeWidth="1.5"
                    />
                    {/* Unobtrusive sensorCounts readout for the fan-as-sensor mechanic */}
                    <g transform={`translate(${p.x + 10}, ${p.y - 14})`}>
                      <rect
                        width={12 + String(zoneSensorCount).length * 5}
                        height="10"
                        rx="3"
                        fill="rgba(17,24,39,0.75)"
                      />
                      <text
                        x={6 + String(zoneSensorCount).length * 2.5}
                        y="7.5"
                        textAnchor="middle"
                        fontSize="7"
                        fontWeight="700"
                        fill="white"
                        aria-label={`Sensor count for your zone: ${zoneSensorCount}`}
                      >
                        {zoneSensorCount}
                      </text>
                    </g>
                  </g>
                );
              })()}
            </g>
          </svg>

          {/* 8. HTML FACILITY-ICON OVERLAY — §22.4/§22.9 */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="false">
            {POIS.map((poi) => {
              const posPct = pctPos(poi.r, poi.angle);
              const spec = FACILITY_SPECS.find((s) => s.type === poi.type);
              const color = spec?.color ?? "#2C2C2A";
              const iconPath = POI_ICON_MAP[poi.type] || POI_ICON_MAP.info;
              const isClosed = poi.status === "closed";

              return (
                <div
                  key={poi.id}
                  id={poi.id}
                  className="map-interactive"
                  role="button"
                  tabIndex={0}
                  title={poi.label}
                  aria-label={`${poi.label}, status: ${poi.status}`}
                  onClick={() => onPoiClick?.(poi.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPoiClick?.(poi.id);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: `${posPct.left}%`,
                    top: `${posPct.top}%`,
                    transform: "translate(-50%, -50%)",
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    border: `1.5px solid ${color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    pointerEvents: "auto",
                  }}
                >
                  <svg width={12} height={12} viewBox="0 0 24 24">
                    <path d={iconPath} fill={color} />
                  </svg>
                  {isClosed && (
                    <svg width={20} height={20} viewBox="0 0 20 20" style={{ position: "absolute", inset: 0 }}>
                      <line x1="4" y1="4" x2="16" y2="16" stroke="#94a3b8" strokeWidth="1.5" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>



          {/* Clear Map button overlay */}
          {(route || highlightedZone) && (
            <div className="absolute top-2 right-2 z-50 pointer-events-auto">
              <button
                onClick={handleClearOverlay}
                className="bg-white/90 backdrop-blur-sm text-xs font-medium px-3 py-1.5 rounded-full shadow border border-border text-text hover:bg-canvas transition-colors flex items-center gap-1.5"
                aria-label="Clear map overlay"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                Clear Map
              </button>
            </div>
          )}
          </div>

          {/* ACCESSIBILITY (A11Y) SCREEN-READER FALLBACK LIST */}
          <div
            style={{
              position: "absolute",
              width: "1px",
              height: "1px",
              padding: 0,
              margin: "-1px",
              overflow: "hidden",
              clip: "rect(0, 0, 0, 0)",
              whiteSpace: "nowrap",
              borderWidth: 0
            }}
          >
            <h3>Interactive Stadium Map Accessible List</h3>
            <ul>
              {ZONES.filter((z) => z.type === "section").map((zone) => (
                <li key={`a11y-sec-li-${zone.id}`}>
                  <button
                    onClick={() => onZoneClick?.(zone.id)}
                    aria-label={`Section ${zone.label}, Tier ${zone.tier}, status: ${getStatusText(density?.[zone.id])}`}
                  >
                    Select Section {zone.label}
                  </button>
                </li>
              ))}
              {ZONES.filter((z) => z.type === "gate").map((gate) => (
                <li key={`a11y-gate-li-${gate.id}`}>
                  <button
                    onClick={() => onZoneClick?.(gate.id)}
                    aria-label={`${gate.label}, status: ${gateStatus?.[gate.id] || "open"}`}
                  >
                    Select {gate.label}
                  </button>
                </li>
              ))}
              {ZONES.filter((z) => z.type === "transit").map((transit) => (
                <li key={`a11y-transit-li-${transit.id}`}>
                  <button
                    onClick={() => onZoneClick?.(transit.id)}
                    aria-label={transit.label}
                  >
                    Select {transit.label}
                  </button>
                </li>
              ))}
              {POIS.map((poi) => (
                <li key={`a11y-poi-li-${poi.id}`}>
                  <button
                    onClick={() => onPoiClick?.(poi.id)}
                    aria-label={`${poi.label}, status: ${poi.status}`}
                  >
                    Select POI {poi.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </TooltipProvider>
    );
  }
));

StadiumMap.displayName = "StadiumMap";
