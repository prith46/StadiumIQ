export interface VoiceInputResult {
  transcript: string;
  isFinal: boolean;
}

// Minimal typings for the (still-prefixed in some browsers) Web Speech API —
// TypeScript's DOM lib does not ship SpeechRecognition declarations.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/**
 * Resolves the browser's SpeechRecognition constructor (standard or webkit-
 * prefixed), or undefined when unsupported. Shared by createSpeechRecognizer
 * and the VoiceInputButton feature check.
 */
export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

/**
 * Creates and wraps browser-native SpeechRecognition.
 * Returns null if the browser does not support SpeechRecognition.
 */
export function createSpeechRecognizer(
  languageTag: string,
  onResult: (result: VoiceInputResult) => void,
  onError: (error: string) => void
): { start: () => void; stop: () => void } | null {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) return null;

  try {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageTag;

    // Accumulates finalized text across the whole session. `event.results`
    // only reports results from `event.resultIndex` onward each time (the
    // portion that's new/changed) — results before that index are already
    // final and won't be repeated. Without this, each event would only ever
    // report its own delta, so pausing mid-sentence (which commits a final
    // result and advances resultIndex) would silently drop everything said
    // before the pause on the next partial result.
    let finalizedTranscript = "";

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let newFinalSegment = "";
      let interimSegment = "";
      let isFinal = false;

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item && item[0]) {
          if (item.isFinal) {
            newFinalSegment += item[0].transcript;
            isFinal = true;
          } else {
            interimSegment += item[0].transcript;
          }
        }
      }

      if (newFinalSegment) {
        finalizedTranscript += newFinalSegment;
      }

      onResult({ transcript: (finalizedTranscript + interimSegment).trim(), isFinal });
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      onError(event.error || "Speech recognition error");
    };

    return {
      start: () => {
        try {
          recognition.start();
        } catch (e) {
          onError(e instanceof Error && e.message ? e.message : "Failed to start recognition");
        }
      },
      stop: () => {
        try {
          recognition.stop();
        } catch {
          // ignore — stopping an inactive recognizer throws in some browsers
        }
      },
    };
  } catch (err) {
    onError(err instanceof Error && err.message ? err.message : "Failed to initialize SpeechRecognition");
    return null;
  }
}
