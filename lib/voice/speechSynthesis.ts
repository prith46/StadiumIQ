/**
 * Checks if browser-native SpeechSynthesis is supported.
 */
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

/**
 * Reads the provided text aloud using speech synthesis.
 * Cancels any active utterance before starting the new one.
 * Returns true if speech starts successfully, false otherwise.
 */
export function speak(text: string, languageTag: string, onEnd?: () => void): boolean {
  if (!isSpeechSynthesisSupported()) return false;

  try {
    // Stop any active speech to prevent overlapping voices
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageTag;

    if (onEnd) {
      utterance.onend = () => onEnd();
      utterance.onerror = () => onEnd();
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    console.error("Speech synthesis failure:", err);
    return false;
  }
}

/**
 * Immediately cancels any ongoing browser speech synthesis.
 */
export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch (err) {
      console.error("Failed to cancel speech synthesis:", err);
    }
  }
}
