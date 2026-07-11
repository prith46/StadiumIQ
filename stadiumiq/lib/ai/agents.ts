import { z } from 'zod';
import { FanContext, Zone, SimState } from '../types';
import { createClient, ChatMessage } from './client';
import { executeTool, getToolSchemas, ToolContext, ToolSchema } from './tools';
import { detectStressHeuristic } from './stressDetection';
import { FAN_SYSTEM_PROMPT, COPILOT_SYSTEM_PROMPT } from './prompts';

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

function sanitizeUserMessage(text: string): string {
  return text
    .replace(/<user_message>/gi, '[filtered]')
    .replace(/<\/user_message>/gi, '[filtered]');
}

function parseResponse(text: string, userMessage: string, fallbackLanguage: string = 'en'): AssistantResponse {
  let cleanJson = text.trim();
  if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleanJson);
    const validated = assistantResponseSchema.parse(parsed);

    // Apply the deterministic stress heuristic override
    const stressResult = detectStressHeuristic(userMessage);
    if (stressResult.stress) {
      let finalAlert = validated.alertLevel;
      if (finalAlert === 'none' || finalAlert === 'info') {
        finalAlert = 'warn';
      }
      return {
        ...validated,
        alertLevel: finalAlert,
        meta: {
          ...validated.meta,
          stress: true
        }
      };
    }

    return validated;
  } catch (err) {
    console.error('Failed to parse AssistantResponse:', err, text);
    const stressResult = detectStressHeuristic(userMessage);
    if (stressResult.stress) {
      return {
        message: "Emergency detected. Please contact stadium stewards immediately.",
        language: fallbackLanguage,
        mapActions: [],
        alertLevel: 'critical',
        meta: { stress: true }
      };
    }
    return { ...FALLBACK_RESPONSE, language: fallbackLanguage };
  }
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
        return parseResponse(result.text || '', userMessage, fallbackLanguage);
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
    return parseResponse(finalResult.text || '', userMessage, fallbackLanguage);
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
  const sanitized = sanitizeUserMessage(userMessage);
  const contextSummary = `User Context:
- Language: ${fanContext.language}
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

export async function runOrganizerCopilot(
  query: string,
  ctx: ToolContext
): Promise<AssistantResponse> {
  const sanitized = sanitizeUserMessage(query);
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
