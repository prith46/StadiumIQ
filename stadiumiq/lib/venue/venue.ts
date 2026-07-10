import { Zone, Edge, Poi } from "../types";

export const GATES = ["gate-a", "gate-b", "gate-c", "gate-d"];
export const TRANSIT_NODES = ["transit-train", "transit-bus", "transit-taxi", "transit-parking"];

// SVG Angles layout convention:
// North = 270 degrees
// East = 0 degrees (360 degrees)
// South = 90 degrees
// West = 180 degrees
// Increasing angles proceed clockwise.

function getStand(angle: number): "n" | "e" | "s" | "w" {
  const norm = ((angle % 360) + 360) % 360;
  if (norm >= 225 && norm < 315) return "n";
  if (norm >= 315 || norm < 45) return "e";
  if (norm >= 45 && norm < 135) return "s";
  return "w";
}

const standAngles = { n: 270, e: 0, s: 90, w: 180 };

// 1. GENERATE ZONES
const tempZones: Zone[] = [];

// Seating sections: 60 total clockwise starting from North (270 degrees)
// Tier 1: 16 sections (101-116), step 22.5
for (let i = 0; i < 16; i++) {
  const sectionNum = 101 + i;
  const angle = (270 + i * 22.5) % 360;
  tempZones.push({
    id: `sec-${sectionNum}`,
    label: `${sectionNum}`,
    type: "section",
    tier: 1,
    stand: getStand(angle),
    angle,
    rInner: 120,
    rOuter: 195,
    capacity: 250,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "high",
    },
  });
}

// Tier 2: 20 sections (201-220), step 18
for (let i = 0; i < 20; i++) {
  const sectionNum = 201 + i;
  const angle = (270 + i * 18) % 360;
  tempZones.push({
    id: `sec-${sectionNum}`,
    label: `${sectionNum}`,
    type: "section",
    tier: 2,
    stand: getStand(angle),
    angle,
    rInner: 210,
    rOuter: 280,
    capacity: 200,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "med",
    },
  });
}

// Tier 3: 24 sections (301-324), step 15
for (let i = 0; i < 24; i++) {
  const sectionNum = 301 + i;
  const angle = (270 + i * 15) % 360;
  tempZones.push({
    id: `sec-${sectionNum}`,
    label: `${sectionNum}`,
    type: "section",
    tier: 3,
    stand: getStand(angle),
    angle,
    rInner: 295,
    rOuter: 370,
    capacity: 150,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "low",
    },
  });
}

// Concourse nodes (4 stands x 3 tiers = 12 total)
const stands: Array<"n" | "e" | "s" | "w"> = ["n", "e", "s", "w"];
const concourseRadii = { 1: 195, 2: 280, 3: 370 };

stands.forEach((stand) => {
  const angle = standAngles[stand];
  for (let t = 1; t <= 3; t++) {
    const tier = t as 1 | 2 | 3;
    const standLabel = stand.toUpperCase();
    tempZones.push({
      id: `concourse-${tier}-${stand}`,
      label: `Concourse ${tier} - ${standLabel}`,
      type: "concourse",
      tier,
      stand,
      angle,
      rInner: concourseRadii[tier] - 5,
      rOuter: concourseRadii[tier],
      attrs: {
        accessible: true,
        enclosed: true,
        noise: "med",
      },
    });
  }
});

// Gates (4 total, r=205 just outside tier 1 outer ring)
const gateDirections: Array<{ id: string; label: string; stand: "n" | "e" | "s" | "w" }> = [
  { id: "gate-a", label: "Gate A", stand: "n" },
  { id: "gate-b", label: "Gate B", stand: "e" },
  { id: "gate-c", label: "Gate C", stand: "s" },
  { id: "gate-d", label: "Gate D", stand: "w" },
];

gateDirections.forEach((g) => {
  const angle = standAngles[g.stand];
  tempZones.push({
    id: g.id,
    label: g.label,
    type: "gate",
    angle,
    rInner: 200,
    rOuter: 210,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "high",
    },
  });
});

