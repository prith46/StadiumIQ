import { createClient, ChatMessage } from './client';
import { Incident } from '../types';
import { DispatchAssignment } from '../engine/dispatch';
import { sanitizeUserInput } from './sanitize';

/**
 * Generates an AI summary report for a resolved incident.
 * Sanitizes input values against tag injection and runs a chat completion via F4's client.
 */
export async function generateIncidentReport(
  incident: Incident,
  assignment: DispatchAssignment
): Promise<string> {
  // Strip ALL prompt-block delimiter tags from user-supplied note text.
  // incidentReport embeds note inside <incident>…</incident> so we must
  // strip <incident> in addition to the other tags — this is the gap
  // that the old inline two-tag sanitizer missed (audit finding 4.3).
  const sanitizedNote = sanitizeUserInput(incident.note);
  // id/zoneId/responderId are also request-supplied strings interpolated into
  // the same prompt block — sanitize them too (the route length-caps them).
  const sanitizedId = sanitizeUserInput(incident.id);
  const sanitizedZoneId = sanitizeUserInput(incident.zoneId);
  const sanitizedResponderId = assignment.responderId ? sanitizeUserInput(assignment.responderId) : null;

  const systemPrompt =
    'You are the StadiumIQ Operations Auditor AI for MetLife Stadium. ' +
    'Provide a short, professional, plain-text summary of this resolved safety incident. ' +
    'State what happened, the assigned responder, response ETA, and note the final resolved outcome. ' +
    'Keep the report under 3 sentences and extremely concise.';

  const userPrompt =
    `<incident>\n` +
    `Incident ID: ${sanitizedId}\n` +
    `Type: ${incident.type}\n` +
    `Location Zone: ${sanitizedZoneId}\n` +
    `Reported Clock: ${incident.createdAt}s\n` +
    `User Notes: ${sanitizedNote}\n` +
    `Status: ${incident.status}\n` +
    `</incident>\n` +
    `<assignment>\n` +
    `Responder: ${sanitizedResponderId || 'None'}\n` +
    `ETA: ${assignment.etaSec !== null ? assignment.etaSec + 's' : 'N/A'}\n` +
    `Breach Predicted: ${assignment.predictedBreach}\n` +
    `</assignment>`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const client = createClient();
    const result = await client.chat(messages, []);
    return result.text || 'Incident resolved successfully. No additional summary details generated.';
  } catch {
    // Fallback behavior on LLM communication failures
    return `Incident resolved. Responder: ${assignment.responderId || 'N/A'}. Location: ${incident.zoneId}. Notes: ${sanitizedNote}.`;
  }
}
