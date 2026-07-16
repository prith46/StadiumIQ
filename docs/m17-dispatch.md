# M17 — Dispatch & AI Optimizer

The **Dispatch & AI Optimizer** (M17) module manages MetLife Stadium operations response logic. It bridges active safety/crowd incidents with physical responders, predicts walking ETAs, tracks status transitions, and automatically documents resolved cases with an AI-generated ops auditor summary.

---

## 1. Responder Fixtures Data

A fixed set of **8 responders** is distributed throughout MetLife Stadium to cover all tiers, stands, and gates.
Responders are skill-constrained, corresponding to incident categories (`'medical'`, `'security'`, `'assistance'`, `'crowd'`, `'evacuation'`).

### Responder Fixture Details:
| Responder ID | Label | Initial Zone ID | Skills | Availability |
|---|---|---|---|---|
| `resp-med-1` | Medical Team Alpha | `sec-101` (Lower) | `['medical']` | `true` |
| `resp-med-2` | Medical Team Beta | `sec-112` (Lower) | `['medical']` | `true` |
| `resp-sec-1` | Security Unit A | `sec-205` (Mid) | `['security', 'crowd']` | `true` |
| `resp-sec-2` | Security Unit B | `sec-218` (Mid) | `['security', 'evacuation']` | `true` |
| `resp-ast-1` | Guest Services Team 1 | `sec-305` (Upper) | `['assistance']` | `true` |
| `resp-ast-2` | Guest Services Team 2 | `sec-318` (Upper) | `['assistance']` | `true` |
| `resp-ops-1` | Ops Crew Red | `gate-a` (Concourse) | `['crowd', 'evacuation']` | `true` |
| `resp-ops-2` | Safety Officer Davis | `gate-c` (Concourse) | All Skills | `false` (Excluded in test/routing check) |

---

## 2. Assignment Algorithm

The responder assignment follows a **Nearest-Available Skill-Matched** dijkstra search:
1. **Filtering**: Excludes responders who are unavailable (`available: false`) or whose `skills` array does not contain the target incident `type`.
2. **Pathfinding**: For each candidate, computes the graph walking distance to the incident zone using M3's Dijkstra `computeRoute` walk-time cost.
3. **Selection**: Assigns the candidate with the shortest ETA. If no skill-matched responder exists or all are currently unreachable (`Infinity`), the incident remains `'pending'` and displays an warning badge in the queue.
4. **Simplification Note**: Full optimization under multi-incident constraints (e.g. Hungarian algorithm, linear programming) is out of scope. One-at-a-time greedy nearest-available assignment is sufficient for real-time dispatch decision support.

---

## 3. SLA Threshold

- **SLA Threshold**: `300 seconds` (5 minutes).
- **Rationale**: Based on MetLife Stadium safety standards, response times exceeding 5 minutes pose severe operational risks (especially for medical and fire triage).
- **Breach Warning**: An inline warning label ("SLA Breach") highlights on the incident card if the predicted responder ETA exceeds this limit.

---

## 4. AI Post-Incident Reports

On manual resolution of a dispatched incident:
1. **Sanitization**: All user-derived notes in the incident brief are stripped of `<user_message>` and `</user_message>` prompt injection wrapper tags.
2. **F4 Chat Request**: Invokes the provider-agnostic `createClient().chat` API using a structured operation system template.
3. **Resilient Fallbacks**: If the LLM connection fails or throws an exception, the code recovers immediately, compiling a safe fallback template summary containing the location notes and responder ID without crashing the UI.
4. **Display**: The finalized summary is rendered inline on the resolved incident card for operational archiving.
