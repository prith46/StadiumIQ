import { z } from 'zod';
import { FanContext, AssistantResponse } from '../types';
import { createClient, ChatMessage } from './client';
import { executeTool, getToolSchemas, ToolContext, ToolSchema } from './tools';
import { detectStressHeuristic } from './stressDetection';
import { FAN_SYSTEM_PROMPT } from './prompts';
import { sanitizeUserInput } from './sanitize';

export type { AssistantResponse } from '../types';

export type AssistantHistoryTurn = { role: 'user' | 'assistant'; content: string };

export const FALLBACK_RESPONSE: AssistantResponse = {
  message: "I'm having trouble connecting right now. Please try again in a moment, or ask a steward nearby.",
  language: 'en',
  mapActions: [],
  alertLevel: 'none',
};

const assistantResponseSchema = z.object({
  message: z.string(),
  language: z.string(),
  mapActions: z.array(z.object({
    op: z.enum(['highlight', 'route', 'pin']),
    zoneId: z.string().optional(),
    path: z.array(z.string()).optional()
  })),
  alertLevel: z.enum(['none', 'info', 'warn', 'critical']),
  meta: z.object({
    tool: z.string().optional(),
    stress: z.boolean().optional()
  }).optional()
});


const VALID_MAP_OPS = new Set(['highlight', 'route', 'pin']);
const VALID_ALERT_LEVELS = new Set(['none', 'info', 'warn', 'critical']);

/**
 * Best-effort extraction of usable mapActions from a malformed/partial parsed
 * object. Drops any entry that isn't shaped like a real map action rather than
 * rejecting the whole response over one bad entry.
 */
function extractMapActions(value: unknown): AssistantResponse['mapActions'] {
  if (!Array.isArray(value)) return [];
  const actions: AssistantResponse['mapActions'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { op?: unknown; zoneId?: unknown; path?: unknown };
    if (typeof candidate.op !== 'string' || !VALID_MAP_OPS.has(candidate.op)) continue;
    const op = candidate.op as 'highlight' | 'route' | 'pin';
    const zoneId = typeof candidate.zoneId === 'string' ? candidate.zoneId : undefined;
    const path =
      Array.isArray(candidate.path) && candidate.path.every((p): p is string => typeof p === 'string')
        ? candidate.path
        : undefined;
    actions.push({ op, zoneId, path });
  }
  return actions;
}

/**
 * Degrades a JSON.parse or Zod-validation failure into a still-usable
 * AssistantResponse instead of the generic "I'm having trouble" fallback,
 * whenever the model actually said something. Handles two real-world failure
 * modes: (1) the model returned plain conversational text with no JSON at
 * all — wrap it verbatim as `message`; (2) the model returned a JSON object
 * missing/mistyping some required fields — salvage `message` (or any other
 * present, correctly-typed fields) and backfill sensible defaults for the
 * rest, rather than discarding a mostly-good response over one bad field.
 */
function buildLenientFallback(
  rawText: string,
  cleanJson: string,
  fallbackLanguage: string
): AssistantResponse {
  let parsedObject: Record<string, unknown> | null = null;
  try {
    const attempt = JSON.parse(cleanJson);
    if (attempt && typeof attempt === 'object' && !Array.isArray(attempt)) {
      parsedObject = attempt as Record<string, unknown>;
    }
  } catch {
    // Not JSON at all — parsedObject stays null, we fall through to raw text below.
  }

  // Case 1: got a JSON object, salvage whatever fields are usable from it.
  // Models that drift from the exact schema still tend to put the actual
  // reply under one of a few common alternate keys (observed live: Gemini
  // returning `{status, message}` or bare `{error: "..."}` instead of the
  // required shape) — check those before falling back to dumping the raw
  // JSON blob as the message.
  const messageCandidateKeys = ['message', 'error', 'response', 'text', 'summary'] as const;
  const messageKey = parsedObject
    ? messageCandidateKeys.find(
        (key) => typeof parsedObject![key] === 'string' && (parsedObject![key] as string).trim().length > 0
      )
    : undefined;

  if (parsedObject && messageKey) {
    return {
      message: parsedObject[messageKey] as string,
      language: typeof parsedObject.language === 'string' ? parsedObject.language : fallbackLanguage,
      mapActions: extractMapActions(parsedObject.mapActions),
      alertLevel: VALID_ALERT_LEVELS.has(parsedObject.alertLevel as string)
        ? (parsedObject.alertLevel as AssistantResponse['alertLevel'])
        : 'none',
    };
  }

  // Case 2: no usable JSON object (plain text response, or JSON with none of
  // the recognized message-like keys) — wrap whatever text the model
  // produced verbatim, stripped of markdown fences, so the fan gets an
  // actual reply instead of a generic non-answer.
  const plainText = cleanJson.trim();
  if (plainText.length > 0) {
    return {
      message: plainText,
      language: fallbackLanguage,
      mapActions: [],
      alertLevel: 'none',
    };
  }

  // Nothing at all came back — this is the only case with nothing to wrap.
  return { ...FALLBACK_RESPONSE, language: fallbackLanguage };
}

