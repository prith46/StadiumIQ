import { AI_ENV } from './env';

export class AiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiClientError';
  }
}

export class VisionUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionUnsupportedError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
  /**
   * Gemini function-calling protocol: an opaque signature Gemini attaches to a
   * functionCall part. It MUST be echoed back on the same part when the model
   * turn is replayed as conversation history, or subsequent turns fail with
   * "Function call is missing a thought_signature". Empty for providers (Groq)
   * that don't use it. See https://ai.google.dev/gemini-api/docs/thought-signatures
   */
  thoughtSignature?: string;
}

export interface ChatResult {
  text: string | null;
  toolCalls: ToolCall[];
}

export interface AiClient {
  supportsVision: boolean;
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult>;
  visionChat(messages: ChatMessage[], imageBase64: string, mimeType: string): Promise<ChatResult>;
}

/**
 * Pulls the human-readable error message out of a non-OK provider response so
 * the real cause (e.g. "API key not valid") is preserved instead of a bare
 * status code. Falls back to the raw body / status text if the body isn't the
 * expected `{ error: { message } }` JSON shape.
 */
async function extractProviderError(res: Response): Promise<string> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    return res.statusText || 'unknown error';
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw.slice(0, 500) || res.statusText;
  } catch {
    return raw.slice(0, 500) || res.statusText || 'unknown error';
  }
}

/**
 * Human-readable failure cause from an unknown thrown value — maps the
 * AbortController's AbortError to "timeout" so logs say what actually happened.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === 'AbortError' ? 'timeout' : err.message || 'request failed';
  }
  return 'request failed';
}

async function fetchWithRetry(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  let attempts = 0;
  while (true) {
    attempts++;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(id);

      if (res.status >= 500 || res.status === 429) {
        if (attempts < 2) {
          if (res.status === 429) {
            // Wait 250ms before retrying rate-limited request
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          continue; // retry once
        }
        // Retry exhausted: log the provider's error text server-side so the
        // real cause is diagnosable, but keep the THROWN message down to the
        // status code — the retry-path error message is asserted sanitized
        // (no raw provider text) by tests/ai/client.test.ts.
        console.error(`[fetchWithRetry] failed after retry: HTTP ${res.status}: ${await extractProviderError(res)}`);
        throw new Error(`HTTP error ${res.status}`);
      }

      return res;
    } catch (err) {
      clearTimeout(id);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const isRetryable =
        err instanceof Error && (err.message.includes('fetch') || err.message.includes('HTTP'));
      if (attempts < 2 && (isTimeout || isRetryable)) {
        continue; // retry once
      }
      throw err;
    }
  }
}

/**
 * JSON-schema node as carried in tool definitions and response schemas.
 * Structural, not exhaustive: only the fields this adapter needs to walk are
 * typed; everything else passes through untouched via the index signature.
 */
interface JsonSchemaNode {
  type?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  [key: string]: unknown;
}

// --- Gemini wire types (request) ---

interface GeminiFunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown> };
  thoughtSignature?: string;
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | GeminiFunctionCallPart
  | { functionResponse: { name: string; response: { result: unknown } } };

interface GeminiContent {
  role: 'user' | 'model' | 'function';
  parts: GeminiPart[];
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<{
    functionDeclarations: Array<{ name: string; description: string; parameters: JsonSchemaNode }>;
  }>;
  generationConfig?: { responseMimeType: string; responseSchema: JsonSchemaNode };
}

// --- Gemini wire types (response) ---

interface GeminiResponsePart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  thoughtSignature?: string;
}

interface GeminiResponse {
  error?: { message?: string };
  candidates?: Array<{ content?: { parts?: GeminiResponsePart[] } }>;
}

// --- Groq (OpenAI-compatible) wire types ---

interface GroqToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: GroqToolCall[];
}

interface GroqRequestBody {
  model: string;
  messages: GroqMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  response_format?: { type: 'json_object' };
}

interface GroqResponse {
  error?: { message?: string };
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}

function formatSchemaTypesForGemini(schema: JsonSchemaNode): JsonSchemaNode {
  if (!schema || typeof schema !== 'object') return schema;
  const formatted: JsonSchemaNode = { ...schema };
  if (typeof formatted.type === 'string') {
    formatted.type = formatted.type.toUpperCase();
  }
  if (formatted.properties && typeof formatted.properties === 'object') {
    const props: Record<string, JsonSchemaNode> = {};
    for (const [k, v] of Object.entries(formatted.properties)) {
      props[k] = formatSchemaTypesForGemini(v);
    }
    formatted.properties = props;
  }
  if (formatted.items) {
    formatted.items = formatSchemaTypesForGemini(formatted.items);
  }
  return formatted;
}