// Transit nodes (4 total, r=260-320 depending on type)
const transitConfigs: Array<{ id: string; label: string; angle: number; r: number }> = [
  { id: "transit-train", label: "Train Station", angle: 315, r: 280 }, // near Gate A & B
  { id: "transit-bus", label: "Bus Terminal", angle: 45, r: 260 },    // near Gate B & C
  { id: "transit-taxi", label: "Taxi Stand", angle: 225, r: 270 },    // near Gate A & D
  { id: "transit-parking", label: "Main Parking", angle: 135, r: 310 }, // near Gate C & D
];

transitConfigs.forEach((t) => {
  tempZones.push({
    id: t.id,
    label: t.label,
    type: "transit",
    angle: t.angle,
    rInner: t.r - 10,
    rOuter: t.r + 10,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "low",
    },
  });
});

// Field (1 total, centered)
tempZones.push({
  id: "field-center",
  label: "Field",
  type: "field",
  rInner: 0,
  rOuter: 105,
  attrs: {
    accessible: false,
    enclosed: false,
    noise: "high",
  },
});

export const ZONES = tempZones;

// 2. GENERATE EDGES (Stored explicitly bidirectionally)
const tempEdges: Edge[] = [];

function addBidirectionalEdge(
  from: string,
  to: string,
  baseWalkSec: number,
  accessible: boolean,
  enclosed: boolean,
  noise: "low" | "med" | "high"
) {
  tempEdges.push({ from, to, baseWalkSec, accessible, enclosed, noise });
  tempEdges.push({ from: to, to: from, baseWalkSec, accessible, enclosed, noise });
}

// Seating Section <-> nearest Concourse on its tier (by stand)
ZONES.filter((z) => z.type === "section").forEach((sec) => {
  const concourseId = `concourse-${sec.tier}-${sec.stand}`;
  const standAngle = standAngles[sec.stand!];
  let angleDiff = Math.abs((sec.angle || 0) - standAngle);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;
  
  // Walk time scales with angular distance from the stand's concourse portal,
  // clamped to the spec's 30-90s section->concourse range (stays varied, never flat).
  const walkTime = Math.min(90, Math.max(30, Math.round(35 + angleDiff * 1.0)));
  addBidirectionalEdge(sec.id, concourseId, walkTime, true, false, sec.attrs.noise);
});

// Adjacent concourses on same tier (forming 3 tier rings).
// Ring segments lengthen with tier (larger circumference) -> vary within 20-40s by tier.
const ringWalkByTier = { 1: 25, 2: 32, 3: 38 } as const;
for (let tier = 1; tier <= 3; tier++) {
  const ringWalk = ringWalkByTier[tier as 1 | 2 | 3];
  addBidirectionalEdge(`concourse-${tier}-n`, `concourse-${tier}-e`, ringWalk, true, true, "med");
  addBidirectionalEdge(`concourse-${tier}-e`, `concourse-${tier}-s`, ringWalk, true, true, "med");
  addBidirectionalEdge(`concourse-${tier}-s`, `concourse-${tier}-w`, ringWalk, true, true, "med");
  addBidirectionalEdge(`concourse-${tier}-w`, `concourse-${tier}-n`, ringWalk, true, true, "med");
}

// Vertical connections between tiers (at each stand)
stands.forEach((stand) => {
  // Tier 3 <-> Tier 2 Stairs (inaccessible)
  addBidirectionalEdge(`concourse-3-${stand}`, `concourse-2-${stand}`, 85, false, true, "med");
  // Tier 3 <-> Tier 2 Elevator (accessible but slower)
  addBidirectionalEdge(`concourse-3-${stand}`, `concourse-2-${stand}`, 130, true, true, "med");

  // Tier 2 <-> Tier 1 Stairs (inaccessible)
  addBidirectionalEdge(`concourse-2-${stand}`, `concourse-1-${stand}`, 65, false, true, "med");
  // Tier 2 <-> Tier 1 Elevator (accessible but slower)
  addBidirectionalEdge(`concourse-2-${stand}`, `concourse-1-${stand}`, 105, true, true, "med");
});

