# M13 — Voice In & Out

Hands-free digital twin assistance is provided via browser-native Web Speech APIs. The module implements Speech-to-Text (STT) for input transcription and Text-to-Speech (TTS) for reading aloud assistant responses.

---

## Technical Architecture

### 1. Browser API Feature Detection
Because Web Speech APIs are not universally supported across all browsers, both Speech Recognition and Speech Synthesis are wrapped in independent feature-detection checks:
- **Speech Recognition (STT)**: Detects `window.SpeechRecognition || window.webkitSpeechRecognition`. If absent, the microphone UI is completely removed from the DOM.
- **Speech Synthesis (TTS)**: Detects `window.speechSynthesis`. If absent, all TTS triggers are bypassed.

### 2. Language Tag Mapping
The Speech APIs require full BCP-47 locale tags (e.g. `pt-BR`) instead of short country/language codes (e.g. `pt`). The system maps the detected fan language to the most common host/match locale:
- **`en`** $\implies$ **`en-US`** (English)
- **`es`** $\implies$ **`es-MX`** (Spanish - Mexico host)
- **`pt`** $\implies$ **`pt-BR`** (Portuguese - Brazil)
- **`fr`** $\implies$ **`fr-FR`** (French)
- **`ja`** $\implies$ **`ja-JP`** (Japanese)
- **`ko`** $\implies$ **`ko-KR`** (Korean)
- **`de`** $\implies$ **`de-DE`** (German)
- **`it`** $\implies$ **`it-IT`** (Italian)
- **`nl`** $\implies$ **`nl-NL`** (Dutch)
- **`hr`** $\implies$ **`hr-HR`** (Croatian)
- **`da`** $\implies$ **`da-DK`** (Danish)
- **`sv`** $\implies$ **`sv-SE`** (Swedish)
- **`pl`** $\implies$ **`pl-PL`** (Polish)
- **`uk`** $\implies$ **`uk-UA`** (Ukrainian)
- **`ar`** $\implies$ **`ar-SA`** (Arabic)
- **`fa`** $\implies$ **`fa-IR`** (Persian)
- **`zh`** $\implies$ **`zh-CN`** (Chinese)
- **`uz`** $\implies$ **`uz-UZ`** (Uzbek)

---

## Integration Flow

### 1. Voice Input (STT)
1. **Trigger**: Clicking the Microphone button inside `AssistantEntryPoints` starts a SpeechRecognition session.
2. **Visual Feedback**: The button starts a Framer Motion pulsing aura and displays a "Listening..." indicator below the text input.
3. **Transcription**: Interim and final results are piped directly into the `text` state of `ChatInput`.
4. **Error Handling**: Missing browser microphone permissions are caught and render an error badge.

### 2. Voice Output (TTS)
1. **Condition**: Checks if `ttsEnabled` is `true` inside `useA11yStore`.
2. **Trigger**: When the assistant streams back tokens or completes a response, `speak()` is invoked.
3. **Interruption**: Starting any new speech request or toggling TTS off calls `stopSpeaking()`, canceling active browser speech immediately.
4. **Cleanup**: Synthesis cancels automatically when the `AssistantPanel` unmounts.
