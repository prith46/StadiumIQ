"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import { StadiumMap } from '@/components/StadiumMap';
import type { StadiumMapHandle } from '@/lib/assistant/mapActionDispatcher';
import { AlertStack } from '@/components/alerts/AlertStack';
import { DispatchQueue } from './DispatchQueue';
import { Copilot } from './Copilot';
import { GodMode } from './GodMode';
import { UploadPanel } from './UploadPanel';
import {
  ShieldAlert,
  AlertTriangle,
  Users,
  Settings,
  Cpu,
  Clock,
  MapPin,
  Megaphone,
  UploadCloud
} from 'lucide-react';

export function Dashboard() {
  const mapRef = useRef<StadiumMapHandle | null>(null);

  // Retrieve states from Zustand store
  const matchClockSec = useSimStore((s) => s.matchClockSec);
  const incidents = useSimStore((s) => s.incidents || []);
  const gateStatus = useSimStore((s) => s.gateStatus || {});
  const sos = useSimStore((s) => s.sos);
  const triggerSos = useSimStore((s) => s.triggerSos);
  const clearSos = useSimStore((s) => s.clearSos);

  // Local state for selecting an incident on the map
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null);
  const [confirmOrganizerSos, setConfirmOrganizerSos] = useState(false);
  const organizerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync pins on map when incidents change
  useEffect(() => {
    if (mapRef.current) {
      // Clear current overlays
      mapRef.current.clearOverlay();

      // Drop unresolved incidents on the map
      incidents.forEach((inc) => {
        if (inc.status !== 'resolved') {
          mapRef.current?.dropPin(inc.zoneId, 'incident');
        }
      });

      // Re-highlight selected incident if it exists and remains active
      if (selectedIncident) {
        const stillActive = incidents.some(
          (inc) => inc.id === selectedIncident.id && inc.status !== 'resolved'
        );
        if (stillActive) {
          mapRef.current?.highlightZone(selectedIncident.zoneId, { pulse: true });
        } else {
          setSelectedIncident(null);
        }
      }
    }
  }, [incidents, selectedIncident]);

  // Handle organizer SOS double-click timeout
  const handleOrganizerSosClick = () => {
    if (confirmOrganizerSos) {
      triggerSos('organizer');
      setConfirmOrganizerSos(false);
      if (organizerTimeoutRef.current) clearTimeout(organizerTimeoutRef.current);
    } else {
      setConfirmOrganizerSos(true);
      organizerTimeoutRef.current = setTimeout(() => {
        setConfirmOrganizerSos(false);
      }, 3000);
    }
  };

  useEffect(() => {
    return () => {
      if (organizerTimeoutRef.current) clearTimeout(organizerTimeoutRef.current);
    };
  }, []);

  // Handle clicking a zone on the map: if it contains an active incident, show detail
  const handleZoneClick = (zoneId: string) => {
    const matchedInc = incidents.find(
      (inc) => inc.zoneId === zoneId && inc.status !== 'resolved'
    );
    if (matchedInc) {
      setSelectedIncident(matchedInc);
      mapRef.current?.highlightZone(zoneId, { pulse: true });
    } else {
      setSelectedIncident(null);
      // Clear highlight on map
      mapRef.current?.clearOverlay();
      // Restore pins
      incidents.forEach((inc) => {
        if (inc.status !== 'resolved') {
          mapRef.current?.dropPin(inc.zoneId, 'incident');
        }
      });
    }
  };

  // Format time (s) -> mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const activeIncidentsCount = incidents.filter((inc) => inc.status !== 'resolved').length;

  return (
    <div className="w-full min-h-screen bg-canvas p-6 flex flex-col gap-6 text-text-primary">
      {/* 1. Header & Quick Stats Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">Live Operations Command Center</span>
          <h1 className="font-display text-2xl font-extrabold text-text-primary flex items-center gap-2">
            <Cpu className="w-6 h-6 text-accent" />
            <span>StadiumIQ Ops Console</span>
          </h1>
        </div>

        {/* Quick KPI Panels */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-surface border border-border px-3 py-2 rounded-xl flex items-center gap-2.5 shadow-sm text-xs">
            <Clock className="w-4 h-4 text-text-secondary" />
            <div>
              <span className="text-[10px] text-text-secondary uppercase tracking-wider block">Match Clock</span>
              <span className="font-bold">{formatTime(matchClockSec)}</span>
            </div>
          </div>
          <div className="bg-surface border border-border px-3 py-2 rounded-xl flex items-center gap-2.5 shadow-sm text-xs">
            <Users className="w-4 h-4 text-text-secondary" />
            <div>
              <span className="text-[10px] text-text-secondary uppercase tracking-wider block">Seating Sections</span>
              <span className="font-bold">60</span>
            </div>
          </div>
          <div className="bg-surface border border-border px-3 py-2 rounded-xl flex items-center gap-2.5 shadow-sm text-xs">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            <div>
              <span className="text-[10px] text-text-secondary uppercase tracking-wider block">Active Incidents</span>
              <span className={`font-bold ${activeIncidentsCount > 0 ? 'text-red-600' : 'text-text-primary'}`}>
                {activeIncidentsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Emergency SOS Broadcast controls (M14) */}
        <div className={`p-4 rounded-xl border flex items-center gap-4 transition-all shadow-sm max-w-sm ${
          sos?.active
            ? 'bg-red-950 border-red-500 text-white animate-pulse'
            : 'bg-surface border-border text-text-primary'
        }`}>
          <div className="shrink-0">
            <Megaphone className={`w-5 h-5 ${sos?.active ? 'text-red-400' : 'text-text-secondary'}`} />
          </div>
          <div className="flex-1 min-w-[150px] text-xs">
            <p className="font-bold uppercase tracking-wider text-[10px]">
              {sos?.active ? 'Global Override Active' : 'Emergency Override'}
            </p>
            <p className={`text-[10px] mt-0.5 ${sos?.active ? 'text-red-200' : 'text-text-secondary'}`}>
              {sos?.active ? 'Evacuation override broadcasting...' : 'Trigger stadium-wide evacuation'}
            </p>
          </div>
          {sos?.active ? (
            <button
              type="button"
              onClick={clearSos}
              className="py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] transition-all cursor-pointer shadow-sm font-sans"
            >
              Stand Down SOS
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOrganizerSosClick}
              className={`py-1.5 px-3 rounded-lg font-bold text-[10px] transition-all cursor-pointer font-sans ${
                confirmOrganizerSos
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              {confirmOrganizerSos ? 'Confirm SOS?' : 'Trigger SOS'}
            </button>
          )}
        </div>
      </div>

      {/* 2. Main Work Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-6 items-stretch">
        
        {/* Left Side: Map + Incident Details & Placeholders */}
        <div className="flex flex-col gap-6">
          {/* Map Card */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-extrabold text-base text-text-primary flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-accent" />
                  <span>MetLife Stadium Heatmap</span>
                </h2>
                <p className="text-[10px] text-text-secondary">Interactive crowd flow mapping (Hotspots highlight at ≥0.75 density)</p>
              </div>
            </div>

            {/* Stadium Map rendering */}
            <div className="bg-canvas border border-border/60 rounded-xl flex items-center justify-center p-4 min-h-[380px]">
              <StadiumMap
                ref={mapRef}
                mode="organizer"
                onZoneClick={handleZoneClick}
              />
            </div>

            {/* Incident details block */}
            {selectedIncident ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-2 relative animate-fadeIn" data-testid="incident-detail-panel">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-sm text-red-950 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-600 animate-pulse" />
                    <span>Incident Detail: {selectedIncident.id.substring(0, 14)}</span>
                  </h4>
                  <button
                    onClick={() => {
                      setSelectedIncident(null);
                      mapRef.current?.clearOverlay();
                      incidents.forEach((inc) => {
                        if (inc.status !== 'resolved') {
                          mapRef.current?.dropPin(inc.zoneId, 'incident');
                        }
                      });
                    }}
                    className="text-red-700 hover:text-red-950 text-xs font-semibold font-sans cursor-pointer focus:outline-none"
                  >
                    ✕ Close
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-red-900 mt-1">
                  <div>
                    <span className="font-bold block uppercase tracking-wider text-[9px] opacity-70">Location Zone</span>
                    <span className="font-semibold text-red-950">{selectedIncident.zoneId}</span>
                  </div>
                  <div>
                    <span className="font-bold block uppercase tracking-wider text-[9px] opacity-70">Type</span>
                    <span className="font-semibold capitalize text-red-950">{selectedIncident.type}</span>
                  </div>
                  <div>
                    <span className="font-bold block uppercase tracking-wider text-[9px] opacity-70">Reported Clock</span>
                    <span className="font-semibold text-red-950">{formatTime(selectedIncident.createdAt)}</span>
                  </div>
                  <div>
                    <span className="font-bold block uppercase tracking-wider text-[9px] opacity-70">Status</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-100 text-red-800">{selectedIncident.status}</span>
                  </div>
                </div>
                <div className="text-xs text-red-900 mt-2 border-t border-red-200 pt-2">
                  <span className="font-bold block uppercase tracking-wider text-[9px] opacity-70">Reporter Notes</span>
                  <p className="italic text-red-950 mt-0.5 font-medium">"{selectedIncident.note}"</p>
                </div>
              </div>
            ) : (
              <div className="py-3 px-4 border border-dashed border-border rounded-xl bg-canvas flex items-center justify-center text-xs text-text-secondary select-none">
                {activeIncidentsCount === 0 ? (
                  <span className="flex items-center gap-1.5 text-green-700 font-semibold" data-testid="calm-no-incidents">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    No active incidents. MetLife Stadium operations running smoothly.
                  </span>
                ) : (
                  <span>Click an incident pin on the map to show incident details.</span>
                )}
              </div>
            )}
          </div>

          {/* Bottom Area: Placeholders for Dispatch & God Mode */}
          {/* Bottom Area: Dispatch Queue, God Mode, and Judge Upload */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Dispatch queue controller (M17) */}
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3 min-h-[220px]">
              <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-1">
                <div className="bg-accent/10 p-2 rounded-lg text-accent">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <h3 className="font-display font-extrabold text-sm text-text-primary">Dispatch Operations Queue</h3>
              </div>
              <DispatchQueue />
            </div>

            {/* God Mode Simulator (M19) */}
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3 min-h-[220px]">
              <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-1">
                <div className="bg-amber-500/10 p-2 rounded-lg text-amber-600">
                  <Settings className="w-4 h-4" />
                </div>
                <h3 className="font-display font-extrabold text-sm text-text-primary">God Mode Scenario Simulator</h3>
              </div>
              <GodMode />
            </div>

            {/* Judge Data Upload Panel (M20) */}
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3 min-h-[220px]">
              <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-1">
                <div className="bg-blue-500/10 p-2 rounded-lg text-blue-600">
                  <UploadCloud className="w-4 h-4" />
                </div>
                <h3 className="font-display font-extrabold text-sm text-text-primary">Judge Data-Upload Panel</h3>
              </div>
              <UploadPanel />
            </div>
          </div>
        </div>

        {/* Right Side: Alerts Feed + Copilot Placeholder */}
        <div className="flex flex-col gap-6">
          {/* Operations Alerts Feed (M6 inline) */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4 flex-1">
            <div>
              <h2 className="font-display font-extrabold text-base text-text-primary">Operations Alerts Feed</h2>
              <p className="text-[10px] text-text-secondary">Real-time operational warnings and system notifications</p>
            </div>
            
            <div className="flex-1">
              <AlertStack
                inline={true}
                filterKinds={['ops', 'safety', 'proactive', 'incentive']}
                mapRef={mapRef}
              />
            </div>
          </div>

          {/* Operational Copilot (M18) */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3 min-h-[220px]">
            <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-1">
              <div className="bg-purple-500/10 p-2 rounded-lg text-purple-600">
                <Cpu className="w-4 h-4" />
              </div>
              <h3 className="font-display font-extrabold text-sm text-text-primary">AI Operations Copilot</h3>
            </div>
            <Copilot />
          </div>
        </div>

      </div>
    </div>
  );
}
