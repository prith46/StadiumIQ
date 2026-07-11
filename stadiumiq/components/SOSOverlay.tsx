"use client";

import React, { useEffect, useRef, useMemo } from 'react';
import { useSimStore } from '../lib/store/simStore';
import { computeSafestExit } from '../lib/engine/safeExit';
import { StadiumMap, StadiumMapHandle } from './StadiumMap';
import { ShieldAlert, LogOut, Info } from 'lucide-react';

export function SOSOverlay() {
  const mapRef = useRef<StadiumMapHandle | null>(null);

  // Read state from simulation store
  const location = useSimStore((s) => s.fanContext.location);
  const gateStatus = useSimStore((s) => s.gateStatus);
  const density = useSimStore((s) => s.density);
  const routedLoad = useSimStore((s) => s.routedLoad);
  const accessibility = useSimStore((s) => s.fanContext.accessibility);
  const sos = useSimStore((s) => s.sos);
  const clearSos = useSimStore((s) => s.clearSos);

  // Compute safest exit route
  const exitRoute = useMemo(() => {
    if (!location) return { path: null, etaSec: null, targetGate: null };
    return computeSafestExit({
      fromZoneId: location,
      gateStatus,
      density,
      routedLoad,
      accessibleOnly: accessibility,
    });
  }, [location, gateStatus, density, routedLoad, accessibility]);

  // Draw the route on the map whenever it changes
  useEffect(() => {
    if (mapRef.current) {
      if (exitRoute.path) {
        mapRef.current.drawRoute(exitRoute.path);
      } else {
        mapRef.current.clearOverlay();
      }
    }
  }, [exitRoute.path]);

  if (!sos?.active) return null;

  const isOrganizerTriggered = sos.triggeredBy === 'organizer';
  const etaMinutes = exitRoute.etaSec ? Math.round(exitRoute.etaSec / 60) : null;
  const gateName = exitRoute.targetGate
    ? exitRoute.targetGate.replace('gate-', '').toUpperCase()
    : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full bg-red-950 text-white rounded-2xl border border-red-500/30 overflow-hidden shadow-2xl p-6 flex flex-col lg:flex-row gap-8 items-stretch animate-fadeIn"
      style={{ minHeight: '600px' }}
    >
      {/* Instructions & Actions Panel */}
      <div className="flex-1 flex flex-col justify-between gap-6">
        <div className="flex flex-col gap-4">
          {/* Header Badge */}
          <div className="flex items-center gap-3">
            <span className="p-2 bg-red-600 rounded-lg animate-pulse">
              <ShieldAlert className="w-6 h-6 text-white" />
            </span>
            <div className="flex flex-col">
              <span className="text-xs uppercase font-extrabold tracking-widest text-red-400">
                StadiumIQ Override
              </span>
              <h1 className="font-display text-2xl font-black tracking-tight text-white">
                {isOrganizerTriggered ? 'STADIUM WIDE EMERGENCY' : 'PERSONAL SOS ACTIVATED'}
              </h1>
            </div>
          </div>

          <hr className="border-red-800" />

          {/* Core Instruction */}
          {exitRoute.path ? (
            <div className="flex flex-col gap-3">
              <span className="text-sm font-semibold uppercase text-red-300 tracking-wider">
                Evacuation Instructions
              </span>
              <div className="bg-red-900/50 border border-red-700/50 rounded-xl p-5 flex flex-col gap-1">
                <span className="text-sm text-red-200">Safest Exit Direction</span>
                <span className="font-display text-3xl font-black text-white">
                  Proceed to Gate {gateName}
                </span>
                <span className="text-sm text-yellow-400 font-bold mt-1">
                  Estimated Walk Time: {etaMinutes} min ({accessibility ? 'Accessible Route' : 'Standard Route'})
                </span>
              </div>

              <div className="text-sm text-red-200 leading-relaxed flex flex-col gap-2 mt-2">
                <div className="flex items-start gap-2">
                  <span className="font-black text-red-400">1.</span>
                  <span>Exit your row calmly and proceed to the main concourse.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-black text-red-400">2.</span>
                  <span>Follow the green emergency path displayed on your map.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-black text-red-400">3.</span>
                  <span>Avoid elevator queues unless access routing is required.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-amber-900/40 border border-amber-600/50 rounded-xl p-5 flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-bold text-amber-300 text-lg">No Evacuation Route Found</span>
                <p className="text-sm text-amber-200 leading-relaxed">
                  All stadium gates are currently congested or closed. Do not attempt to leave your seating section. Stay in place, remain calm, and follow instructions from stadium personnel and public address announcements.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Action Button Footer */}
        <div className="flex flex-col gap-3 mt-4">
          {isOrganizerTriggered ? (
            <div className="bg-red-900/30 border border-red-800/80 rounded-lg p-3.5 text-center text-xs text-red-300">
              Emergency override broadcasts cannot be dismissed locally. The control room will clear this mode once safety checks are completed.
            </div>
          ) : (
            <button
              type="button"
              onClick={clearSos}
              className="w-full py-4 rounded-xl font-bold bg-white text-red-950 hover:bg-red-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg font-sans"
            >
              <LogOut className="w-5 h-5" />
              <span>Cancel SOS & Clear Mode</span>
            </button>
          )}
        </div>
      </div>

      {/* Map Panel */}
      <div className="flex-1 min-h-[350px] lg:min-h-0 bg-red-950 rounded-xl border border-red-900 overflow-hidden flex items-center justify-center relative p-2 shadow-inner">
        <div className="w-full max-w-[450px] aspect-square">
          <StadiumMap ref={mapRef} mode="fan" currentZoneId={location} />
        </div>
        <div className="absolute bottom-4 left-4 bg-red-950/80 border border-red-800/60 px-3 py-1.5 rounded-md text-[10px] uppercase font-bold tracking-widest text-red-300">
          Live Evacuation Map
        </div>
      </div>
    </div>
  );
}
