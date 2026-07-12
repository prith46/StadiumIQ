import { z } from 'zod';
import { FanContext, Zone, SimState } from '../types';
import { createClient, ChatMessage } from './client';
import { executeTool, getToolSchemas, ToolContext, ToolSchema } from './tools';
import { detectStressHeuristic } from './stressDetection';
import { FAN_SYSTEM_PROMPT, COPILOT_SYSTEM_PROMPT } from './prompts';
import { sanitizeUserInput } from './sanitize';

export interface AssistantResponse {
  message: string;
  language: string;
  mapActions: Array<{ op: 'highlight' | 'route' | 'pin'; zoneId?: string; path?: string[] }>;
  alertLevel: 'none' | 'info' | 'warn' | 'critical';
  meta?: { tool?: string; stress?: boolean };
}

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
    if (item && typeof item === 'object' && VALID_MAP_OPS.has((item as any).op)) {
      const op = (item as any).op as 'highlight' | 'route' | 'pin';
      const zoneId = typeof (item as any).zoneId === 'string' ? (item as any).zoneId : undefined;
      const path = Array.isArray((item as any).path) && (item as any).path.every((p: unknown) => typeof p === 'string')
        ? (item as any).path
        : undefined;
      actions.push({ op, zoneId, path });
    }
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
        return injectMissingPaths(parsed, conversation);
      }

      // Record the tool calls
      conversation.push({
        role: 'assistant',
        content: JSON.stringify(result.toolCalls)
      });

      // Execute each tool call
      for (const call of result.toolCalls) {
        let executionResult: any;
        try {
          executionResult = await executeTool(call.name, call.args, ctx);
        } catch (err: any) {
          executionResult = { error: err.message || 'Tool execution failed' };
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
    return injectMissingPaths(parsed, conversation);
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
  ctx: ToolContext
): Promise<AssistantResponse> {
  const sanitized = sanitizeUserInput(userMessage);
  const contextSummary = `User Context:
- Language: ${fanContext.language}
- Current Location: ${fanContext.location || 'none'}
- Accessibility Needed: ${fanContext.accessibility}
- Group Type: ${fanContext.group || 'solo'}
- Leaving Early: ${fanContext.leavingEarly || false}
- Ticket Section: ${fanContext.ticket?.section || 'none'}
- Ticket Gate: ${fanContext.ticket?.gate || 'none'}
- Nationality: ${fanContext.ticket?.nationality || 'unknown'}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: FAN_SYSTEM_PROMPT },
    { role: 'system', content: contextSummary },
    { role: 'user', content: `<user_message>${sanitized}</user_message>` }
  ];

  return runPlanningLoop(messages, getToolSchemas(), ctx, userMessage, fanContext.language || 'en');
}

/**
 * @deprecated No external callers — see audit item 2.1. The organizer copilot path
 * has been superseded by getCopilotBrief() in copilot.ts (M6 documented path).
 * Remove once confirmed safe across all deployment targets.
 */
export async function runOrganizerCopilot(
  query: string,
  ctx: ToolContext
): Promise<AssistantResponse> {
  const sanitized = sanitizeUserInput(query);
  const messages: ChatMessage[] = [
    { role: 'system', content: COPILOT_SYSTEM_PROMPT },
    { role: 'user', content: `<user_message>${sanitized}</user_message>` }
  ];

  // Restrict copilot to specific tools
  const copilotTools = getToolSchemas().filter(t =>
    ['getForecast', 'getPolicy', 'computeRoute'].includes(t.name)
  );

  return runPlanningLoop(messages, copilotTools, ctx, query, ctx.fanContext?.language || 'en');
}
