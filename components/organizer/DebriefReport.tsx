"use client";

import React, { useState } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import { matchPhase } from '@/lib/simulation/engine';
import { FileText, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

// memo(): no props, self-subscribed to its own store slices — the parent
// Dashboard re-renders every 1s for its clock display and must not cascade here.
export const DebriefReport = React.memo(DebriefReportComponent);

function DebriefReportComponent() {
  const matchClockSec = useSimStore((s) => s.matchClockSec);
  const density = useSimStore((s) => s.density || {});
  const gateStatus = useSimStore((s) => s.gateStatus || {});
  const incidents = useSimStore((s) => s.incidents || []);
  const routedLoad = useSimStore((s) => s.routedLoad || {});
  const sensorCounts = useSimStore((s) => s.sensorCounts || {});
  const timeline = useSimStore((s) => s.timeline || []);
  const sequencerPhase = useSimStore((s) => s.sequencerPhase);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<string | null>(null);

  const isFullTime = sequencerPhase
    ? (sequencerPhase === 'post' || sequencerPhase === 'idle')
    : (matchPhase(matchClockSec) === 'fullTime');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setReport(null);

    try {
      const res = await fetch('/api/debrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequencerPhase,
          simSnapshot: {
            matchClockSec,
            density,
            gateStatus,
            incidents,
            routedLoad,
            sensorCounts,
            timeline,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setReport(data.report);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to generate debrief report.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4"
      data-testid="debrief-report-container"
    >
      <div className="flex items-center justify-between border-b border-border/60 pb-3 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="bg-slate-500/10 p-2 rounded-lg text-slate-600">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-display font-extrabold text-sm text-text-primary">Post-Event Debrief Report</h3>
            <p className="text-[10px] text-text-secondary">AI-generated retrospective analysis of this session</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!isFullTime || loading}
          title={isFullTime ? undefined : 'Available once the match reaches full-time'}
          data-testid="generate-debrief-btn"
          className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          {loading ? 'Generating...' : 'Generate Debrief'}
        </button>
      </div>

      {loading && (
        <div
          className="flex flex-col items-center justify-center py-10 border border-dashed border-border bg-canvas/40 rounded-xl text-xs text-text-secondary gap-2 h-32"
          data-testid="debrief-loading"
        >
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <span className="font-semibold text-[10px] uppercase tracking-wider text-text-secondary/80">
            Compiling session debrief...
          </span>
        </div>
      )}

      {error && !loading && (
        <div
          className="p-4 border border-red-200 bg-red-50/60 text-red-800 rounded-xl text-xs flex flex-col gap-2"
          data-testid="debrief-error"
        >
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-[9px] text-red-900">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            Debrief Generation Failed
          </div>
          <p className="font-medium text-red-950">{error}</p>
          <button
            type="button"
            onClick={handleGenerate}
            data-testid="debrief-retry-btn"
            className="self-start flex items-center gap-1.5 text-[10px] font-bold text-red-800 hover:underline cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}

      {report && !loading && !error && (
        <div
          className="bg-canvas border border-border/60 rounded-xl p-4 text-xs flex flex-col gap-2 max-h-[420px] overflow-y-auto scrollbar-thin"
          data-testid="debrief-report-content"
        >
          {report.split('\n').map((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed) return null;
            if (trimmed.startsWith('##')) {
              return (
                <h4 key={idx} className="font-display font-extrabold text-[11px] text-text-primary uppercase tracking-wider mt-1.5 first:mt-0">
                  {trimmed.replace(/^#+\s*/, '')}
                </h4>
              );
            }
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
              return (
                <p key={idx} className="text-text-primary leading-relaxed pl-3">
                  {trimmed.replace(/^[-*]\s*/, '• ')}
                </p>
              );
            }
            return (
              <p key={idx} className="text-text-primary leading-relaxed">
                {trimmed}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
