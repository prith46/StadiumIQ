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

      if (res.status >= 500) {
        if (attempts < 2) {
          continue; // retry once
        }
        throw new Error(`HTTP error ${res.status}`);
      }

      return res;
    } catch (err: any) {
      clearTimeout(id);
      const isTimeout = err.name === 'AbortError';
      if (attempts < 2 && (isTimeout || err.message?.includes('fetch') || err.message?.includes('HTTP'))) {
        continue; // retry once
      }
      throw err;
    }
  }
}

function formatSchemaTypesForGemini(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const formatted = { ...schema };
  if (typeof formatted.type === 'string') {
    formatted.type = formatted.type.toUpperCase();
  }
  if (formatted.properties) {
    const props: any = {};
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

class GeminiClient implements AiClient {
  supportsVision = true;

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_ENV.LLM_MODEL}:generateContent?key=${AI_ENV.LLM_API_KEY}`;
      
      let systemInstructionText = '';
      const contents: any[] = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemInstructionText = msg.content;
          continue;
        }

        if (msg.role === 'user') {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }]
          });
        } else if (msg.role === 'assistant') {
          let toolCalls: any[] = [];
          try {
            if (msg.content.startsWith('[') && msg.content.endsWith(']')) {
              toolCalls = JSON.parse(msg.content);
            }
          } catch (_) {}

          if (Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0]?.name) {
            contents.push({
              role: 'model',
              parts: toolCalls.map(tc => ({
                functionCall: {
                  name: tc.name,
                  args: tc.args
                }
              }))
            });
          } else {
            contents.push({
              role: 'model',
              parts: [{ text: msg.content }]
            });
          }
        } else if (msg.role === 'tool') {
          let resultObj = {};
          try {
            resultObj = JSON.parse(msg.content);
          } catch (_) {
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

      const body: any = { contents };

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
            parameters: formatSchemaTypesForGemini(t.parameters)
          }))
        }];
      }

      // Configure JSON schema response format if no tools are actively requested on 3rd turn
      if (tools.length === 0) {
        body.generationConfig = {
          responseMimeType: 'application/json'
        };
      }

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, AI_ENV.LLM_TIMEOUT_MS);

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
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
            id: part.functionCall.name
          });
        }
      }

      return { text, toolCalls };
    } catch (err: any) {
      throw new AiClientError('Gemini communication failure: ' + (err.name === 'AbortError' ? 'timeout' : 'request failed'));
    }
  }

  async visionChat(messages: ChatMessage[], imageBase64: string, mimeType: string): Promise<ChatResult> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_ENV.LLM_MODEL}:generateContent?key=${AI_ENV.LLM_API_KEY}`;
      
      let systemInstructionText = '';
      const contents: any[] = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemInstructionText = msg.content;
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

      const body: any = {
        contents,
        generationConfig: {
          responseMimeType: 'application/json'
        }
      };

      if (systemInstructionText) {
        body.systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };
      }

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, AI_ENV.LLM_TIMEOUT_MS);

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error.message || 'Gemini vision error');
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
      return { text, toolCalls: [] };
    } catch (err: any) {
      throw new AiClientError('Gemini vision communication failure: ' + (err.name === 'AbortError' ? 'timeout' : 'request failed'));
    }
  }
}

class GroqClient implements AiClient {
  supportsVision = false;

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    try {
      const url = 'https://api.groq.com/openai/v1/chat/completions';
      
      const groqMessages = messages.map(msg => {
        if (msg.role === 'system') {
          return { role: 'system', content: msg.content };
        }
        if (msg.role === 'user') {
          return { role: 'user', content: msg.content };
        }
        if (msg.role === 'assistant') {
          let toolCalls: any[] = [];
          try {
            if (msg.content.startsWith('[') && msg.content.endsWith(']')) {
              toolCalls = JSON.parse(msg.content);
            }
          } catch (_) {}

          if (Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0]?.name) {
            return {
              role: 'assistant',
              content: null,
              tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
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

      const body: any = {
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
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error.message || 'Groq response error');
      }

      const choice = data.choices?.[0];
      const message = choice?.message;
      const text = message?.content || null;
      
      const toolCalls: ToolCall[] = [];
      if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (_) {}
          toolCalls.push({
            name: tc.function.name,
            args,
            id: tc.id
          });
        }
      }

      return { text, toolCalls };
    } catch (err: any) {
      throw new AiClientError('Groq communication failure: ' + (err.name === 'AbortError' ? 'timeout' : 'request failed'));
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