/**
 * The structured-output contract ({ message, language, mapActions[], alertLevel })
 * as a Gemini responseSchema. Built and Gemini-formatted ONCE at module load and
 * shared by both chat() and visionChat() — previously this literal was duplicated
 * verbatim across both methods and re-walked by formatSchemaTypesForGemini on
 * every request.
 */
const GEMINI_RESPONSE_SCHEMA: JsonSchemaNode = formatSchemaTypesForGemini({
  type: 'object',
  properties: {
    message: { type: 'string' },
    language: { type: 'string' },
    mapActions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['highlight', 'route', 'pin'] },
          zoneId: { type: 'string' },
          path: { type: 'array', items: { type: 'string' } },
        },
        required: ['op'],
      },
    },
    alertLevel: { type: 'string', enum: ['none', 'info', 'warn', 'critical'] },
  },
  required: ['message', 'language', 'mapActions', 'alertLevel'],
});

/**
 * Parses an assistant-turn history entry that encodes prior tool calls as a
 * JSON array (see runPlanningLoop, which stores them via JSON.stringify).
 * Returns [] when the content is plain assistant text rather than tool calls.
 */
function parseHistoryToolCalls(content: string): ToolCall[] {
  if (!content.startsWith('[') || !content.endsWith(']')) return [];
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof (parsed[0] as ToolCall)?.name === 'string') {
      return parsed as ToolCall[];
    }
  } catch {
    // Not a tool-call array — treat as plain text.
  }
  return [];
}

class GeminiClient implements AiClient {
  supportsVision = true;

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    try {
      // Key travels in a header, not the URL — query strings end up in
      // proxy/server logs.
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_ENV.LLM_MODEL}:generateContent`;

      let systemInstructionText = '';
      const contents: GeminiContent[] = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          // Concatenate: callers send multiple system messages (base prompt +
          // context summary) and overwriting would drop the primary prompt.
          systemInstructionText = systemInstructionText
            ? `${systemInstructionText}\n\n${msg.content}`
            : msg.content;
          continue;
        }

        if (msg.role === 'user') {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }]
          });
        } else if (msg.role === 'assistant') {
          const toolCalls = parseHistoryToolCalls(msg.content);

          if (toolCalls.length > 0) {
            contents.push({
              role: 'model',
              parts: toolCalls.map((tc): GeminiPart => {
                const part: GeminiFunctionCallPart = {
                  functionCall: {
                    name: tc.name,
                    args: tc.args
                  }
                };
                // Echo the thought signature back on the same part — Gemini
                // requires it on every functionCall part sent as history.
                if (tc.thoughtSignature) {
                  part.thoughtSignature = tc.thoughtSignature;
                }
                return part;
              })
            });
          } else {
            contents.push({
              role: 'model',
              parts: [{ text: msg.content }]
            });
          }
        } else if (msg.role === 'tool') {
          let resultObj: unknown;
          try {
            resultObj = JSON.parse(msg.content);
          } catch {
            resultObj = { value: msg.content };
          }
          contents.push({
            role: 'function',
            parts: [{
              functionResponse: {
                name: msg.toolCallId || 'tool',
                response: { result: resultObj }
              }
            }]
          });
        }
      }

      const body: GeminiRequestBody = { contents };

      if (systemInstructionText) {
        body.systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };
      }

      if (tools.length > 0) {
        body.tools = [{
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: formatSchemaTypesForGemini(t.parameters as JsonSchemaNode)
          }))
        }];
      }

      // Tool-less calls (the planning loop's forced final turn, and every
      // single-shot caller like copilot/debrief) must return the structured
      // output contract — request it natively via responseSchema.
      if (tools.length === 0) {
        body.generationConfig = {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        };
      }

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': AI_ENV.LLM_API_KEY },
        body: JSON.stringify(body),
      }, AI_ENV.LLM_TIMEOUT_MS);

      if (!res.ok) {
        throw new Error(`Gemini API ${res.status}: ${await extractProviderError(res)}`);
      }

      const data = (await res.json()) as GeminiResponse;
      if (data.error) {
        throw new Error(data.error.message || 'Gemini response error');
      }

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let text: string | null = null;
      const toolCalls: ToolCall[] = [];

      for (const part of parts) {
        if (part.text !== undefined) {
          text = part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            args: part.functionCall.args || {},
            id: part.functionCall.name,
            // Preserve Gemini's thought signature so it can be replayed on the
            // functionCall part in the next turn's history (required by the
            // Gemini function-calling protocol).
            thoughtSignature: part.thoughtSignature,
          });
        }
      }

      return { text, toolCalls };
    } catch (err) {
      const detail = describeError(err);
      // Log the real underlying cause (e.g. "Gemini API 400: API key not valid")
      // rather than only the generic wrapper, so failures are diagnosable from logs.
      console.error('[GeminiClient.chat] request failed:', detail);
      throw new AiClientError('Gemini communication failure: ' + detail);
    }
  }

  async visionChat(messages: ChatMessage[], imageBase64: string, mimeType: string): Promise<ChatResult> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_ENV.LLM_MODEL}:generateContent`;

