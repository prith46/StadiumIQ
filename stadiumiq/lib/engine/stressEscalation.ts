import { FanContext, Incident } from '../types';
import { detectStressHeuristic } from '../ai/stressDetection';

export interface StressEscalationInput {
  message: string;
  fanContext: FanContext;
  matchClockSec: number;
  existingIncidents: Incident[];   // to check dedup/cooldown
  cooldownSec?: number;            // default 300 (5 min) — no duplicate incident from same fan session within this window
}

/**
 * Pure function: evaluates if a user message warrants auto-creating a safety incident.
 * Returns a new Incident to append to the simulation state, or null if no stress is
 * detected or the incident is deduplicated within the cooldown window.
 */
export function evaluateStressEscalation(input: StressEscalationInput): Incident | null {
  const { message, fanContext, matchClockSec, existingIncidents, cooldownSec = 300 } = input;

  const location = fanContext.location;
  if (!location) {
    return null; // Can't report or escalate without a location
  }

  // Detect stress heuristic
  const stressResult = detectStressHeuristic(message);
  if (!stressResult.isStress) {
    return null;
  }

  // Check cooldown deduplication:
  // Is there a recent non-resolved (or simply existing) assistance/medical incident in the same zone?
  const hasRecentIncident = existingIncidents.some((inc) => {
    return (
      inc.zoneId === location &&
      (inc.type === 'assistance' || inc.type === 'medical') &&
      Math.abs(matchClockSec - inc.createdAt) < cooldownSec
    );
  });

  if (hasRecentIncident) {
    return null; // Deduplicated
  }

  // Build sanitized, length-capped incident note
  let cleanNote = message.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
  if (cleanNote.length > 200) {
    cleanNote = cleanNote.substring(0, 197) + '...';
  }

  // Determine type: high confidence matches are escalate to medical; otherwise assistance
  const type = stressResult.confidence === 'high' ? 'medical' : 'assistance';
  const id = `inc-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;

  return {
    id,
    type,
    zoneId: location,
    note: cleanNote,
    status: 'pending',
    createdAt: matchClockSec,
  };
}