// Concourse <-> Gate (each stand's concourse connects to its cardinal gate).
// Walk time grows with tier: tier 1 sits at gate level (~70s), tier 3 is furthest (~170s).
const gateByStand: Record<"n" | "e" | "s" | "w", string> = {
  n: "gate-a",
  e: "gate-b",
  s: "gate-c",
  w: "gate-d",
};
const gateWalkByTier = { 1: 70, 2: 120, 3: 170 } as const;
for (let tier = 1; tier <= 3; tier++) {
  const gateWalk = gateWalkByTier[tier as 1 | 2 | 3];
  stands.forEach((stand) => {
    addBidirectionalEdge(`concourse-${tier}-${stand}`, gateByStand[stand], gateWalk, true, false, "high");
  });
}

// Gate <-> Transit Nodes
addBidirectionalEdge("transit-train", "gate-a", 180, true, false, "low");
addBidirectionalEdge("transit-train", "gate-b", 150, true, false, "low");

addBidirectionalEdge("transit-bus", "gate-b", 120, true, false, "low");
addBidirectionalEdge("transit-bus", "gate-c", 160, true, false, "low");

addBidirectionalEdge("transit-taxi", "gate-a", 140, true, false, "low");
addBidirectionalEdge("transit-taxi", "gate-d", 180, true, false, "low");

addBidirectionalEdge("transit-parking", "gate-c", 220, true, false, "low");
addBidirectionalEdge("transit-parking", "gate-d", 200, true, false, "low");

export const EDGES = tempEdges;

// 3. GENERATE POIS
const tempPois: Poi[] = [];

// Generate standard assets (1 at every concourse for critical items)
ZONES.filter((z) => z.type === "concourse").forEach((c) => {
  const standLabel = c.stand!.toUpperCase();
  const tier = c.tier!;
  
  // Restroom
  tempPois.push({
    id: `poi-restroom-${tier}-${c.stand}`,
    type: "restroom",
    label: `Restroom M/W T${tier} ${standLabel}`,
    nearestZone: c.id,
    angle: c.angle!,
    r: c.rOuter! - 2,
    status: "open",
  });

  // Accessible Restroom
  tempPois.push({
    id: `poi-restroom-acc-${tier}-${c.stand}`,
    type: "restroom_accessible",
    label: `Accessible Restroom T${tier} ${standLabel}`,
    nearestZone: c.id,
    angle: c.angle! - 2, // slightly offset
    r: c.rOuter! - 2,
    status: "open",
  });

  // Water Station
  tempPois.push({
    id: `poi-water-${tier}-${c.stand}`,
    type: "water",
    label: `Water Station T${tier} ${standLabel}`,
    nearestZone: c.id,
    angle: c.angle! + 2,
    r: c.rOuter! - 1,
    status: "open",
  });

  // Food Concession
  tempPois.push({
    id: `poi-food-${tier}-${c.stand}`,
    type: "food",
    label: `Food Concession T${tier} ${standLabel}`,
    nearestZone: c.id,
    angle: c.angle! + 4,
    r: c.rOuter! - 2,
    status: "open",
  });

  // Recycling Bin
  tempPois.push({
    id: `poi-recycling-${tier}-${c.stand}`,
    type: "recycling",
    label: `Recycling T${tier} ${standLabel}`,
    nearestZone: c.id,
    angle: c.angle! - 4,
    r: c.rOuter! - 1,
    status: "open",
  });
});

