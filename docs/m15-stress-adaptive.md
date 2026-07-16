# M15 — Stress-Adaptive Safety

The **Stress-Adaptive Safety** module (M15) introduces empathetic, emotionally-aware real-time safety responses in the StadiumIQ assistant. It scans fan messages for panic or urgent distress language, adapts the assistant's UI/UX to decrease user cognitive load, and automatically escalates safety-critical situations to MetLife Stadium operations.

---

## Stress Heuristic & Prevention of False Positives

To guarantee low-false-positive alerts and avoid flooding the organizer queue with routine queries, a deterministic offline-capable keyword and pattern heuristic is employed.

### Standalone Keyword Triggers
The following terms indicate clear and present distress, immediately triggering a stress classification on their own:
- **High Severity (Confidence: 'high' ⇒ auto-creates 'medical' Incident)**:
  `"can't breathe"`, `"cant breathe"`, `"chest pain"`, `"heart attack"`, `"bleeding"`, `"fire"`, `"evacuate"`, `"evacuation"`, `"emergency"`
- **Low Severity (Confidence: 'low' ⇒ auto-creates 'assistance' Incident)**:
  `"scared"`, `"panic"`, `"danger"`, `"hurt"`, `"stuck"`, `"trapped"`, `"injured"`

### The "Help" Co-Occurrence Rule
The word `"help"` is commonly used by fans in routine, neutral queries (e.g. *"help me find my seat"* or *"can you help me find Gate B"*). Treating `"help"` as a standalone trigger would result in massive false-positive noise.

To prevent this:
1. **No Standalone Trigger**: `"help"` on its own or when combined only with location names or seat terms does NOT classify as stress.
2. **Co-Occurrence Constraint**: `"help"` only counts as a stress signal when it co-occurs with at least one other indicators:
   - Another low-severity keyword (e.g., `"scared"`, `"panic"`, `"danger"`, `"hurt"`, `"stuck"`, `"trapped"`, `"injured"`)
   - Any high-severity keyword
   - Punctuation signals (e.g. `!!` or `??`)
   - Case signals (ALL CAPS shouting)
3. **Debug Indicator**: Combined matches append a `'help-combination'` tag to the list of matched signals for validation and traceability.

---

## Escalation & Cooldown Deduplication Policy

When a user triggers the stress heuristic, StadiumIQ automatically creates an incident in the operational log so that stadium staff can deploy aid.

### Cooldown Rules
To prevent spamming duplicate incidents from the same fan session during an ongoing conversation, we enforce a **300-second (5 minute)** cooldown window:
- **Rule**: If there is an active incident with type `'assistance'` or `'medical'` at the same location (`fanContext.location`) created within the last 5 minutes of simulation match time (`matchClockSec`), evaluation returns `null` and no new incident is created.
- **Incident Note Sanitation**: User messages are trimmed and stripped of control characters before truncation to `200 characters` max.

---

## UI/UX Calm Mode Visual System

When `meta.stress` is detected on a response:
1. **Header Style**: The header background changes to a calming, muted green-blue/teal theme (`bg-teal-900`) and the status label switches to "Calm Mode".
2. **Clutter Reduction**: Quick action chips are completely hidden to minimize simultaneous UI distractions and focus the fan's attention.
3. **Typography Scaling**: Affected assistant chat bubbles render text with the `text-base font-medium` class (enlarging text relative to standard layout).
4. **Staff Acknowledgment Banner**: A subtle, non-alarming toast banner is displayed above the chat area: *"On-site staff has been notified of your location. Please stay calm."*
