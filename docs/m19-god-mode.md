# M19 — God Mode Scenario Simulator

The **God Mode Scenario Simulator** is the interactive centerpiece of the operations console, allowing organizers to inject high-density bottlenecks, gate closures, or stadium-wide emergency evacuations live.

---

## 1. Preset Scenarios & Graph Grounding

Every scenario patch utilizes real, post-rebuild MetLife Stadium zone and gate IDs defined in the F2 venue graph:

### Scenario 1: Train Bottleneck (`train-bottleneck`)
- **Purpose**: Simulates a heavy post-match egress bottleneck at the rail transit connection.
- **Affected Nodes**:
  - `transit-train` (density: `0.95`)
  - `gate-b` (density: `0.90`, gateStatus: `'congested'`)
  - `sec-102` (density: `0.85`)
  - `sec-103` (density: `0.80`)
- **Rationale**: The `transit-train` terminal connects directly to `gate-b` (East Gate) in the graph structure. Spiking density at these nodes demonstrates the map's automatic transition to red heatmap colors.

### Scenario 2: Gate Closure (`gate-closure`)
- **Purpose**: Simulates the sudden closure of a main gate (Gate A - North Gate), causing crowd flow congestion as fans reroute.
- **Affected Nodes**:
  - `gate-a` (gateStatus: `'closed'`)
  - `sec-115` (density: `0.90`)
  - `sec-116` (density: `0.90`)
  - `sec-101` (density: `0.85`)
  - `sec-215` (density: `0.85`)
  - `sec-216` (density: `0.80`)
- **Rationale**: Re-routing fans bottleneck immediately in the sections adjacent to Gate A.

### Scenario 3: Emergency Evacuation (`emergency`)
- **Purpose**: Simulates a critical evacuation order, forcing broad density spikes and creating a sample incident pin.
- **Affected Nodes**:
  - `sec-101` to `sec-105` (density: `0.90` - `0.95`)
  - `sec-201` to `sec-203` (density: `0.85`)
  - `sec-301` to `sec-302` (density: `0.80`)
  - **Incident Pin**: Automatically spawns an incident of type `'evacuation'` in `sec-104` with a note alerting responders to fire lane blockages.
- **Rationale**: Provides an immediate visual demonstration of high density coupled with safety dispatches.

---

## 2. Reusing State Machinery

Rather than implementing redundant state management:
- **`applyScenario(patch)`**: Directly accesses `useSimStore` to merge the patch and trigger a `SCENARIO` broadcast across connected tabs.
- **`reset(zones)`**: Restores baseline density values, sets gates to `open`, clears all incident cards, and triggers a `RESET` sync broadcast.

---

## 3. Single-Active-Scenario Constraint

To prevent scenario overlaps (e.g. cumulative density calculations), the God Mode panel enforces a single-active-scenario invariant:
- Clicking any scenario button triggers a complete baseline `reset()` first.
- The next state patch is then applied cleanly.
- The UI tracks the current simulation state, highlighting the active scenario button and displaying an active scenario badge.
