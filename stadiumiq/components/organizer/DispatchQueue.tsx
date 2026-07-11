"use client";

import React, { useState } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import { RESPONDERS } from '@/lib/venue/responders';
import { assignResponder, isBreachPredicted } from '@/lib/engine/dispatch';
import { generateIncidentReport } from '@/lib/ai/incidentReport';
import { computeRoute } from '@/lib/engine/routing';
import { EDGES, ZONES } from '@/lib/venue/venue';
import {
  ShieldAlert,
  UserCheck,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Sparkles,
  HelpCircle
} from 'lucide-react';

export function DispatchQueue() {
  const incidents = useSimStore((s) => s.incidents || []);
  const applyScenario = useSimStore((s) => s.applyScenario);
  
  // Simulation context variables for graph routing distance
  const density = useSimStore((s) => s.density);
  const routedLoad = useSimStore((s) => s.routedLoad);
  const gateStatus = useSimStore((s) => s.gateStatus);

  // Local state to track loading, errors, reports, and failed assignments
  const [loadingReports, setLoadingReports] = useState<Record<string, boolean>>({});
  const [incidentReports, setIncidentReports] = useState<Record<string, string>>({});
  const [assignmentErrors, setAssignmentErrors] = useState<Record<string, string>>({});

  // Dijkstra graph distance function utilizing M3 routing
  const graphDistanceFn = (fromZoneId: string, toZoneId: string): number => {
    const result = computeRoute(
      fromZoneId,
      toZoneId,
      EDGES,
      ZONES,
      density,
      routedLoad,
      gateStatus
    );
    if ('error' in result) {
      return Infinity;
    }
    return result.etaSec;
  };

  // Assign nearest skill-matched responder
  const handleAssign = (incidentId: string) => {
    const incident = incidents.find((inc) => inc.id === incidentId);
    if (!incident) return;

    setAssignmentErrors((prev) => ({ ...prev, [incidentId]: '' }));

    const assignment = assignResponder(incident, RESPONDERS, graphDistanceFn);

    if (assignment.responderId === null) {
      setAssignmentErrors((prev) => ({
        ...prev,
        [incidentId]: 'No matching responder available',
      }));
      return;
    }

    // Update store state: status -> dispatched, add responder and eta
    const updatedIncidents = incidents.map((inc) => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          status: 'dispatched' as const,
          responderId: assignment.responderId || undefined,
          etaSec: assignment.etaSec || undefined,
        };
      }
      return inc;
    });

    applyScenario({ incidents: updatedIncidents });
  };

  // Resolve incident and trigger AI Incident Report generation
  const handleResolve = async (incidentId: string) => {
    const incident = incidents.find((inc) => inc.id === incidentId);
    if (!incident) return;

    // Set loading state
    setLoadingReports((prev) => ({ ...prev, [incidentId]: true }));

    // Reconstruct assignment input
    const assignment = {
      incidentId: incident.id,
      responderId: incident.responderId || null,
      etaSec: incident.etaSec || null,
      predictedBreach: incident.etaSec ? isBreachPredicted(incident.etaSec) : false,
    };

    // Call mockable LLM generator
    const reportText = await generateIncidentReport(incident, assignment);

    // Save report locally
    setIncidentReports((prev) => ({ ...prev, [incidentId]: reportText }));

    // Update store state: status -> resolved
    const updatedIncidents = incidents.map((inc) => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          status: 'resolved' as const,
        };
      }
      return inc;
    });

    applyScenario({ incidents: updatedIncidents });
    setLoadingReports((prev) => ({ ...prev, [incidentId]: false }));
  };

  // Format time (s) -> mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Sort incidents: pending first, then dispatched, resolved at the bottom
  const sortedIncidents = [...incidents].sort((a, b) => {
    const statusPriority = { pending: 0, dispatched: 1, resolved: 2 };
    return statusPriority[a.status] - statusPriority[b.status];
  });

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="dispatch-queue-container">
      {sortedIncidents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-4 border border-dashed border-border rounded-xl bg-canvas text-xs text-text-secondary text-center select-none h-44">
          <p className="font-semibold text-green-700" data-testid="dispatch-empty-state">No incidents in dispatch queue</p>
          <p className="text-[10px] opacity-75 mt-0.5">METLife Stadium is operating smoothly.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
          {sortedIncidents.map((inc) => {
            const responder = RESPONDERS.find((r) => r.id === inc.responderId);
            const isBreached = inc.etaSec ? isBreachPredicted(inc.etaSec) : false;
            const isLoading = !!loadingReports[inc.id];
            const report = incidentReports[inc.id];
            const errorMsg = assignmentErrors[inc.id];

            // Setup color themes depending on status
            let statusBadge = '';
            if (inc.status === 'pending') {
              statusBadge = 'bg-yellow-100 text-yellow-800 border-yellow-200';
            } else if (inc.status === 'dispatched') {
              statusBadge = 'bg-blue-100 text-blue-800 border-blue-200';
            } else {
              statusBadge = 'bg-green-100 text-green-800 border-green-200';
            }

            return (
              <div
                key={inc.id}
                className={`p-4 border rounded-xl bg-surface shadow-sm flex flex-col gap-3 transition-colors ${
                  inc.status === 'pending'
                    ? 'border-yellow-200/60 bg-yellow-50/5'
                    : inc.status === 'dispatched'
                    ? 'border-blue-200/60'
                    : 'border-border'
                }`}
                data-testid={`incident-card-${inc.id}`}
              >
                {/* 1. Header Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${statusBadge}`}>
                      {inc.status}
                    </span>
                    <span className="text-[10px] text-text-secondary font-medium">
                      Zone: <span className="font-semibold text-text-primary">{inc.zoneId}</span>
                    </span>
                  </div>
                  <span className="text-[10px] text-text-secondary font-medium">
                    Reported: {formatTime(inc.createdAt)}
                  </span>
                </div>

                {/* 2. Notes Detail */}
                <div className="text-xs">
                  <span className="font-bold text-text-secondary uppercase text-[8px] tracking-wider block">Incident Brief</span>
                  <p className="mt-0.5 font-medium text-text-primary text-xs">"{inc.note}"</p>
                </div>

                {/* 3. Dispatch & Responder Status Details */}
                {inc.status === 'dispatched' && (
                  <div className="grid grid-cols-2 gap-3 bg-canvas border border-border/40 rounded-lg p-2.5 text-xs">
                    <div>
                      <span className="text-[9px] text-text-secondary block uppercase font-bold tracking-wider">Responder</span>
                      <span className="font-bold text-text-primary flex items-center gap-1">
                        <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                        {responder?.label || inc.responderId}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-text-secondary block uppercase font-bold tracking-wider">ETA</span>
                      <span className={`font-bold flex items-center gap-1 ${isBreached ? 'text-red-600' : 'text-green-600'}`}>
                        <Clock className="w-3.5 h-3.5" />
                        {inc.etaSec} seconds {isBreached && <span className="text-[9px] uppercase px-1 py-0.5 bg-red-100 rounded text-red-700 font-bold ml-1">SLA Breach</span>}
                      </span>
                    </div>
                  </div>
                )}

                {/* 4. Resolved Report Detail */}
                {inc.status === 'resolved' && (
                  <div className="bg-green-50/50 border border-green-200/80 rounded-lg p-3 text-xs flex flex-col gap-1.5 animate-fadeIn">
                    <span className="text-[9px] text-green-800 font-bold uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      AI Post-Incident Report Summary
                    </span>
                    <p className="text-green-950 font-medium italic">
                      {report || 'Incident resolved successfully. Summary report archived.'}
                    </p>
                  </div>
                )}

                {/* 5. Warning messages */}
                {errorMsg && (
                  <div className="px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg text-[10px] text-yellow-800 flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-600 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* 6. Action Controls */}
                <div className="flex items-center gap-2 mt-1">
                  {inc.status === 'pending' && (
                    <button
                      onClick={() => handleAssign(inc.id)}
                      className="py-1.5 px-3 rounded-lg bg-accent hover:bg-accent/95 text-white font-bold text-[10px] transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Assign Nearest Responder
                    </button>
                  )}

                  {inc.status === 'dispatched' && (
                    <button
                      onClick={() => handleResolve(inc.id)}
                      disabled={isLoading}
                      className="py-1.5 px-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold text-[10px] transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5" />
                      )}
                      <span>{isLoading ? 'Generating Report...' : 'Mark as Resolved'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
