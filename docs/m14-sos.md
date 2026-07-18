# M14 — SOS / Emergency Override

The **SOS / Emergency Override** module provides a full-screen emergency takeover mode in the event of stadium incidents. It is designed to prioritize fan safety, disable non-critical features, and direct users to their computed safest exit gate.

---

## Purpose & Problem Alignment

Safety is the absolute priority for MetLife Stadium operations. In major crowd incidents or emergency situations, routine maps and chat assistants are bypassed in favor of simple, unmissable, and accessible evacuation routing. M14 acts as the digital twin override that coordinates crowd egress dynamically.

---

## Architectural & Design Specifications

### 1. In-Flow Takeover Layout
To align with §14 of the master specification, the `<SOSOverlay>` is loaded **in-flow** within the main application shell's content viewport, rather than as a `position: fixed` floating overlay. This avoids view stacking and focus-trapping bugs, allowing the browser and assistive technologies (like screen readers) to interact with the emergency interface naturally without interference from underlying views.

### 2. Premium Crimson Red Palette (Design Exception)
While StadiumIQ enforces a strict, FIFA-branded light mode design, the emergency overlay is the **lone deliberate exception** to this rule. It uses a high-contrast crimson and dark red palette:
- **Base Canvas / Background**: `#450a0a` (Tailwind `bg-red-950` / deep crimson text canvas)
- **Primary Alert Accent**: `#991b1b` (Tailwind `red-800` / high contrast crimson alert cards)
- **Evacuation path color**: `#ef4444` (Vibrant safety red / highlighted evacuation path drawn on the map)
- **Contrast warning highlight**: `#fbbf24` (Amber text for warnings or accessibility indicators)

### 3. Reuse of Existing Routing Engine (M3 / M8 / M11)
To ensure system efficiency, the safest exit route does not implement a separate pathfinding module. Instead, it queries the existing pure Dijkstra engine `computeRoute` in `lib/engine/routing.ts` (M3) under the following constraints:
- **Hard Exclusions**: Closed gates are completely pruned from the list of target gates before evaluation.
- **Congestion Weighting**: Gates marked as `congested` or suffering from high localized densities/routed loads receive standard cost penalties from the M3/M8 anti-herding algorithms, dynamically routing fans to clearer exits.
- **Accessibility Filtering**: If a user has checked accessible routing, `accessibleOnly: true` is passed through, forcing Dijkstra to prune all stair edges (M11) and only utilize elevators for vertical transitions.

---

## Evacuation State & Synchronization

### SOS State Structure (`lib/types.ts`)
```typescript
export interface SosState {
  active: boolean;
  triggeredBy: 'fan' | 'organizer' | null;
  triggeredAtSec: number;
}
```

### Local Dismiss vs. Global Stand-Down
- **Fan-Local SOS**: If a fan triggers SOS locally (e.g. from the header button), it is considered a personal emergency/false alarm. They are presented with a "Cancel SOS & Clear Mode" button that immediately exits the mode.
- **Organizer-Broadcast SOS**: If the emergency is broadcast from the Organizer view, the takeover applies to **all connected fan tabs** synchronously. Individual fans **cannot** dismiss this mode locally, and the takeover remains active until the Organizer stands down the broadcast globally.

### Cross-Tab Synchronization
SOS state is synchronized instantly across all open browser contexts using the shared `BroadcastChannel('stadiumiq')` connection. The following message actions are added to the synchronization protocol:
- `sos_trigger`: Broadcasts immediate activation to all tabs.
- `sos_clear`: Broadcasts immediate termination of the evacuation override.

### Security Limitations
In the serverless, offline-first client architecture of this digital twin showcase, there is no real-time backend authentication layer. Therefore, the restriction that only Organizers may trigger global broadcasts is enforced strictly in the UI. This is an accepted limitation of the offline prototype.
