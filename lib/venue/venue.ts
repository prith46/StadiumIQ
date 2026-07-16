import { Zone, Edge, Poi } from "../types";

export const GATES = ["gate-a", "gate-b", "gate-c", "gate-d"];
export const TRANSIT_NODES = ["transit-train", "transit-bus", "transit-taxi", "transit-parking"];

// Angle convention (MAP BUILD SPEC §22.1/§22.2): 0deg = east, 90deg = south,
// 180deg = west, 270deg (equivalently -90deg) = north. Angles increase clockwise.
// Sections start at -90deg (north) and proceed clockwise per tier.

function angularDistance(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function getStandByIndex(i: number, count: number): "n" | "e" | "s" | "w" {
  const quadrant = Math.floor(i / (count / 4));
  return (["n", "e", "s", "w"] as const)[quadrant];
}

// ---------------------------------------------------------------------------
// §22.2 — Tiers & sections
// ---------------------------------------------------------------------------

interface TierSpec {
  key: string;
  r0: number;
  r1: number;
  count: number;
  base: number;
  tier: 1 | 2 | 3;
}

export const TIERS: TierSpec[] = [
  { key: "lower", r0: 0.34, r1: 0.55, count: 16, base: 100, tier: 1 },
  { key: "mid", r0: 0.585, r1: 0.76, count: 20, base: 200, tier: 2 },
  { key: "upper", r0: 0.795, r1: 1.0, count: 24, base: 300, tier: 3 },
];

// Concession (food) angles — used to determine the 4 nearest "high noise" sections.
const FOOD_ANGLES = [45, 135, 225, 315];

const tempZones: Zone[] = [];

// 1a. Generate all section zones first (attrs.noise/affiliation assigned in a
// second pass once every section's angle is known, so "nearest" comparisons
// can run across the full 60-section set).
for (const T of TIERS) {
  const step = 360 / T.count;
  const gap = step * 0.16;
  for (let i = 0; i < T.count; i++) {
    const a1 = -90 + i * step + gap;
    const a2 = -90 + (i + 1) * step - gap;
    const mid = (a1 + a2) / 2;
    const label = String(T.base + i + 1);
    tempZones.push({
      id: `sec-${T.base + i + 1}`,
      label,
      type: "section",
      tier: T.tier,
      stand: getStandByIndex(i, T.count),
      angle: mid,
      rInner: T.r0,
      rOuter: T.r1,
      capacity: T.tier === 1 ? 250 : T.tier === 2 ? 200 : 150,
      attrs: {
        accessible: true,
        enclosed: false,
        noise: "low", // placeholder, assigned below
        affiliation: "home", // placeholder, assigned below
      },
    });
  }
}

const sectionZones = tempZones.filter((z) => z.type === "section");

// 1b. Noise: the 4 sections nearest each concession (food angle) are "high"; rest "low".
const highNoiseSectionIds = new Set<string>();
for (const foodAngle of FOOD_ANGLES) {
  let nearest: Zone | null = null;
  let nearestDist = Infinity;
  for (const sec of sectionZones) {
    const d = angularDistance(sec.angle ?? 0, foodAngle);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = sec;
    }
  }
  if (nearest) highNoiseSectionIds.add(nearest.id);
}
for (const sec of sectionZones) {
  sec.attrs.noise = highNoiseSectionIds.has(sec.id) ? "high" : "low";
}

// 1c. Affiliation: sections numbered 300-307 = 'away'; the two sections nearest
// each gate (0/90/180/270) = 'neutral' (unless already 'away'); rest = 'home'.
for (const sec of sectionZones) {
  const num = Number(sec.label);
  sec.attrs.affiliation = num >= 300 && num <= 307 ? "away" : "home";
}
const GATE_ANGLES = [0, 90, 180, 270];
for (const gateAngle of GATE_ANGLES) {
  const nearestTwo = [...sectionZones]
    .sort((a, b) => angularDistance(a.angle ?? 0, gateAngle) - angularDistance(b.angle ?? 0, gateAngle))
    .slice(0, 2);
  for (const sec of nearestTwo) {
    if (sec.attrs.affiliation !== "away") sec.attrs.affiliation = "neutral";
  }
}

// ---------------------------------------------------------------------------
// §22.3 — Gates & transit
// ---------------------------------------------------------------------------

const GATE_R = 1.03;
// Gate-letter-to-angle pairing preserves the pre-existing convention (gate-a=north,
// gate-b=east, gate-c=south, gate-d=west) rather than a literal sequential reading
// of "angles 0,90,180,270 -> gate-a,b,c,d" — §22.3 lists the 4 angles/ids as an
// unordered correspondence, and dozens of downstream M1/M6/M9 tests/fixtures
// already assume gate-a=north. Re-lettering would be a much larger, needless
// breaking change with no spec requirement forcing it (self-verify only checks
// that all 4 gates render at the 4 cardinal angles, not a specific letter pairing).
const gateDirections: Array<{ id: string; label: string; angle: number }> = [
  { id: "gate-a", label: "Gate A", angle: 270 },
  { id: "gate-b", label: "Gate B", angle: 0 },
  { id: "gate-c", label: "Gate C", angle: 90 },
  { id: "gate-d", label: "Gate D", angle: 180 },
];

