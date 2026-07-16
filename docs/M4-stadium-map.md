# M4: Interactive Stadium Map + Live Heatmap Documentation

The `<StadiumMap>` component provides a parametrically-generated SVG digital twin of the MetLife stadium bowl (3 tiers, 60 seating sections) with a live crowd density heatmap, clickable markers/zones, transit nodes, POI indicators, and an interactive overlay layer for dynamic routing and event dispatching.

---

## Component API

### `StadiumMapProps` (Props)

| Prop | Type | Description |
|---|---|---|
| `mode` | `'fan' \| 'organizer'` | Cosmetic mode toggle. Organizer mode displays numeric density tags (`62% (0.62)`) on tooltip hover. Fan mode suppresses raw numbers and only shows status text (Clear/Busy/Crowded). |
| `currentZoneId` | `string` (optional) | ID of the zone representing the user's location. Renders a FIFA-blue pulsing dot when provided. |
| `onZoneClick` | `(zoneId: string) => void` (optional) | Event fired when a seating section, gate, or transit node is clicked or key-activated. |
| `onPoiClick` | `(poiId: string) => void` (optional) | Event fired when a POI marker (restroom, first aid, exit, etc.) is clicked or key-activated. |
| `className` | `string` (optional) | Custom classes applied to the root container. |

### `StadiumMapHandle` (Imperative Ref Methods)

Exposed via `forwardRef` and `useImperativeHandle`. These methods perform internal state mutations to draw routes or drop pins without triggering parent state re-renders.

| Method | Signature | Description |
|---|---|---|
| `highlightZone` | `(zoneId: string, opts?: { pulse?: boolean }) => void` | Draws a high-visibility blue outline around the specified zone. If `pulse: true`, the outline pulses dynamically. Warnings are logged and call is ignored if `zoneId` is invalid. |
| `drawRoute` | `(path: string[]) => void` | Connects the center coordinates of the array of zone IDs in order, rendering a glowing polyline and a dashed route line. Warnings are logged and call is ignored if any zone ID is invalid. |
| `dropPin` | `(zoneId: string, kind: 'incident' \| 'dispatch' \| 'poi') => void` | Drops a colored map pin (Red for incidents, Green for dispatch responders, Amber for POIs) at the zone's center coordinate. Warnings are logged and call is ignored if `zoneId` is invalid. |
| `clearOverlay` | `() => void` | Removes all overlays (highlights, routes, and dropped pins) from the map. |

---

## Heatmap Color Formula (Density $\rightarrow$ Color)

Seating sections dynamically interpolate their fill color based on the live crowd density value $d \in [0.0, 1.0]$. The interpolation is performed in **HSL color space** using a piecewise linear progression between three stops:

*   **Clear** ($d = 0.0$): `#C0DD97` (HSL: $84.88^\circ$, $50.73\%$, $72.94\%$)
*   **Busy** ($d = 0.5$): `#FAC775` (HSL: $36.99^\circ$, $93.01\%$, $71.96\%$)
*   **Crowded** ($d = 1.0$): `#F09595` (HSL: $0.0^\circ$, $75.22\%$, $76.28\%$)

### Mathematical Formula

Let $d$ be clamped to $[0.0, 1.0]$.
For $d < 0.5$, let $t = \frac{d}{0.5}$:
$$H = 84.878 + (36.994 - 84.878) \cdot t$$
$$S = 50.725 + (93.011 - 50.725) \cdot t$$
$$L = 72.941 + (71.961 - 72.941) \cdot t$$

For $d \ge 0.5$, let $t = \frac{d - 0.5}{0.5}$:
$$H = 36.994 + (0.0 - 36.994) \cdot t$$
$$S = 93.011 + (75.216 - 93.011) \cdot t$$
$$L = 71.961 + (76.275 - 71.961) \cdot t$$

The calculated HSL coordinates are converted back to uppercase Hex strings for rendering. Exact inputs of $0.0$, $0.5$, and $1.0$ bypass calculation and return the literal stop Hex strings.

---

## Data Model & Schema

All stadium structures and routing nodes are driven by static definitions in [venue.ts](file:///e:/StadiumIQ/stadiumiq/lib/venue/venue.ts). The schema uses:
*   `ZONES` containing exactly 60 seating sections partitioned by tier (16 lower, 20 mid, 24 upper) plus concourses, gates, and transit nodes. Refer to [types.ts](file:///e:/StadiumIQ/stadiumiq/lib/types.ts) for interface definitions of `Zone`, `Poi`, and `Edge`.

---

## Accessibility (a11y) Strategy

To ensure standard-compliant web accessibility, we chose the **visually-hidden button list fallback** strategy. 

### Why SVG tabIndex is Unreliable
While modern browsers support `tabIndex` and semantic attributes (`role="button"`) directly on SVG elements (e.g. `<g>` and `<path>`), support across various screen readers (such as JAWS, NVDA, and VoiceOver) is inconsistent. SVGs are often treated as static graphic nodes and ignored by accessibility trees or bypass key events like Enter/Space when focused.

### Chosen Implementation
We rendered a visually hidden div containing standard HTML `<button>` elements representing all seating sections, gates, transit locations, and POIs, styled with clipping boundaries:
```css
position: absolute;
width: 1px;
height: 1px;
padding: 0;
margin: -1px;
overflow: hidden;
clip: rect(0, 0, 0, 0);
white-space: nowrap;
border-width: 0;
```
This renders the list completely invisible to sighted users, but guarantees that:
1. Screen readers discover every interactive component in the document.
2. Clicking or pressing Space/Enter triggers the corresponding callback.
3. The live status (e.g., density and crowdedness text) is read out natively via `aria-label`.

---

## How Module M5 Uses This Component

Module M5 (Dynamic Highlighting / Navigation) interacts with `<StadiumMap>` strictly via its `ref` contract.
*   **Drawing paths**: When the user requests a route, M5 computes the shortest path as an array of zone IDs (e.g., `["sec-102", "concourse-1-e", "gate-b"]`) and calls `ref.current.drawRoute(path)`. The map draws the route overlays immediately.
*   **Active selection**: When a chat message highlights a zone, M5 calls `ref.current.highlightZone(zoneId, { pulse: true })`.
*   **Dispatch & Safety**: Incident notifications drop red incident pins via `ref.current.dropPin(zoneId, 'incident')` and cyan responder pins via `ref.current.dropPin(responderZoneId, 'dispatch')`.
*   **Security**: M5 can call these methods safely. If a hallucinated zone ID is passed, the map will ignore it and print a console warning instead of throwing an error or crashing the UI.
