export interface VoiceInputResult {
  transcript: string;
  isFinal: boolean;
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
  if (typeof window === "undefined") return null;

  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

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

    recognition.onresult = (event: any) => {
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

    recognition.onerror = (event: any) => {
      onError(event.error || "Speech recognition error");
    };

    return {
      start: () => {
        try {
          recognition.start();
        } catch (e: any) {
          onError(e.message || "Failed to start recognition");
        }
      },
      stop: () => {
        try {
          recognition.stop();
        } catch (e) {
          // ignore
        }
      },
    };
  } catch (err: any) {
    onError(err.message || "Failed to initialize SpeechRecognition");
    return null;
  }
}