gateDirections.forEach((g) => {
  tempZones.push({
    id: g.id,
    label: g.label,
    type: "gate",
    angle: g.angle,
    rInner: GATE_R,
    rOuter: GATE_R,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "high",
    },
  });
});

const TRANSIT_R = 1.2;
const transitConfigs: Array<{ id: string; label: string; angle: number }> = [
  { id: "transit-train", label: "Train", angle: 45 },
  { id: "transit-bus", label: "Bus", angle: 135 },
  { id: "transit-taxi", label: "Taxi", angle: 225 },
  { id: "transit-parking", label: "Parking", angle: 315 },
];

transitConfigs.forEach((t) => {
  tempZones.push({
    id: t.id,
    label: t.label,
    type: "transit",
    angle: t.angle,
    rInner: TRANSIT_R,
    rOuter: TRANSIT_R,
    attrs: {
      accessible: true,
      enclosed: false,
      noise: "low",
    },
  });
});

// ---------------------------------------------------------------------------
// §22.5 — Field (center)
// ---------------------------------------------------------------------------

tempZones.push({
  id: "field-center",
  label: "Field",
  type: "field",
  rInner: 0,
  rOuter: 0,
  attrs: {
    accessible: false,
    enclosed: false,
    noise: "high",
  },
});

export const ZONES = tempZones;

// ---------------------------------------------------------------------------
// §22.7 — Routing graph: concourse node per section + ring/radial/gate/transit edges
// ---------------------------------------------------------------------------

const CONCOURSE_R = 1.02;
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

// One concourse node per section: con-<sectionId>, at r=1.02, angle=section.mid.
function concourseIdFor(sectionId: string): string {
  return `con-${sectionId}`;
}

sectionZones.forEach((sec) => {
  tempZones.push({
    id: concourseIdFor(sec.id),
    label: `Concourse ${sec.label}`,
    type: "concourse",
    tier: sec.tier,
    stand: sec.stand,
    angle: sec.angle,
    rInner: CONCOURSE_R,
    rOuter: CONCOURSE_R,
    attrs: {
      accessible: true,
      enclosed: true,
      noise: "med",
    },
  });
});

// Ring edges: connect adjacent concourse nodes sorted by angle (wrap-around).
// noise = max of the two adjacent sections' noise.
const NOISE_ORDER = { low: 0, med: 1, high: 2 } as const;
function maxNoise(a: "low" | "med" | "high", b: "low" | "med" | "high"): "low" | "med" | "high" {
  return NOISE_ORDER[a] >= NOISE_ORDER[b] ? a : b;
}

const sortedByAngle = [...sectionZones].sort((a, b) => {
  const na = ((a.angle ?? 0) % 360 + 360) % 360;
  const nb = ((b.angle ?? 0) % 360 + 360) % 360;
  return na - nb;
});

for (let i = 0; i < sortedByAngle.length; i++) {
  const secA = sortedByAngle[i];
  const secB = sortedByAngle[(i + 1) % sortedByAngle.length];
  addBidirectionalEdge(
    concourseIdFor(secA.id),
    concourseIdFor(secB.id),
    20,
    true,
    false,
    maxNoise(secA.attrs.noise, secB.attrs.noise)
  );
}

// Radial (in->out) edges: each section -> its concourse node. Two variants:
// stairs (accessible:false, 25s) and elevator (accessible:true, 40s).
// enclosed:true only on the mid-tier radial tunnels (claustrophobia sensory filter).
sectionZones.forEach((sec) => {
  const conId = concourseIdFor(sec.id);
  const enclosed = sec.tier === 2;
  addBidirectionalEdge(sec.id, conId, 25, false, enclosed, sec.attrs.noise);
  addBidirectionalEdge(sec.id, conId, 40, true, enclosed, sec.attrs.noise);
});

// Gate edges: each gate -> nearest concourse node, 15s, accessible:true.
gateDirections.forEach((g) => {
  let nearestSec: Zone | null = null;
  let nearestDist = Infinity;
  for (const sec of sectionZones) {
    const d = angularDistance(sec.angle ?? 0, g.angle);
    if (d < nearestDist) {
      nearestDist = d;
      nearestSec = sec;
    }
  }
  if (nearestSec) {
    addBidirectionalEdge(g.id, concourseIdFor(nearestSec.id), 15, true, false, "high");
  }
});