      let systemInstructionText = '';
      const contents: GeminiContent[] = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemInstructionText = systemInstructionText
            ? `${systemInstructionText}\n\n${msg.content}`
            : msg.content;
          continue;
        }

        if (msg.role === 'user') {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }]
          });
        }
      }

      if (contents.length > 0) {
        contents[contents.length - 1].parts.push({
          inlineData: {
            mimeType,
            data: imageBase64
          }
        });
      }

      const body: GeminiRequestBody = {
        contents,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        }
      };

      if (systemInstructionText) {
        body.systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };
      }

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': AI_ENV.LLM_API_KEY },
        body: JSON.stringify(body),
      }, AI_ENV.LLM_TIMEOUT_MS);

      if (!res.ok) {
        throw new Error(`Gemini API ${res.status}: ${await extractProviderError(res)}`);
      }

      const data = (await res.json()) as GeminiResponse;
      if (data.error) {
        throw new Error(data.error.message || 'Gemini vision error');
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
      return { text, toolCalls: [] };
    } catch (err) {
      const detail = describeError(err);
      console.error('[GeminiClient.visionChat] request failed:', detail);
      throw new AiClientError('Gemini vision communication failure: ' + detail);
    }
  }
}

class GroqClient implements AiClient {
  supportsVision = false;

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    try {
      const url = 'https://api.groq.com/openai/v1/chat/completions';

      const groqMessages = messages.map((msg): GroqMessage => {
        if (msg.role === 'system') {
          return { role: 'system', content: msg.content };
        }
        if (msg.role === 'user') {
          return { role: 'user', content: msg.content };
        }
        if (msg.role === 'assistant') {
          const toolCalls = parseHistoryToolCalls(msg.content);

          if (toolCalls.length > 0) {
            return {
              role: 'assistant',
              content: null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args)
                }
              }))
            };
          }
          return { role: 'assistant', content: msg.content };
        }
        // role === 'tool'
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content
        };
      });

      const body: GroqRequestBody = {
        model: AI_ENV.LLM_MODEL,
        messages: groqMessages,
      };

      if (tools.length > 0) {
        body.tools = tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }
        }));
      } else {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_ENV.LLM_API_KEY}`,
        },
        body: JSON.stringify(body),
      }, AI_ENV.LLM_TIMEOUT_MS);

      if (!res.ok) {
        throw new Error(`Groq API ${res.status}: ${await extractProviderError(res)}`);
      }

      const data = (await res.json()) as GroqResponse;
      if (data.error) {
        throw new Error(data.error.message || 'Groq response error');
      }

      const choice = data.choices?.[0];
      const message = choice?.message;
      const text = message?.content || null;

      const toolCalls: ToolCall[] = [];
      if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // Malformed arguments payload — fall back to no args.
          }
          toolCalls.push({
            name: tc.function.name,
            args,
            id: tc.id
          });
        }
      }

      return { text, toolCalls };
    } catch (err) {
      const detail = describeError(err);
      console.error('[GroqClient.chat] request failed:', detail);
      throw new AiClientError('Groq communication failure: ' + detail);
    }
  }

  async visionChat(): Promise<ChatResult> {
    throw new VisionUnsupportedError('Groq provider does not support vision processing');
  }
}

export function createClient(): AiClient {
  const provider = AI_ENV.LLM_PROVIDER;
  if (provider === 'gemini') {
    return new GeminiClient();
  }
  if (provider === 'groq') {
    return new GroqClient();
  }
  throw new AiClientError(`Unsupported LLM provider: ${provider}`);
}
