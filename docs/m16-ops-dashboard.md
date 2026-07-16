# M16 — Organizer Live Ops Dashboard

The **Organizer Live Ops Dashboard** (M16) is the command center for stadium operations staff at MetLife Stadium. It maps both live crowd-density levels and active safety incidents onto the digital twin visualization, while presenting triaged alerts and dispatch queues in a unified console layout.

---

## Layout Grid & Structure

The dashboard is built on a responsive desktop-first CSS Grid splitting the view into two columns:

1. **Left Panel (~65% width)**:
   - **Interactive Seating Map**: Displays `<StadiumMap mode="organizer">` in light mode. Seating sections are colored reactively using the live Zustand store state for quadrant-level and section-level density. Sections exceeding a density of `0.75` highlight as hotspots. Unresolved incidents drop red visual markers (`'incident'` pins) at their respective zone coordinates.
   - **Dispatch Queue Panel**: A placeholder panel styled as a bordered card, clearly labeled *"Coming in M17"* (to handle queue ordering, dispatcher assignments, and responder ETAs).
   - **Simulation Controls Panel**: A placeholder panel styled as a card, clearly labeled *"Coming in M19"* (to provide simulation sandbox event injection and crowd override triggers).

2. **Right Rail (~35% width)**:
   - **Operations Alerts Feed**: Inline integration of the M6 `<AlertStack>` component. It lists all active alerts from `useAlertStore`, supporting dismissal. If no alerts are present, it shows a clean *"No active alerts"* operational state.
   - **Operational AI Copilot**: A placeholder panel styled as a card, clearly labeled *"Coming in M18"* (to support LLM-grounded chatbot ops queries).

3. **Top Utility Header**:
   - Displays operational KPIs (Match Clock, Total Sections, Active Incidents count).
   - Integrates the global **Emergency Broadcast Overrides (SOS)** confirmation toggle from M14, allowing organizers to trigger evacuation routes on all fan tabs.

---

## Map Interactions & Incident Pin Details

- **Incident Pin Rendering**: When the list of incidents in `useSimStore` is modified, the dashboard runs a layout synchronizer using the map ref's imperative `.dropPin()` API.
- **Triage details card**: Seating section paths and concourse circles report zone clicks via `onZoneClick`. Clicking a zone containing an active incident:
  - Activates a persistent, dismissible details card below the map, showing the incident note, type (medical/assistance), reported match clock time, and status.
  - Highlights the zone with a scale-spring pulse using the map ref's `.highlightZone(zoneId, { pulse: true })` API.
  - Clicking a zone without active incidents clears all highlights and resets map overlays.

---

## Component & Store Reuse

- **Zustand store**: Pulls reactively from `useSimStore` (clock, incidents, gate status, sos) and `useAlertStore` (active alerts list, dismiss action).
- **StadiumMap**: Reused with `mode="organizer"`. Heatmap density rendering is managed internally in the map subcomponents.
- **AlertStack & AlertCard**: Shared inline inside the right rail via the new `inline={true}` prop, keeping the interface identical to the fan view but constrained to relative layout heights.
