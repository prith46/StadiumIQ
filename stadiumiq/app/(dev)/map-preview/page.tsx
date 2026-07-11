"use client";

import React, { useRef, useState, useEffect } from "react";
import { StadiumMap, StadiumMapHandle } from "@/components/StadiumMap";
import { StadiumMapErrorBoundary } from "@/components/StadiumMapErrorBoundary";
import { ZONES } from "@/lib/venue/venue";
import { useSimStore } from "@/lib/store/simStore";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export default function MapPreviewPage() {
  const mapRef = useRef<StadiumMapHandle>(null);
  
  // Controls state
  const [mode, setMode] = useState<"fan" | "organizer">("organizer");
  const [currentZoneId, setCurrentZoneId] = useState<string>("sec-101");
  const [selectedZone, setSelectedZone] = useState<string>("sec-101");
  const [selectedPinKind, setSelectedPinKind] = useState<"incident" | "dispatch" | "poi">("incident");
  const [routePath, setRoutePath] = useState<string>("sec-101,concourse-1-n,gate-a");
  const [eventLogs, setEventLogs] = useState<string[]>([]);
  const [simulateDensity, setSimulateDensity] = useState(true);
  const [simulateError, setSimulateError] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(false);

  const applyScenario = useSimStore((s) => s.applyScenario);
  const density = useSimStore((s) => s.density);

  // 1. Dynamic simulation ticking mock (updates store densities dynamically)
  useEffect(() => {
    if (!simulateDensity || isLoadingState) return;

    const interval = setInterval(() => {
      const patch: Record<string, number> = {};
      ZONES.forEach((zone) => {
        // Generate values that shift over time using sine waves based on angle
        const base = (zone.angle ?? 0) / 360;
        const timeFactor = Date.now() / 4000;
        const noiseVal = Math.sin(base * Math.PI * 2 + timeFactor) * 0.4 + 0.5;
        patch[zone.id] = Math.max(0, Math.min(1, noiseVal));
      });
      applyScenario({ density: patch });
    }, 1000);

    return () => clearInterval(interval);
  }, [simulateDensity, isLoadingState, applyScenario]);

  // 2. Control Loading state override
  useEffect(() => {
    if (isLoadingState) {
      applyScenario({ density: undefined });
    }
  }, [isLoadingState, applyScenario]);

  const logEvent = (msg: string) => {
    setEventLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 19),
    ]);
  };

  const handleZoneClick = (zoneId: string) => {
    const zone = ZONES.find((z) => z.id === zoneId);
    logEvent(`Clicked Zone: ${zoneId} (${zone?.label || "Unknown"}, Type: ${zone?.type})`);
    setSelectedZone(zoneId);
  };

  const handlePoiClick = (poiId: string) => {
    logEvent(`Clicked POI: ${poiId}`);
  };

  // Helper component to simulate render crash
  const CrashDummy = () => {
    if (simulateError) {
      throw new Error("Preview Crash Simulated!");
    }
    return null;
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6 p-6 max-w-7xl mx-auto w-full min-h-screen bg-slate-50">
      {/* Visual Map Render Column */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 min-h-[500px]">
        <h1 className="text-xl font-bold text-slate-800 mb-2">MetLife Stadium Live Twin Map</h1>
        <p className="text-sm text-slate-500 mb-6">Interactive crowd densities, gates, transport, and custom routes.</p>
        
        <StadiumMapErrorBoundary reload={() => logEvent("ErrorBoundary Reload Clicked")}>
          <CrashDummy />
          <StadiumMap
            ref={mapRef}
            mode={mode}
            currentZoneId={currentZoneId}
            onZoneClick={handleZoneClick}
            onPoiClick={handlePoiClick}
            className="w-full"
          />
        </StadiumMapErrorBoundary>
      </div>

      {/* Controls Sidebar Column */}
      <div className="w-full xl:w-[400px] flex flex-col gap-6">
        {/* Core Controls */}
        <Card className="border border-slate-100 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-md font-bold">Map Settings & Sim</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>View Mode</span>
              <div className="flex gap-2 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                <button
                  onClick={() => setMode("fan")}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    mode === "fan" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Fan
                </button>
                <button
                  onClick={() => setMode("organizer")}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    mode === "organizer" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Organizer
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>Live Heatmap Simulation</span>
              <Switch checked={simulateDensity} onCheckedChange={setSimulateDensity} />
            </div>

            <div className="flex items-center justify-between">
              <span>Simulate Loading State</span>
              <Switch checked={isLoadingState} onCheckedChange={setIsLoadingState} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-red-600 font-medium">Force Render Exception</span>
              <Switch checked={simulateError} onCheckedChange={setSimulateError} />
            </div>
            
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-semibold mb-1">Set "You Are Here" Location</label>
              <select
                className="w-full p-2 border border-slate-200 rounded-lg text-slate-700 bg-white"
                value={currentZoneId}
                onChange={(e) => setCurrentZoneId(e.target.value)}
              >
                {ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label} ({z.type})
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Imperative API / Overlays */}
        <Card className="border border-slate-100 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-md font-bold">Imperative Overlays (Ref API)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm text-slate-600">
            {/* Highlights */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold">Highlight Zone</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 p-2 border border-slate-200 rounded-lg text-slate-700 bg-white"
                  value={selectedZone}
                  onChange={(e) => setSelectedZone(e.target.value)}
                >
                  {ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label} ({z.type})
                    </option>
                  ))}
                  <option value="sec-999">sec-999 (Invalid - Test Warnings)</option>
                </select>
                <Button
                  size="sm"
                  onClick={() => {
                    logEvent(`Ref Call: highlightZone(${selectedZone}, pulse: true)`);
                    mapRef.current?.highlightZone(selectedZone, { pulse: true });
                  }}
                >
                  Highlight
                </Button>
              </div>
            </div>

            {/* Routes */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold">Draw Route (Comma-separated IDs)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 p-2 border border-slate-200 rounded-lg text-slate-700 bg-white text-xs font-mono"
                  value={routePath}
                  onChange={(e) => setRoutePath(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const arr = routePath.split(",").map((s) => s.trim());
                    logEvent(`Ref Call: drawRoute(${JSON.stringify(arr)})`);
                    mapRef.current?.drawRoute(arr);
                  }}
                >
                  Route
                </Button>
              </div>
            </div>

            {/* Pins */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold">Drop Pin</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 p-2 border border-slate-200 rounded-lg text-slate-700 bg-white"
                  value={selectedPinKind}
                  onChange={(e) => setSelectedPinKind(e.target.value as any)}
                >
                  <option value="incident">Incident (Red)</option>
                  <option value="dispatch">Dispatch (Green)</option>
                  <option value="poi">POI Highlight (Amber)</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    logEvent(`Ref Call: dropPin(${selectedZone}, ${selectedPinKind})`);
                    mapRef.current?.dropPin(selectedZone, selectedPinKind);
                  }}
                >
                  Drop Pin
                </Button>
              </div>
            </div>

            {/* Clear button */}
            <Button
              className="w-full mt-2"
              variant="destructive"
              onClick={() => {
                logEvent("Ref Call: clearOverlay()");
                mapRef.current?.clearOverlay();
              }}
            >
              Clear Overlays
            </Button>
          </CardContent>
        </Card>

        {/* Logs */}
        <Card className="flex-1 border border-slate-100 shadow-sm max-h-[250px] overflow-hidden flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-slate-400 uppercase tracking-wider">Event & Activity Logs</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 pt-0 font-mono text-[10px] text-slate-500 leading-relaxed bg-slate-900 rounded-b-lg">
            {eventLogs.length === 0 ? (
              <span className="text-slate-600 italic">No events logged yet.</span>
            ) : (
              eventLogs.map((log, idx) => (
                <div key={idx} className="border-b border-slate-800 py-1 last:border-0">
                  {log}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
