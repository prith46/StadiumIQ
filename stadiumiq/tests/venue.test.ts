import { describe, it, expect } from "vitest";
import { ZONES, EDGES, POIS, GATES, TRANSIT_NODES, getZone, getEdgesFrom, getPoisNear } from "@/lib/venue/venue";
import { superellipsePoint, sectionPolygon } from "@/lib/venue/geometry";
import { PoiType } from "@/lib/types";

describe("F2: Venue Graph & Data Model Tests", () => {
  // 1. Section count
  it("has exactly 60 section zones, correctly partitioned by tier", () => {
    const sections = ZONES.filter((z) => z.type === "section");
    expect(sections.length).toBe(60);

    const tier1 = sections.filter((z) => z.tier === 1);
    const tier2 = sections.filter((z) => z.tier === 2);
    const tier3 = sections.filter((z) => z.tier === 3);

    expect(tier1.length).toBe(16);
    expect(tier2.length).toBe(20);
    expect(tier3.length).toBe(24);
  });

  // 2. Graph integrity
  it("ensures every Edge from and to references an existing zone ID", () => {
    const zoneIds = new Set(ZONES.map((z) => z.id));
    EDGES.forEach((edge) => {
      expect(zoneIds.has(edge.from)).toBe(true);
      expect(zoneIds.has(edge.to)).toBe(true);
    });
  });

  // 3. Connectivity (BFS traversal assertion)
  it("ensures every section zone has a path to at least one gate", () => {
    const sections = ZONES.filter((z) => z.type === "section");
    const gatesSet = new Set(GATES);

    // Build adjacency list for BFS
    const adjMap = new Map<string, string[]>();
    EDGES.forEach((edge) => {
      let neighbors = adjMap.get(edge.from);
      if (!neighbors) {
        neighbors = [];
        adjMap.set(edge.from, neighbors);
      }
      neighbors.push(edge.to);
    });

    sections.forEach((sec) => {
      // Run BFS starting at sec.id
      const visited = new Set<string>();
      const queue: string[] = [sec.id];
      visited.add(sec.id);
      let foundGate = false;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (gatesSet.has(curr)) {
          foundGate = true;
          break;
        }
        const neighbors = adjMap.get(curr) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      expect(foundGate).toBe(true);
    });
  });

  // 4. POI validity
  it("ensures all POIs reference real zone IDs and all 14 types appear at least once", () => {
    const zoneIds = new Set(ZONES.map((z) => z.id));
    const uniqueTypes = new Set<PoiType>();

    POIS.forEach((poi) => {
      expect(zoneIds.has(poi.nearestZone)).toBe(true);
      uniqueTypes.add(poi.type);
    });

    expect(uniqueTypes.size).toBe(14);
    
    // Validate each of the 14 types exists
    const expectedTypes: PoiType[] = [
      "restroom", "restroom_accessible", "water", "food", "first_aid", "atm",
      "merch", "info", "stairs", "elevator", "exit", "security", "recycling", "qr_beacon"
    ];
    expectedTypes.forEach((t) => {
      expect(uniqueTypes.has(t)).toBe(true);
    });
  });

  // 5. Gate/transit counts
  it("has exactly 4 gates and exactly 4 transit nodes", () => {
    expect(GATES.length).toBe(4);
    expect(TRANSIT_NODES.length).toBe(4);
  });

  // 6. Geometry bounds
  it("verifies geometry functions stay within expected coordinate bounds", () => {
    // Check angles 0 to 360
    for (let angle = 0; angle <= 360; angle += 15) {
      const pt120 = superellipsePoint(120, angle);
      expect(pt120.x).not.toBeNaN();
      expect(pt120.y).not.toBeNaN();
      expect(Math.abs(pt120.x)).toBeLessThanOrEqual(400);
      expect(Math.abs(pt120.y)).toBeLessThanOrEqual(400);

      const pt370 = superellipsePoint(370, angle);
      expect(pt370.x).not.toBeNaN();
      expect(pt370.y).not.toBeNaN();
      expect(Math.abs(pt370.x)).toBeLessThanOrEqual(400);
      expect(Math.abs(pt370.y)).toBeLessThanOrEqual(400);
    }

    // Check sectionPolygon bounds
    const poly = sectionPolygon(270, 22.5, 120, 195);
    expect(poly.length).toBe(16); // 8 outer + 8 inner
    poly.forEach(([x, y]) => {
      expect(x).not.toBeNaN();
      expect(y).not.toBeNaN();
      expect(Math.abs(x)).toBeLessThanOrEqual(400);
      expect(Math.abs(y)).toBeLessThanOrEqual(400);
    });
  });

  // 7. getZone / getEdgesFrom / getPoisNear API
  it("safely queries zone lookups without crashing", () => {
    // Known Section lookup
    const secZone = getZone("sec-101");
    expect(secZone).toBeDefined();
    expect(secZone!.label).toBe("101");

    // Unknown zone lookup
    const missingZone = getZone("sec-999");
    expect(missingZone).toBeUndefined();

    // Edges lookup
    const edges = getEdgesFrom("sec-101");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].from).toBe("sec-101");

    const noEdges = getEdgesFrom("field-center");
    expect(noEdges).toEqual([]);

    // POIs lookup
    const pois = getPoisNear("concourse-1-n");
    expect(pois.length).toBeGreaterThan(0);

    const noPois = getPoisNear("sec-101");
    expect(noPois).toEqual([]);
  });

  // 8. Geometry formula correctness at known cardinal angles
  it("superellipsePoint matches the formula at cardinal angles", () => {
    // Convention: East = 0deg, South = 90deg (SVG y-down, clockwise).
    const east = superellipsePoint(100, 0); // theta=0 -> x≈100, y≈0
    expect(east.x).toBeCloseTo(100, 1);
    expect(east.y).toBeCloseTo(0, 1);

    const south = superellipsePoint(100, 90); // theta=90 -> x≈0, y≈100
    expect(south.x).toBeCloseTo(0, 1);
    expect(south.y).toBeCloseTo(100, 1);

    const west = superellipsePoint(100, 180); // theta=180 -> x≈-100, y≈0
    expect(west.x).toBeCloseTo(-100, 1);
    expect(west.y).toBeCloseTo(0, 1);

    const north = superellipsePoint(100, 270); // theta=270 -> x≈0, y≈-100
    expect(north.x).toBeCloseTo(0, 1);
    expect(north.y).toBeCloseTo(-100, 1);
  });

  // 9. Gate/transit zones actually exist in ZONES (not just in exported constant arrays)
  it("ZONES contains exactly 4 gate zones and 4 transit zones", () => {
    expect(ZONES.filter((z) => z.type === "gate").length).toBe(4);
    expect(ZONES.filter((z) => z.type === "transit").length).toBe(4);
  });

  // 10. Concourse count
  it("has exactly 12 concourse zones", () => {
    expect(ZONES.filter((z) => z.type === "concourse").length).toBe(12);
  });

  // 11. Tier radii match locked spec values
  it("section tier radii match the locked spec values", () => {
    const tier1 = ZONES.filter((z) => z.tier === 1 && z.type === "section");
    expect(tier1.length).toBe(16);
    tier1.forEach((z) => {
      expect(z.rInner).toBe(120);
      expect(z.rOuter).toBe(195);
    });
    const tier2 = ZONES.filter((z) => z.tier === 2 && z.type === "section");
    expect(tier2.length).toBe(20);
    tier2.forEach((z) => {
      expect(z.rInner).toBe(210);
      expect(z.rOuter).toBe(280);
    });
    const tier3 = ZONES.filter((z) => z.tier === 3 && z.type === "section");
    expect(tier3.length).toBe(24);
    tier3.forEach((z) => {
      expect(z.rInner).toBe(295);
      expect(z.rOuter).toBe(370);
    });
  });

  // 12. Angular widths implied by section counts per tier (16*22.5 = 20*18 = 24*15 = 360)
  it("section angular widths per tier are correct", () => {
    const width = (count: number) => 360 / count;
    expect(width(ZONES.filter((z) => z.tier === 1 && z.type === "section").length)).toBeCloseTo(22.5, 5);
    expect(width(ZONES.filter((z) => z.tier === 2 && z.type === "section").length)).toBeCloseTo(18, 5);
    expect(width(ZONES.filter((z) => z.tier === 3 && z.type === "section").length)).toBeCloseTo(15, 5);
  });

  // 13. Only stair (adjacent-tier concourse) edges are inaccessible
  it("only stair edges have accessible:false", () => {
    const inaccessible = EDGES.filter((e) => !e.accessible);
    expect(inaccessible.length).toBeGreaterThan(0);
    inaccessible.forEach((e) => {
      expect(e.from.startsWith("concourse-")).toBe(true);
      expect(e.to.startsWith("concourse-")).toBe(true);
      // vertical stair link: same stand, adjacent tiers
      const [, fromTier, fromStand] = e.from.split("-");
      const [, toTier, toStand] = e.to.split("-");
      expect(fromStand).toBe(toStand);
      expect(Math.abs(Number(fromTier) - Number(toTier))).toBe(1);
    });
  });

  // 14. Each transit node connects to 1-2 gates (not 0, not all 4)
  it("each transit node connects to 1-2 gates", () => {
    TRANSIT_NODES.forEach((t) => {
      const gateEdges = EDGES.filter((e) => e.from === t && GATES.includes(e.to));
      expect(gateEdges.length).toBeGreaterThanOrEqual(1);
      expect(gateEdges.length).toBeLessThanOrEqual(2);
    });
  });

  // 15. Walk-time ranges: section->concourse in 30-90s; ring 20-40s; concourse->gate 60-180s; all varied
  it("edge walk times are within spec ranges and not flat constants", () => {
    const sectionToConcourse = EDGES.filter((e) => e.from.startsWith("sec-")).map((e) => e.baseWalkSec);
    expect(sectionToConcourse.length).toBeGreaterThan(0);
    sectionToConcourse.forEach((w) => {
      expect(w).toBeGreaterThanOrEqual(30);
      expect(w).toBeLessThanOrEqual(90);
    });
    expect(Math.min(...sectionToConcourse)).not.toBe(Math.max(...sectionToConcourse));

    const ring = EDGES.filter((e) => {
      if (!e.from.startsWith("concourse-") || !e.to.startsWith("concourse-")) return false;
      const [, ft, fs] = e.from.split("-");
      const [, tt, ts] = e.to.split("-");
      return ft === tt && fs !== ts; // same tier, different stand
    }).map((e) => e.baseWalkSec);
    expect(ring.length).toBeGreaterThan(0);
    ring.forEach((w) => {
      expect(w).toBeGreaterThanOrEqual(20);
      expect(w).toBeLessThanOrEqual(40);
    });
    expect(Math.min(...ring)).not.toBe(Math.max(...ring));

    const toGate = EDGES.filter((e) => e.from.startsWith("concourse-") && GATES.includes(e.to)).map((e) => e.baseWalkSec);
    expect(toGate.length).toBeGreaterThan(0);
    toGate.forEach((w) => {
      expect(w).toBeGreaterThanOrEqual(60);
      expect(w).toBeLessThanOrEqual(180);
    });
    expect(Math.min(...toGate)).not.toBe(Math.max(...toGate));
  });
});
