export interface StressDetectionResult {
  isStress: boolean;
  stress: boolean; // Alias for backward compatibility
  confidence: 'high' | 'low';
  matchedSignals: string[];
}

/**
 * Heuristic stress detection.
 * Standalone low-severity and high-severity keywords are direct triggers.
 * The keyword "help" is only a trigger when combined with at least one other stress signal
 * (low-severity keyword, high-severity keyword, excessive punctuation, or all-caps).
 */
export function detectStressHeuristic(message: string): StressDetectionResult {
  const matchedSignals: string[] = [];
  const lower = message.toLowerCase();

  // 1. High-severity keywords (standalone triggers)
  const highKeywords = [
    "can't breathe",
    "cant breathe",
    "chest pain",
    "heart attack",
    "bleeding",
    "fire",
    "evacuate",
    "evacuation",
    "emergency",
  ];

  for (const kw of highKeywords) {
    if (lower.includes(kw)) {
      matchedSignals.push(`keyword:${kw}`);
      matchedSignals.push(`high-keyword:${kw}`);
    }
  }

  // 2. Low-severity keywords (standalone triggers, excluding "help")
  const lowKeywords = [
    "scared",
    "panic",
    "danger",
    "hurt",
    "stuck",
    "trapped",
    "injured",
  ];

  for (const kw of lowKeywords) {
    if (lower.includes(kw)) {
      matchedSignals.push(`keyword:${kw}`);
      matchedSignals.push(`low-keyword:${kw}`);
    }
  }

  // 3. Punctuation signals
  if (message.includes('!!')) {
    matchedSignals.push('exclamation');
  }
  if (message.includes('??')) {
    matchedSignals.push('question-panic');
  }

  // 4. Case signals (ALL CAPS check)
  if (message.length > 8) {
    let alphaCount = 0;
    let upperCount = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      if (/[a-zA-Z]/.test(char)) {
        alphaCount++;
        if (char === char.toUpperCase()) {
          upperCount++;
        }
      }
    }
    // High density of capitals indicates panic shouting
    if (alphaCount >= 3 && (upperCount / alphaCount) > 0.6) {
      matchedSignals.push('all-caps');
    }
  }

  // 5. Co-occurring "help" check
  const hasHelp = lower.includes('help');
  let isStress = false;

  if (matchedSignals.length > 0) {
    isStress = true;
    if (hasHelp) {
      matchedSignals.push('help-combination');
    }
  } else {
    // If no other signals matched, "help" alone does NOT trigger stress.
    isStress = false;
  }

  // Determine confidence
  // High confidence if there are any high-severity keywords matched
  const hasHighSeverity = matchedSignals.some(sig => sig.startsWith('high-keyword:'));
  const confidence = hasHighSeverity ? 'high' : 'low';

  return {
    isStress,
    stress: isStress,
    confidence,
    matchedSignals,
  };
}
