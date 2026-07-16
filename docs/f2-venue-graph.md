# F2 — Venue Graph & Data Model

## Purpose
The Venue Graph and Data Model module establishes the physical layout and connectivity graph of the stadium (MetLife Stadium, NJ). It models seating sections, concourses, gates, and transit terminals, along with points of interest (POIs) such as restrooms, concessions, and security checkpoints. This data acts as the ground truth consumed by downstream modules for pathfinding, crowd simulation, heatmap rendering, and contextual AI assistants.

---

## Angle & Layout Conventions
Angles in the dataset follow the **standard SVG coordinate system**:
- **Due North**: $270^\circ$
- **Due East**: $0^\circ$ (or $360^\circ$)
- **Due South**: $90^\circ$
- **Due West**: $180^\circ$

Angles proceed **clockwise** as the degree values increment. This convention was chosen to align with the visual mapping coordinate systems of modern browsers (where the y-axis points downwards, making a positive rotation clockwise).

---

## Tier Radii Reference

All physical components are mapped to specific radii (measured in pixels/units from the stadium center):

| Tier | Component Type | Inner Radius ($r_{inner}$) | Outer Radius ($r_{outer}$) | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Lower Seating | 120 | 195 | Sections 101 - 116 (angular width $22.5^\circ$) |
| **Tier 1** | Concourse Ring | 190 | 195 | Outer walk ring for lower tier |
| **Tier 2** | Mid Seating | 210 | 280 | Sections 201 - 220 (angular width $18^\circ$) |
| **Tier 2** | Concourse Ring | 275 | 280 | Outer walk ring for mid tier |
| **Tier 3** | Upper Seating | 295 | 370 | Sections 301 - 324 (angular width $15^\circ$) |
| **Tier 3** | Concourse Ring | 365 | 370 | Outer walk ring for upper tier |
| **Ground** | Gates | 200 | 210 | Gate A, B, C, D placed outside Tier 1 at cardinal angles |
| **Ground** | Transit | - | 260 - 310 | Outer connections to train, bus, taxi, parking |
| **Pitch** | Field | 0 | 105 | Central playing field (not walkable) |

---

## How to Extend the Graph

To add new nodes, edges, or assets, modify `lib/venue/venue.ts` following these patterns:

1. **Adding a New Zone**:
   Append a new `Zone` object to the generated array. Ensure you set a unique `id` and appropriate coordinate parameters (`angle`, `rInner`, `rOuter`).
2. **Adding a Walkable Connection (Edge)**:
   Call the helper `addBidirectionalEdge(from, to, walkTime, accessible, enclosed, noise)`. This helper automatically registers the connection in both directions in the `EDGES` array. Do not manually duplicate the edge.
3. **Adding a Point of Interest (POI)**:
   Append a new `Poi` object to the `tempPois` list, ensuring the `nearestZone` matches a valid zone ID in the graph.

---

## Design Assumptions

- **Edge Directionality**: Every bidirectional walk path is explicitly represented as **two separate Edge objects** (from A to B, and from B to A) inside the `EDGES` array. This keeps the lookups inside `getEdgesFrom(id)` extremely fast ($O(1)$) using a simple `Map` indexing strategy.
- **Transit Terminal Placement**: Transit nodes are placed in the outer quadrants:
  - `transit-train` sits in the northeast quadrant ($315^\circ$, $r=280$), connecting to Gates A and B.
  - `transit-bus` sits in the southeast quadrant ($45^\circ$, $r=260$), connecting to Gates B and C.
  - `transit-taxi` sits in the northwest quadrant ($225^\circ$, $r=270$), connecting to Gates A and D.
  - `transit-parking` sits in the southwest quadrant ($135^\circ$, $r=310$), connecting to Gates C and D.
- **Concourse-to-Gate Walk Times**: Walking from the ground-level Tier 1 concourses to their adjacent security gates is estimated to take $75$ seconds under normal conditions.
- **Vertical Connection Walk Times**: Going between tiers via stairs takes $65\text{s} - 85\text{s}$ (marked inaccessible for wheelchair users). Using elevators takes $105\text{s} - 130\text{s}$ (fully accessible but slower due to transit delays).