// First Aid: 1 per tier + 1 at Gate C
tempPois.push({ id: "poi-firstaid-1", type: "first_aid", label: "First Aid Station T1 North", nearestZone: "concourse-1-n", angle: 270, r: 193, status: "open" });
tempPois.push({ id: "poi-firstaid-2", type: "first_aid", label: "First Aid Station T2 South", nearestZone: "concourse-2-s", angle: 90, r: 278, status: "open" });
tempPois.push({ id: "poi-firstaid-3", type: "first_aid", label: "First Aid Station T3 North", nearestZone: "concourse-3-n", angle: 270, r: 368, status: "open" });
tempPois.push({ id: "poi-firstaid-gate-c", type: "first_aid", label: "First Aid Center Gate C", nearestZone: "gate-c", angle: 90, r: 205, status: "open" });

// ATMs (6 total)
tempPois.push({ id: "poi-atm-1", type: "atm", label: "ATM T1 East", nearestZone: "concourse-1-e", angle: 0, r: 193, status: "open" });
tempPois.push({ id: "poi-atm-2", type: "atm", label: "ATM T2 West", nearestZone: "concourse-2-w", angle: 180, r: 278, status: "open" });
tempPois.push({ id: "poi-atm-3", type: "atm", label: "ATM T3 East", nearestZone: "concourse-3-e", angle: 0, r: 368, status: "open" });
tempPois.push({ id: "poi-atm-gate-a", type: "atm", label: "ATM Gate A", nearestZone: "gate-a", angle: 270, r: 205, status: "open" });
tempPois.push({ id: "poi-atm-gate-b", type: "atm", label: "ATM Gate B", nearestZone: "gate-b", angle: 0, r: 205, status: "open" });
tempPois.push({ id: "poi-atm-gate-d", type: "atm", label: "ATM Gate D", nearestZone: "gate-d", angle: 180, r: 205, status: "open" });

// Merchandise (6 total)
tempPois.push({ id: "poi-merch-1", type: "merch", label: "FIFA Store T1 West", nearestZone: "concourse-1-w", angle: 180, r: 193, status: "open" });
tempPois.push({ id: "poi-merch-2", type: "merch", label: "Merch Store T2 East", nearestZone: "concourse-2-e", angle: 0, r: 278, status: "open" });
tempPois.push({ id: "poi-merch-3", type: "merch", label: "Merch Booth T3 West", nearestZone: "concourse-3-w", angle: 180, r: 368, status: "open" });
tempPois.push({ id: "poi-merch-gate-a", type: "merch", label: "FIFA Mega Store Gate A", nearestZone: "gate-a", angle: 270, r: 205, status: "open" });
tempPois.push({ id: "poi-merch-gate-b", type: "merch", label: "Merch Kiosk Gate B", nearestZone: "gate-b", angle: 0, r: 205, status: "open" });
tempPois.push({ id: "poi-merch-gate-c", type: "merch", label: "Merch Stand Gate C", nearestZone: "gate-c", angle: 90, r: 205, status: "open" });

// Information Booths (6 total)
tempPois.push({ id: "poi-info-1", type: "info", label: "Info Desk T1 South", nearestZone: "concourse-1-s", angle: 90, r: 193, status: "open" });
tempPois.push({ id: "poi-info-2", type: "info", label: "Information T2 North", nearestZone: "concourse-2-n", angle: 270, r: 278, status: "open" });
tempPois.push({ id: "poi-info-3", type: "info", label: "Information T3 South", nearestZone: "concourse-3-s", angle: 90, r: 368, status: "open" });
tempPois.push({ id: "poi-info-gate-a", type: "info", label: "Guest Services Gate A", nearestZone: "gate-a", angle: 270, r: 205, status: "open" });
tempPois.push({ id: "poi-info-gate-c", type: "info", label: "Guest Services Gate C", nearestZone: "gate-c", angle: 90, r: 205, status: "open" });
tempPois.push({ id: "poi-info-gate-d", type: "info", label: "Guest Services Gate D", nearestZone: "gate-d", angle: 180, r: 205, status: "open" });

