# M6 — Proactive Smart-Exit Alerts

The Proactive Smart-Exit Alerts module watches the simulation state, match clock, and fan context to push automatic, anticipatory exit timing recommendations. This shifts StadiumIQ from a reactive search tool to a proactive companion.

## Key Features

1. **Forecast-Based Congestion Avoidance**: Automatically warns the fan if their planned exit gate is predicted to become congested (density $\ge 0.67$) within the next 15 minutes.
2. **Egress-Risk Window Identification**: Identifies high-risk egress periods (halftime and the final 10 minutes of regulation) and warns early leavers or triggers when an aggregate peak crush is imminent.
3. **Actionable Alternate Routing**: Alerts never just warn of crowding; they provide concrete, computed alternate routes (e.g., suggesting a different gate with a faster ETA).
4. **Session-Scoped Dismissal & Deduplication**: Ensures alerts do not spam the user by utilizing stable, deterministic IDs (`proactive-exitalert-${gateId}-${triggerType}`) to track dismissals and suppress active duplicates.
5. **Tick-Loop Efficiency**: Evaluates conditions on a debounced tick interval to minimize Dijkstra computation overhead.

---

## Technical Specifications

### `evaluateProactiveAlerts`

Located in `lib/engine/proactiveAlerts.ts`, this pure, synchronous, deterministic function decides whether any alerts should fire:

```typescript
export interface ProactiveAlertInput {
  matchClockSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  fanContext: FanContext;
  timeline: DensityFrame[];
  currentRoute?: { path: string[]; etaSec: number; targetGate: string };
  forecastHorizonSec?: number; // Default: 900 seconds (15 minutes)
  dismissedAlertIds: Set<string>;
  computeRouteFn?: (
    origin: string,
    dest: DestinationQuery,
    filters?: RouteFilters
  ) => RouteResult | RouteError;
}

export function evaluateProactiveAlerts(input: ProactiveAlertInput): Alert[];
```

---

## Trigger Conditions

### 1. Forecasted Target Gate Congestion (Priority 2)
- **Precondition**: A `currentRoute` with a valid `targetGate` must be available.
- **Evaluation**: The module calls `forecastAt(timeline, matchClockSec, 900)` to query predicted densities 15 minutes in the future.
- **Trigger**: If the predicted density at `targetGate` is $\ge 0.67$ (busy band):
  - The engine uses the `computeRouteFn` callback to evaluate alternative open gates.
  - If a faster alternate gate is found (based on computed route ETAs), a proactive alert is generated recommending the clearer gate.
  - The alert's ID is set to `proactive-exitalert-${targetGate}-congestion`.

### 2. Imminent Egress Risk (Priority 1)
- **Precondition**: The match clock is in a known egress-risk window:
  - **Halftime**: `[2700, 3600)` seconds.
  - **Late Regulation**: `[5700, 6300]` seconds.
- **Trigger**: If the clock is in a window, and either:
  - The fan's context has `leavingEarly: true`.
  - An aggregate peak crush is imminent (peak crush time computed via `findPeakCrush(timeline, matchClockSec, 900)` falls within the next 15 minutes, i.e., `peakAtSec <= matchClockSec + 900`).
- **Result**: Generates a high-priority alert (`priority: 1`) recommending starting the exit flow.
- **ID**: `proactive-exitalert-egress-risk-${matchClockSec}` (or based on window type).

---

## Efficiency & Debouncing

To maintain high rendering performance and avoid redundant Dijkstra path calculations:
- The evaluation hook (`useProactiveAlerts`) throttles execution.
- Calculations are skipped unless the match clock (`matchClockSec`) has advanced by at least **10 simulation seconds** since the last evaluation.