function parseResponse(text: string, userMessage: string, fallbackLanguage: string = 'en'): AssistantResponse {
  let cleanJson = text.trim();
  
  // Extract JSON object if the model wrapped it in conversational text or markdown
  const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleanJson = jsonMatch[0];
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
  }

  const stressResult = detectStressHeuristic(userMessage);

  let response: AssistantResponse;
  try {
    const parsed = JSON.parse(cleanJson);
    response = assistantResponseSchema.parse(parsed);
  } catch (err) {
    // Log for debugging, but degrade gracefully rather than surfacing an
    // error to the user whenever the model's raw text gives us something to
    // work with (§M2 item 7b).
    console.warn('[parseResponse] Model response did not match the AssistantResponse schema; falling back gracefully:', err instanceof Error ? err.message : String(err));

    if (stressResult.stress) {
      return {
        message: "Emergency detected. Please contact stadium stewards immediately.",
        language: fallbackLanguage,
        mapActions: [],
        alertLevel: 'critical',
        meta: { stress: true }
      };
    }

    return buildLenientFallback(text, cleanJson, fallbackLanguage);
  }

  // Apply the deterministic stress heuristic override
  if (stressResult.stress) {
    let finalAlert = response.alertLevel;
    if (finalAlert === 'none' || finalAlert === 'info') {
      finalAlert = 'warn';
    }
    return {
      ...response,
      alertLevel: finalAlert,
      meta: {
        ...response.meta,
        stress: true
      }
    };
  }

  return response;
}

/**
 * If the reportIncident tool ran during the planning loop, attach the incident
 * it created to meta.reportedIncident so the browser can apply it to the live
 * simStore (the server process has no access to the client's store).
 */
function attachReportedIncident(parsed: AssistantResponse, conversation: ChatMessage[]): AssistantResponse {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    if (msg.role !== 'tool' || typeof msg.content !== 'string') continue;
    try {
      const res = JSON.parse(msg.content);
      if (res && res.success === true && res.incident && typeof res.incident.id === 'string') {
        return { ...parsed, meta: { ...parsed.meta, reportedIncident: res.incident } };
      }
    } catch {}
  }
  return parsed;
}

function injectMissingPaths(parsed: AssistantResponse, conversation: ChatMessage[]): AssistantResponse {
  if (!parsed.mapActions) {
    parsed.mapActions = [];
  }
  
  let hasRouteAction = false;

  for (const action of parsed.mapActions) {
    if (action.op === 'route') {
      hasRouteAction = true;
      if (!action.path || action.path.length === 0) {
        for (let i = conversation.length - 1; i >= 0; i--) {
          const msg = conversation[i];
          if (msg.role === 'tool' && typeof msg.content === 'string') {
            try {
              const res = JSON.parse(msg.content);
              if (res.path && Array.isArray(res.path) && res.path.length > 0) {
                action.path = res.path;
                if (!action.zoneId) {
                  action.zoneId = res.path[res.path.length - 1];
                }
                break;
              }
            } catch {}
          }
        }
      }
    }
  }

  // If the AI completely forgot to add a route action but computed a route, auto-append it!
  if (!hasRouteAction) {
    for (let i = conversation.length - 1; i >= 0; i--) {
      const msg = conversation[i];
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        try {
          const res = JSON.parse(msg.content);
          if (res.path && Array.isArray(res.path) && res.path.length > 0) {
            parsed.mapActions.push({
              op: 'route',
              path: res.path,
              zoneId: res.path[res.path.length - 1]
            });
            break;
          }
        } catch {}
      }
    }
  }

  return parsed;
}