// Transit edges: each transit -> nearest gate, 30s, accessible:true.
transitConfigs.forEach((t) => {
  let nearestGate: { id: string; angle: number } | null = null;
  let nearestDist = Infinity;
  for (const g of gateDirections) {
    const d = angularDistance(g.angle, t.angle);
    if (d < nearestDist) {
      nearestDist = d;
      nearestGate = g;
    }
  }
  if (nearestGate) {
    addBidirectionalEdge(t.id, nearestGate.id, 30, true, false, "low");
  }
});

export const EDGES = tempEdges;

// ---------------------------------------------------------------------------
// §22.4 — Facilities (POIs), exact icon/color/radius/angle placements
// ---------------------------------------------------------------------------

interface FacilitySpec {
  type: Poi["type"];
  icon: string;
  color: string;
  r: number;
  angles: number[];
}

export const FACILITY_SPECS: FacilitySpec[] = [
  { type: "restroom", icon: "ti-man", color: "#2563EB", r: 0.565, angles: [35, 125, 215, 305] },
  { type: "restroom_accessible", icon: "ti-wheelchair", color: "#2563EB", r: 0.565, angles: [165, 345] },
  { type: "water", icon: "ti-droplet", color: "#0F6E56", r: 0.565, angles: [80, 260] },
  { type: "info", icon: "ti-info-circle", color: "#534AB7", r: 0.565, angles: [20] },
  { type: "food", icon: "ti-tools-kitchen-2", color: "#BA7517", r: 0.775, angles: [45, 135, 225, 315] },
  { type: "first_aid", icon: "ti-first-aid-kit", color: "#A32D2D", r: 0.775, angles: [90, 270] },
  { type: "atm", icon: "ti-cash", color: "#534AB7", r: 0.775, angles: [0] },
  { type: "merch", icon: "ti-shopping-bag", color: "#534AB7", r: 0.775, angles: [180] },
  { type: "exit", icon: "ti-door-exit", color: "#3B6D11", r: 1.02, angles: [40, 140, 220, 320] },
  { type: "stairs", icon: "ti-stairs", color: "#5F5E5A", r: 1.02, angles: [65, 115, 245, 295] },
  { type: "elevator", icon: "ti-elevator", color: "#5F5E5A", r: 1.02, angles: [20, 200] },
  { type: "security", icon: "ti-shield", color: "#2C2C2A", r: 1.02, angles: [160, 340] },
  { type: "recycling", icon: "ti-recycle", color: "#3B6D11", r: 1.02, angles: [30, 210] },
  { type: "qr_beacon", icon: "ti-qrcode", color: "#2563EB", r: 1.02, angles: [125, 305] },
];

// Tier whose midpoint radius is closest to a given POI r-value ("matching tier").
function tierForR(r: number): TierSpec {
  let best = TIERS[0];
  let bestDist = Infinity;
  for (const T of TIERS) {
    const mid = (T.r0 + T.r1) / 2;
    const d = Math.abs(r - mid);
    if (d < bestDist) {
      bestDist = d;
      best = T;
    }
  }
  return best;
}

function nearestSectionInTier(angle: number, tier: 1 | 2 | 3): Zone {
  const candidates = sectionZones.filter((z) => z.tier === tier);
  let best = candidates[0];
  let bestDist = Infinity;
  for (const sec of candidates) {
    const d = angularDistance(sec.angle ?? 0, angle);
    if (d < bestDist) {
      bestDist = d;
      best = sec;
    }
  }
  return best;
}

const POI_LABELS: Record<Poi["type"], string> = {
  restroom: "Restroom",
  restroom_accessible: "Accessible Restroom",
  water: "Water Station",
  food: "Food Concession",
  first_aid: "First Aid Station",
  atm: "ATM",
  merch: "Merchandise",
  info: "Information Desk",
  stairs: "Stairwell",
  elevator: "Elevator",
  exit: "Exit",
  security: "Security Checkpoint",
  recycling: "Recycling",
  qr_beacon: "QR Access Beacon",
};

const tempPois: Poi[] = [];
FACILITY_SPECS.forEach((spec) => {
  const tier = tierForR(spec.r).tier;
  spec.angles.forEach((angle, idx) => {
    const nearestSection = nearestSectionInTier(angle, tier);
    tempPois.push({
      id: `poi-${spec.type}-${idx + 1}`,
      type: spec.type,
      label: `${POI_LABELS[spec.type]} ${idx + 1}`,
      nearestZone: nearestSection.id,
      angle,
      r: spec.r,
      status: "open",
    });
  });
});

export const POIS = tempPois;

// ---------------------------------------------------------------------------
// Lookup APIs
// ---------------------------------------------------------------------------

const zoneMap = new Map<string, Zone>();
const edgesMap = new Map<string, Edge[]>();
const poisMap = new Map<string, Poi[]>();

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
