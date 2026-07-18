# StadiumIQ Simulation Engine (F3)

The **Simulation Engine** is the deterministic "digital twin" heartbeat of StadiumIQ. It drives the stadium state purely on the client side in-memory without a backend, enabling real-time context-driven decisions for organizers and fans.

---

## State Shape (`SimState`)

The store exposes the current simulation state via `useSimStore`, which includes the following fields:

- **`matchClockSec`** (`number`): The elapsed time in simulation-seconds relative to kickoff. Kickoff is at `0` seconds. The timeline ranges from `-1800` (30 min before kickoff) to `8100` (30 min after final whistle).
- **`density`** (`Record<string, number>`): Map of `zoneId` to density value in the range `[0, 1]`. Represents how crowded each zone is.
- **`gateStatus`** (`Record<string, 'open' | 'congested' | 'closed'>`): Map of gate `zoneId` to its current operational status.
- **`incidents`** (`Incident[]`): Array of active or historical incidents in the stadium.
- **`routedLoad`** (`Record<string, number>`): Crowd routing loads per zone, used to simulate dynamic routing pressure.
- **`sensorCounts`** (`Record<string, number>`): Derived live fan sessions count per zone from heartbeat signals.
- **`timeline`** (`DensityFrame[]`): Pre-generated array of baseline density frames covering the entire match window, enabling zero-latency lookahead forecasting.

---

## Tick Loop Model

The simulation advances state automatically using `setInterval` when running:

- **Interval Rate**: Configured via `tickIntervalMs` (default: `2000` ms real-world time between ticks).
- **Time Step**: Configured via `simSecondsPerTick` (default: `45` sim-seconds advanced per tick).
- **Deterministic Phases**: The simulation time maps directly to five match phases:
  - **`pre`** (sec < 0): Pre-match arrival window.
  - **`firstHalf`** (0 <= sec < 2700): First 45 minutes of the match.
  - **`half`** (2700 <= sec < 3600): 15-minute halftime window.
  - **`secondHalf`** (3600 <= sec < 6300): Second 45 minutes of the match.
  - **`fullTime`** (sec >= 6300): Egress window up to 8100 seconds (post-match).

### Phase Density Curves (Base Curves)
Baseline densities interpolate linearly within each phase and apply a deterministic per-zone jitter in `[-0.05, 0.05]` generated using a seedable PRNG (`mulberry32`) and a zone ID string hash (`hashZoneId`). The jitter is a stable per-zone offset (a function of `zone.id` XOR `seed`), so it does not vary along the timeline for a given zone.

> **API note — `computeBaseDensity(zone, matchClockSec, seed?)`:** this function takes an optional third `seed` argument in addition to the spec's original two-parameter signature. The addition is backward-compatible (callers passing two arguments still work) and is required so that `generateTimeline(zones, seed)` produces seed-varying yet fully deterministic output; without it, every `SimConfig.seed` would yield an identical timeline. When `seed` is omitted the jitter derives from the zone-id hash alone.
- **Seating Sections**: Fill up during `pre` (0.0 -> 0.6) and first 20% of `firstHalf` (0.6 -> 0.9, held at 0.9), empty out during `half` (0.9 -> 0.3), refill in first 20% of `secondHalf` (0.3 -> 0.9, held at 0.9), and empty out during `fullTime` (0.9 -> 0.05).
- **Concourses, Gates, & Transits**: Experience traffic spikes during `pre` (0.0 -> 0.5), empty into seats during `firstHalf` (0.5 -> 0.15), spike during halftime `half` (0.15 -> 0.9), empty back into seats during `secondHalf` (0.9 -> 0.15), and experience a massive egress spike in `fullTime` (first 40% spike to 0.95, decaying to 0.1 over the remaining 60%).
- **Field**: Always returns `0` density.

---

## Cross-Tab Sync via `BroadcastChannel`

Tabs (e.g., Organizer dashboard and Fan companion app) sync states seamlessly in real-world environments using browser `BroadcastChannel` on the channel named `'stadiumiq'`:

1. **State Publisher**: The tab that starts the engine acts as the primary simulator tick publisher and broadcasts a `STATE_SYNC` message containing its latest state on every tick.
2. **Follower Tabs**: Other tabs receive the `STATE_SYNC` message and update their local state using a last-write-wins merge strategy.
3. **Heartbeat Broadcast**: Fan tabs post a `HEARTBEAT` message whenever they are in a zone, which informs other tabs of their presence.
4. **Scenarios, Resets, and Imports**: Actions like scenario application (`applyScenario`), system resets (`reset`), and judge dataset uploads (`importDataset`) immediately broadcast corresponding `SCENARIO`, `RESET`, or `IMPORT` messages to maintain sync.

On receipt, every channel message is filtered by `msg.type` against the five known literals (`STATE_SYNC`, `HEARTBEAT`, `SCENARIO`, `RESET`, `IMPORT`); anything else is ignored without throwing. Note that message *payloads* are trusted at the same-origin `BroadcastChannel` boundary and are not re-validated against a Zod schema on receipt — only `importDataset()` (the judge-facing upload path) performs full structural validation. `HEARTBEAT` messages are additionally dropped if their `zoneId` is not a known zone.

---

## Fan-as-Sensor Heartbeats

Fan tabs act as passive sensors. The store maintains a private map of heartbeats:
- **Registration**: When a fan tab calls `heartbeat(zoneId)`, it records `sessionHeartbeats[zoneId][sessionId] = Date.now()` locally and broadcasts it.
- **Pruning**: On every tick, the simulator calls `pruneAndCountSessions(sessionHeartbeats, Date.now())` to remove session IDs that have not been updated for longer than `SESSION_TTL_MS` (default: `10,000` ms).
- **Density Blend**: The remaining active sessions counts are translated into `sensorCounts`. The density calculation then blends this sensor influence:
  $$\text{influence} = \min\left(1, \frac{\text{sensorCount}}{\text{SENSOR\_SATURATION}}\right)$$
  $$\text{density} = \text{clamp01}\left(\text{baseDensity} \times (1 - \text{SENSOR\_WEIGHT}) + \text{influence} \times \text{SENSOR\_WEIGHT}\right)$$
  Where `SENSOR_SATURATION = 8` and `SENSOR_WEIGHT = 0.3`. This blending logic ensures that when multiple fans occupy a section, its density heats up dynamically.

---

## Scenario & Dataset Import Merge Semantics

- **Shallow Merge**: `density`, `gateStatus`, `sensorCounts`, and `routedLoad` are merged key-by-key (patched keys overwrite matching keys in state, leaving others untouched).
- **Array Overwrite**: `incidents` and `timeline` arrays are wholly replaced if present in the patch.
- **Scalar Overwrite**: `matchClockSec` is overwritten if present.
- **Gate Overrides**: Calculated gate statuses do not overwrite manual closed status overrides. If a gate status is set to `'closed'`, it is preserved during ticks until the next scenario patch reset.
- **Safety Validation**: `importDataset(dataset)` validates the payload strictly via a Zod schema, rejecting invalid shapes, incorrect types, or payload strings exceeding `200,000` characters.

---

## Timeline Consumption for Forecasting

Future modules (e.g., M7 Alert Forecasting) can retrieve future density curves directly from `state.timeline` instead of running multiple virtual simulations:
1. **Query**: Call `nearestFrame(timeline, targetClockSec)` to find the closest pre-generated `DensityFrame` for a future timestamp.
2. **Analysis**: Inspect `frame.density` and `frame.gateStatus` to warn organizers about upcoming bottlenecks, congestion points, or gate congestion.
