# M7 — Predictive Crowd Forecasting

The Predictive Crowd Forecasting module (`lib/engine/forecast.ts`) analyzes the pre-generated match-day simulation timeline to predict future zone densities and identify peak crowd congestion times. This makes the application proactive rather than reactive, providing data for modules like Proactive Alerts (M6) and the Organizer Copilot's "15-minute forecast" (M18).

## Key Features

1. **Zone Density Forecasting**: Predicts the crowd density for each venue zone at a specific future time.
2. **Peak Crush Analysis**: Identifies the time of maximum aggregate crowd density within a given future horizon.
3. **Linear Interpolation**: Resolves queries between native timeline frame steps.
4. **Boundary Extrapolation**: Smoothly handles requests beyond the timeline bounds by clamping.

---

## Type Definitions

The module works with the following data contracts:

```typescript
export interface DensityFrame {
  atSec: number;                        // Match clock (seconds) this frame represents
  density: Record<string, number>;      // Mapping of zoneId -> density (0.0 to 1.0)
  gateStatus?: Record<string, 'open' | 'congested' | 'closed'>;
}

export interface ForecastResult {
  requestedAtSec: number;               // Match clock of the query anchor
  targetSec: number;                    // Match clock being forecast (requestedAtSec + aheadSec)
  density: Record<string, number>;      // Predicted density per zone (interpolated/extrapolated)
  extrapolated: boolean;                // True if targetSec was beyond the timeline horizon
}

export interface PeakCrushResult {
  peakAtSec: number;                    // Match clock of the predicted peak
  peakScore: number;                    // Aggregate density sum at the peak
  topZones: Array<{ zoneId: string; density: number }>;  // Top 5 zones by density at peak (descending)
}
```

---

## Functions

### `forecastAt`

Given the timeline, the current simulation clock, and a target lookahead (in seconds), calculates the predicted density map.

```typescript
export function forecastAt(
  timeline: DensityFrame[],
  currentSec: number,
  aheadSec: number
): ForecastResult;
```

#### Interpolation Rules
- When the target time `targetSec = currentSec + aheadSec` falls strictly between two frames, e.g., `frame[i].atSec <= targetSec < frame[i+1].atSec`, the density is computed using linear interpolation (`lerp`):
  $$t = \frac{\text{targetSec} - \text{frame}[i].\text{atSec}}{\text{frame}[i+1].\text{atSec} - \text{frame}[i].\text{atSec}}$$
  $$\text{density}_{\text{interpolated}} = (1 - t) \times \text{frame}[i].\text{density}[\text{zone}] + t \times \text{frame}[i+1].\text{density}[\text{zone}]$$
- The output density values are clamped to the range `[0.0, 1.0]`.

#### Extrapolation Rules
- If the `targetSec` exceeds the last frame in the timeline (`targetSec > timeline[last].atSec`), the last frame's densities are returned unmodified, and the result is flagged with `extrapolated: true`.
- If the `targetSec` is before the first frame in the timeline (`targetSec < timeline[0].atSec`), the first frame's densities are returned unmodified, and the result is flagged with `extrapolated: true`.
- If the timeline contains $0$ or $1$ frame, the single frame's density (or empty object if empty timeline) is returned unmodified, with `extrapolated: true`.

---

### `findPeakCrush`

Finds the timestamp within the search window `[currentSec, currentSec + horizonSec]` that yields the highest total aggregate crowd density.

```typescript
export function findPeakCrush(
  timeline: DensityFrame[],
  currentSec: number,
  horizonSec?: number // Default: 2400 (40 minutes)
): PeakCrushResult;
```

#### Peak Score Definition
- The aggregate score at any given frame is the **sum** of all densities for all zones in that frame:
  $$\text{Score} = \sum_{\text{zone} \in \text{frame}} \text{density}_{\text{zone}}$$
- Only native frames that fall within the boundary `[currentSec, currentSec + horizonSec]` (inclusive of endpoints) are considered. No inter-frame interpolation is performed for finding the peak time.
- If multiple frames tie for the maximum score, the earliest frame (smallest `atSec`) is returned.

#### Top Zones Selection
- Returns the top 5 zones with the highest densities at the peak timestamp.
- **Sorting Criterion**: Zones are sorted by density in **descending** order.
- **Tie-Breaking Rule**: If two zones have the exact same density, ties are resolved in alphabetical/lexicographical **ascending** order of their `zoneId` (e.g., `zone-a` before `zone-b`).