// Exits & Security (at every gate)
gateDirections.forEach((g) => {
  const angle = standAngles[g.stand];
  tempPois.push({
    id: `poi-exit-${g.id}`,
    type: "exit",
    label: `Exit checkpoint - ${g.label}`,
    nearestZone: g.id,
    angle: angle + 2,
    r: 206,
    status: "open",
  });
  tempPois.push({
    id: `poi-security-${g.id}`,
    type: "security",
    label: `Security Checkpoint - ${g.label}`,
    nearestZone: g.id,
    angle: angle - 2,
    r: 204,
    status: "open",
  });
  // Gates also get a recycling bin
  tempPois.push({
    id: `poi-recycling-${g.id}`,
    type: "recycling",
    label: `Recycling Station - ${g.label}`,
    nearestZone: g.id,
    angle: angle + 4,
    r: 205,
    status: "open",
  });
});

// Vertical transitions stairs / elevators mapping as POIs
stands.forEach((stand) => {
  const angle = standAngles[stand];
  
  // Stairs POIs (Tier 3-2 and Tier 2-1)
  tempPois.push({
    id: `poi-stairs-32-${stand}`,
    type: "stairs",
    label: `Stairwell ${stand.toUpperCase()} T3-T2`,
    nearestZone: `concourse-3-${stand}`,
    angle: angle + 5,
    r: 370,
    status: "open",
  });
  tempPois.push({
    id: `poi-stairs-21-${stand}`,
    type: "stairs",
    label: `Stairwell ${stand.toUpperCase()} T2-T1`,
    nearestZone: `concourse-2-${stand}`,
    angle: angle + 5,
    r: 280,
    status: "open",
  });

  // Elevator POIs (Tier 3-1 vertical access)
  tempPois.push({
    id: `poi-elevator-${stand}`,
    type: "elevator",
    label: `Elevator Shaft ${stand.toUpperCase()} (T1-T3)`,
    nearestZone: `concourse-2-${stand}`,
    angle: angle - 5,
    r: 280,
    status: "open",
  });
});

// QR Beacons (10 total: 1 at each of the 4 gates + 2 per tier (North and South) across 3 tiers)
gateDirections.forEach((g) => {
  tempPois.push({
    id: `poi-qr-${g.id}`,
    type: "qr_beacon",
    label: `QR Access Beacon - ${g.label}`,
    nearestZone: g.id,
    angle: standAngles[g.stand],
    r: 205,
    status: "open",
  });
});
for (let tier = 1; tier <= 3; tier++) {
  tempPois.push({
    id: `poi-qr-${tier}-n`,
    type: "qr_beacon",
    label: `QR Info Beacon T${tier} North`,
    nearestZone: `concourse-${tier}-n`,
    angle: 270,
    r: concourseRadii[tier as 1 | 2 | 3],
    status: "open",
  });
  tempPois.push({
    id: `poi-qr-${tier}-s`,
    type: "qr_beacon",
    label: `QR Info Beacon T${tier} South`,
    nearestZone: `concourse-${tier}-s`,
    angle: 90,
    r: concourseRadii[tier as 1 | 2 | 3],
    status: "open",
  });
}

export const POIS = tempPois;

// 4. MAPS AND LOOKUP APIS
const zoneMap = new Map<string, Zone>();
const edgesMap = new Map<string, Edge[]>();
const poisMap = new Map<string, Poi[]>();

// Build indexes once at module load
ZONES.forEach((z) => zoneMap.set(z.id, z));

EDGES.forEach((e) => {
  let list = edgesMap.get(e.from);
  if (!list) {
    list = [];
    edgesMap.set(e.from, list);
  }
  list.push(e);
});

POIS.forEach((p) => {
  let list = poisMap.get(p.nearestZone);
  if (!list) {
    list = [];
    poisMap.set(p.nearestZone, list);
  }
  list.push(p);
});

export function getZone(id: string): Zone | undefined {
  return zoneMap.get(id);
}

export function getEdgesFrom(zoneId: string): Edge[] {
  return edgesMap.get(zoneId) || [];
}

export function getPoisNear(zoneId: string): Poi[] {
  return poisMap.get(zoneId) || [];
}
