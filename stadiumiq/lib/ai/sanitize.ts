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
 * Strip every block-delimiter tag (open and close variants, case-insensitive)
 * from user-supplied text, replacing each match with [filtered].
 *
 * This prevents any user-controlled text from escaping its surrounding XML
 * block and injecting additional prompt instructions.
 */
export function sanitizeUserInput(text: string): string {
  let result = text;
  for (const tag of DELIMITER_TAGS) {
    // Opening tag: <tag> or <tag attr="..."> style
    result = result.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi'), '[filtered]');
    // Closing tag: </tag>
    result = result.replace(new RegExp(`<\\/${tag}>`, 'gi'), '[filtered]');
  }
  return result;
}
