/**
 * lib/ai/parseLlmJson.ts
 *
 * Single canonical "model said it returned JSON" parse path. Every non-agent
 * call site (copilot brief, forecast brief, debrief report) previously
 * repeated the same trim → strip-markdown-fences → JSON.parse dance inline;
 * this helper owns that so fence-handling fixes land in one place.
 *
 * Callers still validate the parsed shape themselves — this only guarantees
 * "syntactically valid JSON value", not any schema.
 */

/** Strip a wrapping ```lang ... ``` markdown fence, if present. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
}

/**
 * Parse the model's raw text response as JSON, tolerating markdown fences.
 * Throws (like JSON.parse) when the text isn't valid JSON — call sites decide
 * how to degrade.
 */
export function parseLlmJson(rawText: string | null): unknown {
  return JSON.parse(stripCodeFences(rawText || ''));
}
