"use client";

import React, { useState } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import {
  Cpu,
  Sparkles,
  Send,
  AlertTriangle,
  Loader2,
  CheckCircle,
  HelpCircle,
  Users,
  Compass
} from 'lucide-react';

export function Copilot() {
  const state = useSimStore.getState();
  
  // Simulation snapshot attributes required for grounding
  const density = useSimStore((s) => s.density || {});
  const incidents = useSimStore((s) => s.incidents || []);
  const gateStatus = useSimStore((s) => s.gateStatus || {});
  const routedLoad = useSimStore((s) => s.routedLoad || {});
  const sensorCounts = useSimStore((s) => s.sensorCounts || {});
  const matchClockSec = useSimStore((s) => s.matchClockSec || 0);
  const timeline = useSimStore((s) => s.timeline || []);

  // UI state
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'idle' | 'brief' | 'forecast'>('idle');

  // Brief output state
  const [brief, setBrief] = useState<{
    summary: string;
    topRisks: Array<{ description: string; zoneId?: string; priority: 1 | 2 | 3 }>;
    recommendedActions: string[];
  } | null>(null);

  // Forecast output state
  const [forecast, setForecast] = useState<{
    peakAtSec: number;
    topZones: Array<{ zoneId: string; density: number }>;
    narrative: string;
    staffingRecommendation: string;
  } | null>(null);

  // Helper to compile current store values into snapshot payload
  const getSnapshot = () => ({
    matchClockSec,
    density,
    gateStatus,
    incidents,
    routedLoad,
    sensorCounts,
    timeline,
  });

  // Handle free-text query submit
  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setBrief(null);
    setForecast(null);
    setMode('brief');

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'brief',
          query: query.trim(),
          simSnapshot: getSnapshot(),
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      setBrief(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to retrieve copilot brief.');
    } finally {
      setLoading(false);
    }
  };

  // Handle 15-minute forecast generation
  const handleForecastClick = async () => {
    setLoading(true);
    setError('');
    setBrief(null);
    setForecast(null);
    setMode('forecast');

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'forecast',
          simSnapshot: getSnapshot(),
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      setForecast(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to retrieve forecast brief.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="copilot-container">
      {/* Action Controls Form */}
      <form onSubmit={handleQuerySubmit} className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask copilot: 'what are my biggest risks?'"
            className="flex-1 px-3.5 py-2 rounded-xl border border-border bg-canvas text-xs focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-secondary/70 text-text-primary"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            data-testid="copilot-submit-btn"
            className="p-2 rounded-xl bg-accent hover:bg-accent/95 text-white disabled:opacity-40 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
            title="Submit query"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleForecastClick}
          disabled={loading}
          data-testid="copilot-forecast-btn"
          className="w-full py-2 px-3 rounded-xl border border-blue-200 hover:border-blue-300 bg-blue-50/50 hover:bg-blue-50 text-blue-800 text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-2 select-none"
        >
          <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
          Generate 15-Min Crowd Forecast
        </button>
      </form>

      {/* Loading Indicator */}
      {loading && (
        <div
          className="flex flex-col items-center justify-center py-10 border border-dashed border-border bg-canvas/40 rounded-xl text-xs text-text-secondary gap-2 h-44"
          data-testid="copilot-loading"
        >
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <span className="font-semibold text-[10px] uppercase tracking-wider text-text-secondary/80">Querying AI Auditor...</span>
        </div>
      )}

      {/* Error Alert Box */}
      {error && !loading && (
        <div
          className="p-4 border border-red-200 bg-red-50/60 text-red-800 rounded-xl text-xs flex flex-col gap-1.5"
          data-testid="copilot-error"
        >
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-[9px] text-red-900">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            Copilot Connection Failure
          </div>
          <p className="font-medium text-red-950">{error}</p>
        </div>
      )}

      {/* Brief Results Output */}
      {mode === 'brief' && brief && !loading && !error && (
        <div className="flex flex-col gap-4 overflow-y-auto max-h-[300px] pr-1 scrollbar-thin animate-fadeIn" data-testid="copilot-brief">
          {/* Situation Summary */}
          <div className="bg-canvas border border-border/60 rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
            <span className="text-[9px] font-bold text-text-secondary uppercase tracking-wider block">Operational Summary</span>
            <p className="text-text-primary leading-relaxed font-medium">{brief.summary}</p>
          </div>

          {/* Top Prioritized Risks */}
          {brief.topRisks && brief.topRisks.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[9px] font-bold text-text-secondary uppercase tracking-wider block px-1">Prioritized Risks</span>
              <div className="flex flex-col gap-2">
                {brief.topRisks.map((risk, index) => {
                  let badgeColor = '';
                  let label = '';
                  if (risk.priority === 1) {
                    badgeColor = 'bg-red-100 text-red-800 border-red-200';
                    label = 'High Priority';
                  } else if (risk.priority === 2) {
                    badgeColor = 'bg-yellow-100 text-yellow-800 border-yellow-200';
                    label = 'Medium';
                  } else {
                    badgeColor = 'bg-blue-100 text-blue-800 border-blue-200';
                    label = 'Low';
                  }

                  return (
                    <div
                      key={index}
                      className="p-3 border border-border/80 rounded-xl bg-surface shadow-sm flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${badgeColor}`}>
                          {label}
                        </span>
                        {risk.zoneId && (
                          <span className="text-[9px] font-bold text-text-secondary">
                            Zone: <span className="text-text-primary font-extrabold">{risk.zoneId}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-text-primary">"{risk.description}"</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommended Operator Action Items */}
          {brief.recommendedActions && brief.recommendedActions.length > 0 && (
            <div className="flex flex-col gap-2 bg-slate-50/50 border border-border rounded-xl p-3.5 text-xs">
              <span className="text-[9px] font-bold text-text-secondary uppercase tracking-wider block">Recommended Dispatch Actions</span>
              <ul className="flex flex-col gap-1.5 mt-0.5">
                {brief.recommendedActions.map((act, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-text-primary text-[11px] font-medium leading-normal">
                    <Compass className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                    <span>{act}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Forecast Results Output */}
      {mode === 'forecast' && forecast && !loading && !error && (
        <div className="flex flex-col gap-4 overflow-y-auto max-h-[300px] pr-1 scrollbar-thin animate-fadeIn" data-testid="copilot-forecast">
          {/* Predictive Narrative */}
          <div className="bg-blue-50/20 border border-blue-200/80 rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
            <span className="text-[9px] font-bold text-blue-800 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              AI Narrative Explanation
            </span>
            <p className="text-blue-950 font-medium leading-relaxed">{forecast.narrative}</p>
          </div>

          {/* Peak calculations */}
          <div className="p-3.5 border border-border/80 rounded-xl bg-surface shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-[9px] font-bold text-text-secondary uppercase tracking-wider block">Predicted Peak Time</span>
              <span className="text-xs font-bold text-text-primary flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-accent" />
                Clock {formatTime(forecast.peakAtSec)}
              </span>
            </div>
            
            <div>
              <span className="text-[9px] font-bold text-text-secondary uppercase tracking-wider block mb-1.5 px-0.5">Peak Density Areas</span>
              {forecast.topZones && forecast.topZones.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {forecast.topZones.map((zone, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs font-medium border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
                      <span className="text-text-primary font-bold">{zone.zoneId}</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                        zone.density >= 0.75
                          ? 'bg-red-100 text-red-800 font-extrabold'
                          : zone.density >= 0.5
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {Math.round(zone.density * 100)}% Density
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-text-secondary italic">No high-density zones forecast.</p>
              )}
            </div>
          </div>

          {/* Staffing Recommendation */}
          <div className="bg-canvas border border-border/60 rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
            <span className="text-[9px] font-bold text-text-secondary uppercase tracking-wider block">Staffing Deployment Advice</span>
            <p className="text-text-primary leading-relaxed font-semibold">{forecast.staffingRecommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
