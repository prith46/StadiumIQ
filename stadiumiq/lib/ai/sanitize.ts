/**
 * lib/ai/sanitize.ts
 *
 * Single, canonical prompt-injection sanitization path for F4''s AI layer.
 *
 * PROBLEM: Prior to this file, injection defense was copy-pasted 4x across
 * agents.ts, copilot.ts (x2), and incidentReport.ts -- each stripping a
 * DIFFERENT set of tags. In particular, incidentReport.ts only stripped
 * <user_message> tags but wrapped the note inside <incident>...</incident>,
 * meaning a note containing "</incident>" could break out of its delimiter
 * block and inject arbitrary instructions (audit finding 4.3).
 *
 * FIX: Every piece of user-supplied text (fan messages, organizer queries,
 * incident notes) passes through sanitizeUserInput() before being embedded
 * in any prompt block. This function strips ALL block-delimiter tags used
 * anywhere in our prompt templates so that no single call site can miss a
 * tag variant.
 *
 * No zustand/react/network imports -- trivially testable.
 */

/**
 * All XML-style block delimiters used across our prompt templates.
 * Extending this list here automatically covers every call site.
 */
const DELIMITER_TAGS = [
  'user_message',
  'user_query',
  'incident',
  'assignment',
  'stadium_snapshot',
  'forecast_calculations',
];

/**
 * Common prompt-injection idioms — imperative attempts to override the system
 * prompt or exfiltrate it. These are deliberately multi-word and specific so
 * they don't touch legitimate fan phrasing: "ignore the previous gate" or
 * "forget about the queue" do NOT match (only override targets like
 * "instructions"/"prompt"/"system prompt" do).
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|the\s+|any\s+|your\s+)*(?:previous|above|prior|earlier|preceding|foregoing)\s+(?:instruction|prompt|message|context|direction|rule)s?/gi,
  /disregard\s+(?:all\s+|the\s+|any\s+|your\s+)*(?:previous|above|prior|earlier|system)\s*(?:instruction|prompt|message|context|direction|rule)s?/gi,
  /forget\s+(?:everything|all|the\s+above|(?:the\s+|your\s+|all\s+)?previous\s+(?:instruction|prompt|message|context)s?|your\s+(?:instruction|prompt|rule)s?)/gi,
  /(?:reveal|show|print|repeat|output|expose|leak|reprint|display)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+|initial\s+|original\s+)?(?:prompt|instruction|rule)s?/gi,
  /you\s+are\s+now\s+(?:a\b|an\b|the\b|no\s+longer\b|going\s+to\b)/gi,
];

/**
 * Strip every block-delimiter tag (open and close variants, case-insensitive)
 * from user-supplied text AND neutralize common prompt-injection override
 * idioms, replacing each match with [filtered].
 *
 * Two layers of defense:
 *  1. Block-delimiter tags: prevents user text from escaping its surrounding
 *     XML block and injecting additional prompt instructions.
 *  2. Injection idioms: neutralizes free-text "ignore previous instructions" /
 *     "reveal your system prompt"-style overrides that carry no tag but still
 *     attempt to hijack the model. (Best-effort — the system prompt remains the
 *     primary defense; this reduces the attack surface without over-matching
 *     legitimate messages.)
 */
export function sanitizeUserInput(text: string): string {
  let result = text;
  for (const tag of DELIMITER_TAGS) {
    // Opening tag: <tag> or <tag attr="..."> style
    result = result.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi'), '[filtered]');
    // Closing tag: </tag>
    result = result.replace(new RegExp(`<\\/${tag}>`, 'gi'), '[filtered]');
  }
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, '[filtered]');
  }
  return result;
}
