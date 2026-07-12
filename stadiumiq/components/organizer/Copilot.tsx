"use client";

import React, { useState } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import { RESPONDERS } from '@/lib/venue/responders';
import { MessageList } from '@/components/assistant/MessageList';
import type { Message } from '@/components/assistant/MessageBubble';
import {
  Cpu,
  Sparkles,
  Send,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

interface Brief {
  summary: string;
  topRisks: Array<{
    description: string;
    zoneId?: string;
    priority: 1 | 2 | 3;
  }>;
  recommendedActions: string[];
}

interface Forecast {
  peakAtSec: number;
  topZones: Array<{
    zoneId: string;
    density: number;
    confidenceBand?: {
      densityLow: number;
      densityHigh: number;
      crossingSecEarliest: number;
      crossingSecLatest: number;
      method: 'sampled' | 'heuristic';
    };
  }>;
  narrative: string;
  staffingRecommendation: string;
  prepositioning?: Array<{
    responderId: string;
    fromZone: string;
    toZone: string;
    recommendedDepartSec: number;
    willArriveInTime: boolean;
  }>;
}

// Fix 7: floor before both the /60 and %60 — a non-integer secs value (e.g.
// an interpolated timeline timestamp) otherwise leaks a raw float into the
// seconds component (e.g. "01:0.9990000000000023").
function formatTime(secs: number): string {
  const wholeSecs = Math.floor(secs);
  const m = Math.floor(wholeSecs / 60);
  const s = wholeSecs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const priorityLabel = (priority: 1 | 2 | 3) =>
  priority === 1 ? 'High Priority' : priority === 2 ? 'Medium' : 'Low';

// Fix 2: format the brief/forecast results as plain message text so they
// render through the exact same MessageBubble/MessageList path as a typed
// query, instead of separate fixed display blocks.
function formatBriefMessage(brief: Brief): string {
  const lines: string[] = [brief.summary];

  if (brief.topRisks && brief.topRisks.length > 0) {
    lines.push('', '**Prioritized Risks:**');
    brief.topRisks.forEach((risk) => {
      const zoneSuffix = risk.zoneId ? ` (Zone: ${risk.zoneId})` : '';
      lines.push(`- [${priorityLabel(risk.priority)}] "${risk.description}"${zoneSuffix}`);
    });
  }

  if (brief.recommendedActions && brief.recommendedActions.length > 0) {
    lines.push('', '**Recommended Dispatch Actions:**');
    brief.recommendedActions.forEach((action) => lines.push(`- ${action}`));
  }

  return lines.join('\n');
}

function formatForecastMessage(forecast: Forecast, matchClockSec: number): string {
  const lines: string[] = [forecast.narrative];

  lines.push('', `**Predicted Peak Time:** Clock ${formatTime(forecast.peakAtSec)}`);

  if (forecast.topZones && forecast.topZones.length > 0) {
    lines.push('', '**Peak Density Areas:**');
    forecast.topZones.forEach((zone) => {
      let line = `- ${zone.zoneId}: ${Math.round(zone.density * 100)}% Density`;
      if (zone.confidenceBand) {
        const lowPct = Math.round(zone.confidenceBand.densityLow * 100);
        const highPct = Math.round(zone.confidenceBand.densityHigh * 100);
        const earliestMin = Math.round((zone.confidenceBand.crossingSecEarliest - matchClockSec) / 60);
        const latestMin = Math.round((zone.confidenceBand.crossingSecLatest - matchClockSec) / 60);
        line += ` (likely ${lowPct}–${highPct}%, ${earliestMin}–${latestMin} min)`;
      }
      lines.push(line);
    });
  } else {
    lines.push('', 'No high-density zones forecast.');
  }

  lines.push('', `**Staffing Deployment Advice:** ${forecast.staffingRecommendation}`);

  if (forecast.prepositioning && forecast.prepositioning.length > 0) {
    forecast.prepositioning.forEach((rec) => {
      const label = RESPONDERS.find((r) => r.id === rec.responderId)?.label || rec.responderId;
      lines.push(
        rec.willArriveInTime
          ? `- Move ${label} from ${rec.fromZone} to ${rec.toZone} — depart by ${formatTime(rec.recommendedDepartSec)}`
          : `- Recommended: move ${label} from ${rec.fromZone} to ${rec.toZone} — unable to preposition in time`
      );
    });
  }

  return lines.join('\n');
}

export function Copilot() {
  // Simulation snapshot attributes required for grounding
  const density = useSimStore((s) => s.density || {});
  const incidents = useSimStore((s) => s.incidents || []);
  const gateStatus = useSimStore((s) => s.gateStatus || {});
  const routedLoad = useSimStore((s) => s.routedLoad || {});
  const sensorCounts = useSimStore((s) => s.sensorCounts || {});
  const matchClockSec = useSimStore((s) => s.matchClockSec || 0);
  const timeline = useSimStore((s) => s.timeline || []);

  // Fix 3: a single scrollable chat thread (same Message shape/components as
  // M2's Fan assistant panel) replaces the old two-mode brief/forecast state.
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState<{ kind: 'query'; text: string } | { kind: 'forecast' } | null>(null);

  const getSnapshot = () => ({
    matchClockSec,
    density,
    gateStatus,
    incidents,
    routedLoad,
    sensorCounts,
    timeline,
  });

  const appendMessage = (role: Message['role'], content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `${role}-${Date.now()}-${Math.random()}`, role, content, timestamp: new Date() },
    ]);
  };

  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setError('');
    setLastAction({ kind: 'query', text: trimmed });
    appendMessage('user', trimmed);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'brief',
          query: trimmed,
          simSnapshot: getSnapshot(),
        }),
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      appendMessage('assistant', formatBriefMessage(data));
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to retrieve copilot brief.');
    } finally {
      setLoading(false);
    }
  };

  // Fix 1 + Fix 2: forecast is triggered from a small header icon button and
  // injects its result into the same chat thread as a normal message.
  const handleForecastClick = async () => {
    setError('');
    setLastAction({ kind: 'forecast' });
    appendMessage('user', 'Generate 15-Min Crowd Forecast');
    setLoading(true);

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'forecast',
          simSnapshot: getSnapshot(),
        }),
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      appendMessage('assistant', formatForecastMessage(data, matchClockSec));
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to retrieve forecast brief.');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    if (!lastAction) return;
    if (lastAction.kind === 'forecast') {
      handleForecastClick();
    } else {
      setQuery(lastAction.text);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="w-full h-full flex flex-col bg-surface border border-border rounded-2xl overflow-hidden shadow-sm" data-testid="copilot-container" role="region" aria-label="Operations Copilot">
      {/* Header: title + small forecast icon button (Fix 1) */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="bg-purple-500/10 p-2 rounded-lg text-purple-600 shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <h3 className="font-display font-extrabold text-sm text-text-primary truncate">AI Operations Copilot</h3>
        </div>
        <button
          type="button"
          onClick={handleForecastClick}
          disabled={loading}
          data-testid="copilot-forecast-btn"
          title="Generate 15-Min Crowd Forecast"
          aria-label="Generate 15-Min Crowd Forecast"
          className="p-2 rounded-xl border border-blue-200 hover:border-blue-300 bg-blue-50/50 hover:bg-blue-50 text-blue-700 disabled:opacity-40 transition-all cursor-pointer shrink-0"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable message thread (Fix 3) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isEmpty && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
            <Sparkles className="w-6 h-6 text-accent/60 mb-2" />
            <p className="text-xs text-text-secondary max-w-[220px]">
              Ask the copilot about current risks, or generate a 15-min crowd forecast.
            </p>
          </div>
        ) : (
          <MessageList messages={messages} isThinking={loading} />
        )}
      </div>

      {/* Inline error banner */}
      {error && (
        <div
          className="px-4 py-3 border-t border-red-100 bg-red-50/50 flex items-center justify-between text-xs text-red-700 animate-fadeIn shrink-0"
          data-testid="copilot-error"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1 font-semibold text-accent hover:text-accent-dark transition-colors px-2 py-1 rounded bg-accent/5 shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Input footer (fixed, Fix 3) */}
      <form onSubmit={handleQuerySubmit} className="p-3 bg-canvas/20 border-t border-border/80 flex gap-2 shrink-0">
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
      </form>
    </div>
  );
}
