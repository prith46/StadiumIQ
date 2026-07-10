import { z } from 'zod';

const schema = z.object({
  LLM_PROVIDER: z.enum(['gemini', 'groq']),
  LLM_MODEL: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_TIMEOUT_MS: z.coerce.number().positive().default(8000),
});

let cachedEnv: any = null;
let parseError: any = null;

function parse() {
  try {
    cachedEnv = schema.parse({
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    });
    parseError = null;
  } catch (err) {
    parseError = err;
    cachedEnv = null;
  }
}

// Perform initial parse
parse();

// Export a helper to re-parse environment variables in test scopes
export function reevaluateAiEnv() {
  parse();
}

export const AI_ENV = new Proxy({} as z.infer<typeof schema>, {
  get(target, prop) {
    if (parseError) {
      throw parseError;
    }
    return (cachedEnv as any)[prop];
  }
});
