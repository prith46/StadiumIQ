# M11 — Accessibility-First Routing

Accessibility-First Routing ensures a reliable, safe, and inclusive experience for wheelchair users and families with strollers. It guarantees that routes strictly avoid stairs, and prioritizes accessible amenities when they are comparably close to the fan's location.

---

## Core Mechanisms

### 1. Hard Edge Exclusion
Unlike soft sensory/emotional comfort preferences (which apply soft walk-time penalties), accessibility is a **hard filter**.
- When `accessibleOnly: true` is passed to the routing engine, any graph edge tagged with `accessible: false` (such as stairs) is entirely dropped from the graph representation before Dijkstra's algorithm runs.
- **Fail-Safe Contract**: If no accessible path exists to the destination after edge-pruning, the routing engine does not fall back to inaccessible paths. Instead, it returns a distinct `noRouteFound` response and a `null` path.

### 2. Facility Prioritization Proximity Rule
When listing or recommending facilities (e.g. restrooms) to a user with accessibility needs, the system prioritizes accessible variants (`restroom_accessible`) over standard restrooms if they are **comparably close**.

The proximity tolerance rule is defined as follows:
- **Same Tier Ring Rule**: If both candidate zones are seating sections (`sec-` prefix), they must occupy the same stadium tier (same first digit of section number) and have a circular section delta of $\le 2$.
  - Tier 1 Ring: 24 sections
  - Tier 2 Ring: 20 sections
  - Tier 3 Ring: 16 sections
- **Walking Time Fallback**: If either zone is not a seating section, the accessible POI is considered comparably close if its walking distance is within **60 seconds** of the closest standard POI.

---

## Technical Specifications

### `AccessibleRouteResult` Error Signature
To maintain backward compatibility with baseline test suites that check strictly for error strings while providing rich data for accessibility assertions:
```typescript
interface AccessibleRouteResult {
  path: null;
  etaSec: null;
  reason: { crowdedZones: []; avoidedGates: [] };
  accessible: false;
  noRouteFound: true;
}
```
These properties are defined as **non-enumerable properties** on the `{ error: 'no_accessible_route_found' }` failure object.

### `lib/engine/facilities.ts`
```typescript
export function prioritizeAccessibleFacilities(
  pois: Poi[],
  fromZoneId: string,
  needsAccessible: boolean
): Poi[];
```
