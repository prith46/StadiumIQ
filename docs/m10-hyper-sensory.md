# M10 — Hyper-Sensory / Emotional Routing

Hyper-Sensory / Emotional Routing lets fans tailor pathfinding to their personal or emotional comfort. Using existing structural and social attributes of the stadium graph, the routing engine steers fans away from busy, enclosed, or partisan zones when alternative paths of comparable length are available.

---

## Core Configuration & Preferences

These routing preferences are defined in the `FanContext.sensory` object:

1. **Quiet Path (`quiet: true`)**:
   - Reduces exposure to high-decibel segments (e.g., concession squares or near speakers).
   - Penalty: Adds $0.5 \times \text{baseWalkSec}$ to any edge where `noise === 'high'`.
2. **Open-Air Path (`openAir: true`)**:
   - Avoids claustrophobic concourse corridors, preferring outdoor transitions.
   - Penalty: Adds $0.5 \times \text{baseWalkSec}$ to any edge where `enclosed === true`.
3. **Avoid Affiliation (`avoidAffiliation: 'home' | 'away'`)**:
   - Helps away fans bypass home-dominant areas or vice-versa to prevent partisan tension.
   - Penalty: Adds $0.5 \times \text{baseWalkSec}$ to any edge leading into a zone where the `affiliation` matches the avoided value.

---

## Stacking and Soft Preference Logic

- **Additive Stacking**: Penalties are fully additive. If a segment is both enclosed and high-noise, and a fan requests both `quiet` and `open-air` paths, the edge weight receives both $50\%$ penalties (effectively adding $100\%$ of its base walk time).
- **Soft Preferences**: Unlike hard accessibility constraints (which strictly prune edges from the graph), sensory options are implemented as soft cost weightings. If no alternative path is physically possible, the router will still return the shortest path even if it violates sensory preferences.

---

## Boundaries & Out of Scope

- **UI Wiring**: Natural language inference of sensory preferences via the M2 AI Copilot is out of scope. The sensory parameters are evaluated purely within the pathfinding engine.
- **Accessibility Filtering**: Accessibility (`accessibleOnly`) remains a hard, binary graph-pruning operation, whereas sensory comfort relies on soft weights.
