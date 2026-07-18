# M18 — Organizer AI Copilot

The **Organizer AI Copilot** is a natural-language operations command assistant designed to help stadium operations managers identify risks, interpret crowd forecasts, and determine staffing deployment strategies.

---

## 1. AI-vs-Logic Separation (Grounded Predictions)

To prevent LLM hallucinations, particularly regarding predictive numerical statistics, StadiumIQ enforces a strict separation between mathematical prediction engines and conversational generation layers:

1. **Deterministic Computation**: When the user requests a crowd forecast (via the *"Generate 15-Min Forecast"* tool), the system calls the M7 forecasting engine (`findPeakCrush` and `forecastAt`) to calculate exact predicted timestamps and seating/gate density percentages.
2. **Prompts Grounding**: These calculated numbers (e.g. peak time is 25:00, section 101 has 85% density) are passed directly into the LLM system parameters as immutable, hard values.
3. **No Fabrication Rule**: The prompt strictly instructs the LLM that it is forbidden from inventing or altering any metrics. The LLM's role is exclusively to draft a narrative explaining the pre-calculated numbers in a human-friendly format and output corresponding crew dispatch recommendations.

---

## 2. Injection-Defense Approach

To protect the system from prompt injection attempts, any untrusted user inputs (such as free-text query briefs) are heavily defended before prompt interpolation:
- **Sanitization**: All input query strings are stripped of system instruction boundary tags (specifically `<user_message>`, `</user_message>`, `<user_query>`, and `</user_query>`), replacing them with `[filtered]`.
- **Delimitation**: The queries are wrapped in strict `<user_query>[sanitized]</user_query>` block tags in the final LLM prompt, ensuring the model isolates user commands from system directives.

---

## 3. Token-Efficiency Approach

To maintain high speed and minimize token costs, StadiumIQ practices aggressive grounding data summarization:
- **Incidents**: The system filters out resolved incidents and submits only the top 10 most recent unresolved incidents.
- **Densities**: The system filters out safe zones and submits only the top 5 densest zones exceeding $50\%$ density.
- **Gates**: Exposes brief status records (`open`, `congested`, `closed`) rather than deep log dumps.

---

## 4. Resilience & Fallbacks

Following F4's resilience guidelines, if the LLM connection fails, times out, or returns a malformed response:
- The system catches the error instead of throwing a crash or rendering a broken card.
- A **structured local fallback brief** is compiled. For risk briefs, it lists active incidents formatted with automatic priority tags. For forecasts, it renders a deterministic explanation based directly on the peak crush engine data, advising the operator of backup crowd control deployment guidelines.
- If the endpoint request encounters an unrecoverable server failure, an error alert banner is displayed in the panel, allowing manual retries.
