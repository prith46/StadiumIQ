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

    recognition.onresult = (event: any) => {
      let transcript = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item && item[0]) {
          transcript += item[0].transcript;
          if (item.isFinal) {
            isFinal = true;
          }
        }
      }
      onResult({ transcript, isFinal });
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
