import { createClient, ChatMessage } from './client';
import { Incident } from '../types';
import { DispatchAssignment } from '../engine/dispatch';

/**
 * Generates an AI summary report for a resolved incident.
 * Sanitizes input values against tag injection and runs a chat completion via F4's client.
 */
export async function generateIncidentReport(
  incident: Incident,
  assignment: DispatchAssignment
): Promise<string> {
  // Strip tag injections from user-derived notes to prevent prompt injection
  const sanitizedNote = incident.note
    .replace(/<user_message>/gi, '[filtered]')
    .replace(/<\/user_message>/gi, '[filtered]');

  const systemPrompt =
    'You are the MetLife Stadium Operations Auditor AI. ' +
    'Provide a short, professional, plain-text summary of this resolved safety incident. ' +
    'State what happened, the assigned responder, response ETA, and note the final resolved outcome. ' +
    'Keep the report under 3 sentences and extremely concise.';

  const userPrompt =
    `<incident>\n` +
    `Incident ID: ${incident.id}\n` +
    `Type: ${incident.type}\n` +
    `Location Zone: ${incident.zoneId}\n` +
    `Reported Clock: ${incident.createdAt}s\n` +
    `User Notes: ${sanitizedNote}\n` +
    `Status: ${incident.status}\n` +
    `</incident>\n` +
    `<assignment>\n` +
    `Responder: ${assignment.responderId || 'None'}\n` +
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
  } catch (err: any) {
    // Fallback behavior on LLM communication failures
    return `Incident resolved. Responder: ${assignment.responderId || 'N/A'}. Location: ${incident.zoneId}. Notes: ${sanitizedNote}.`;
  }
}