async function runPlanningLoop(
  initialMessages: ChatMessage[],
  tools: ToolSchema[],
  ctx: ToolContext,
  userMessage: string,
  fallbackLanguage: string = 'en'
): Promise<AssistantResponse> {
  const client = createClient();
  const conversation = [...initialMessages];
  let roundTrips = 0;

  try {
    while (roundTrips < 2) {
      const result = await client.chat(conversation, tools);

      if (!result.toolCalls || result.toolCalls.length === 0) {
        const parsed = parseResponse(result.text || '', userMessage, fallbackLanguage);
        return attachReportedIncident(injectMissingPaths(parsed, conversation), conversation);
      }

      // Record the tool calls
      conversation.push({
        role: 'assistant',
        content: JSON.stringify(result.toolCalls)
      });

      // Execute each tool call
      for (const call of result.toolCalls) {
        let executionResult: unknown;
        try {
          executionResult = await executeTool(call.name, call.args, ctx);
        } catch (err) {
          executionResult = {
            error: err instanceof Error && err.message ? err.message : 'Tool execution failed',
          };
        }
        conversation.push({
          role: 'tool',
          content: JSON.stringify(executionResult),
          toolCallId: call.id
        });
      }

      roundTrips++;
    }

    // Force final answer on 3rd turn by presenting no tools
    const finalResult = await client.chat(conversation, []);
    const parsed = parseResponse(finalResult.text || '', userMessage, fallbackLanguage);
    return attachReportedIncident(injectMissingPaths(parsed, conversation), conversation);
  } catch (err) {
    console.error('Error in agent planning loop:', err);
    return {
      ...FALLBACK_RESPONSE,
      language: fallbackLanguage
    };
  }
}

export async function runFanAssistant(
  userMessage: string,
  fanContext: FanContext,
  ctx: ToolContext,
  history: AssistantHistoryTurn[] = []
): Promise<AssistantResponse> {
  const sanitized = sanitizeUserInput(userMessage);

  // These fan-context fields are client-supplied strings that land in a
  // SYSTEM-role message, so they get the same treatment as chat text:
  // prompt-delimiter sanitization plus a hard length cap. The API route
  // already caps them via fanContextSchema — repeated here because this
  // function is also reachable without going through the route.
  const cleanField = (value: string | undefined, fallback: string, maxLen: number): string => {
    if (!value) return fallback;
    return sanitizeUserInput(value).slice(0, maxLen);
  };

  const contextSummary = `User Context:
- Language: ${cleanField(fanContext.language, 'en', 35)}
- Current Location: ${cleanField(fanContext.location, 'none', 120)}
- Accessibility Needed: ${fanContext.accessibility}
- Group Type: ${fanContext.group || 'solo'}
- Leaving Early: ${fanContext.leavingEarly || false}
- Ticket Section: ${cleanField(fanContext.ticket?.section, 'none', 40)}
- Ticket Gate: ${cleanField(fanContext.ticket?.gate, 'none', 40)}
- Nationality: ${cleanField(fanContext.ticket?.nationality, 'unknown', 80)}`;

  // Prior conversation turns give the model context for follow-up questions
  // ("how far is that?"). User turns are untrusted like the live message:
  // sanitized and wrapped in the same <user_message> delimiters.
  const historyMessages: ChatMessage[] = history.map((turn) =>
    turn.role === 'user'
      ? { role: 'user' as const, content: `<user_message>${sanitizeUserInput(turn.content)}</user_message>` }
      : { role: 'assistant' as const, content: turn.content }
  );

  const messages: ChatMessage[] = [
    { role: 'system', content: FAN_SYSTEM_PROMPT },
    { role: 'system', content: contextSummary },
    ...historyMessages,
    { role: 'user', content: `<user_message>${sanitized}</user_message>` }
  ];

  return runPlanningLoop(messages, getToolSchemas(), ctx, userMessage, fanContext.language || 'en');
}
