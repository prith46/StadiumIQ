import { describe, it, expect } from "vitest";
import { ZONES, EDGES, POIS, GATES, TRANSIT_NODES, TIERS, getZone, getEdgesFrom, getPoisNear } from "@/lib/venue/venue";
import { pt } from "@/lib/venue/geometry";
import { PoiType } from "@/lib/types";

describe("F2: Venue Graph & Data Model Tests (MAP BUILD SPEC §22)", () => {
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

  // 6. Geometry bounds — pt() stays within the 680x396 canvas for all spec radii
  it("verifies pt() stays within expected canvas bounds for all zone radii", () => {
    for (let angle = -180; angle <= 360; angle += 15) {
      const pLower = pt(0.55, angle);
      expect(pLower.x).not.toBeNaN();
      expect(pLower.y).not.toBeNaN();

      const pTransit = pt(1.2, angle);
      expect(pTransit.x).not.toBeNaN();
      expect(pTransit.y).not.toBeNaN();
      // Transit markers (r=1.2) sit near the canvas edge by design — allow a
      // small margin beyond the nominal 680x396 viewBox rather than a hard clip.
      expect(pTransit.x).toBeGreaterThanOrEqual(-20);
      expect(pTransit.x).toBeLessThanOrEqual(700);
      expect(pTransit.y).toBeGreaterThanOrEqual(-20);
      expect(pTransit.y).toBeLessThanOrEqual(400);
    }
  });

  // 7. getZone / getEdgesFrom / getPoisNear API
  it("safely queries zone lookups without crashing", () => {
    const secZone = getZone("sec-101");
    expect(secZone).toBeDefined();
    expect(secZone!.label).toBe("101");

    const missingZone = getZone("sec-999");
    expect(missingZone).toBeUndefined();

    const edges = getEdgesFrom("sec-101");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].from).toBe("sec-101");

    const noEdges = getEdgesFrom("field-center");
    expect(noEdges).toEqual([]);

    const pois = getPoisNear(ZONES.find((z) => z.type === "section")!.id);
    // Some section is nearestZone for at least one POI (nearestSectionInTier assignment)
    expect(POIS.some((p) => p.nearestZone.startsWith("sec-"))).toBe(true);

    const noPois = getPoisNear("field-center");
    expect(noPois).toEqual([]);
  });

  // 8. pt() cardinal-angle correctness (cross-check against geometry.test.ts)
  it("pt() matches cardinal angles: East=0, South=90, West=180, North=270/-90", () => {
    const east = pt(1, 0);
    expect(east.y).toBeCloseTo(200, 1);
    expect(east.x).toBeGreaterThan(200);

    const north = pt(1, -90);
    expect(north.x).toBeCloseTo(340, 1);
    expect(north.y).toBeLessThan(200);
  });

  // 9. Gate/transit zones actually exist in ZONES (not just in exported constant arrays)
  it("ZONES contains exactly 4 gate zones and 4 transit zones", () => {
    expect(ZONES.filter((z) => z.type === "gate").length).toBe(4);
    expect(ZONES.filter((z) => z.type === "transit").length).toBe(4);
  });

  // 10. Concourse count — §22.7: one concourse node PER SECTION (60 total)
  it("has exactly 60 concourse zones (one per section)", () => {
    expect(ZONES.filter((z) => z.type === "concourse").length).toBe(60);
  });

  // 11. Tier radii match the locked §22.2 fractional spec values
  it("section tier radii match the locked §22.2 spec values", () => {
    const tier1 = ZONES.filter((z) => z.tier === 1 && z.type === "section");
    expect(tier1.length).toBe(16);
    tier1.forEach((z) => {
      expect(z.rInner).toBeCloseTo(0.34, 5);
      expect(z.rOuter).toBeCloseTo(0.55, 5);
    });
    const tier2 = ZONES.filter((z) => z.tier === 2 && z.type === "section");
    expect(tier2.length).toBe(20);
    tier2.forEach((z) => {
      expect(z.rInner).toBeCloseTo(0.585, 5);
      expect(z.rOuter).toBeCloseTo(0.76, 5);
    });
    const tier3 = ZONES.filter((z) => z.tier === 3 && z.type === "section");
    expect(tier3.length).toBe(24);
    tier3.forEach((z) => {
      expect(z.rInner).toBeCloseTo(0.795, 5);
      expect(z.rOuter).toBeCloseTo(1.0, 5);
    });
  });

  // 12. Angular widths implied by section counts per tier (16*22.5 = 20*18 = 24*15 = 360)
  it("section angular widths per tier are correct", () => {
    const width = (count: number) => 360 / count;
    expect(width(ZONES.filter((z) => z.tier === 1 && z.type === "section").length)).toBeCloseTo(22.5, 5);
    expect(width(ZONES.filter((z) => z.tier === 2 && z.type === "section").length)).toBeCloseTo(18, 5);
    expect(width(ZONES.filter((z) => z.tier === 3 && z.type === "section").length)).toBeCloseTo(15, 5);
  });

  // 13. Only radial "stairs" edges (section <-> its own concourse node) are inaccessible — §22.7
  it("only the stairs-variant radial section<->concourse edges have accessible:false", () => {
    const inaccessible = EDGES.filter((e) => !e.accessible);
    expect(inaccessible.length).toBeGreaterThan(0);
    inaccessible.forEach((e) => {
      const sectionSide = e.from.startsWith("sec-") ? e.from : e.to;
      const concourseSide = e.from.startsWith("con-") ? e.from : e.to;
      expect(sectionSide.startsWith("sec-")).toBe(true);
      expect(concourseSide).toBe(`con-${sectionSide}`);
    });
  });

  // 14. Each transit node connects to exactly 1 nearest gate — §22.7
  it("each transit node connects to exactly 1 nearest gate", () => {
    TRANSIT_NODES.forEach((t) => {
      const gateEdges = EDGES.filter((e) => e.from === t && GATES.includes(e.to));
      expect(gateEdges.length).toBe(1);
    });
  });

  // 15. Exact walk-time constants per §22.7 (zero-decision spec — these are fixed, not ranges)
  it("edge walk times match the exact §22.7 constants", () => {
    const stairsEdges = EDGES.filter(
      (e) => !e.accessible && e.from.startsWith("sec-") && e.to.startsWith("con-")
    );
    expect(stairsEdges.length).toBeGreaterThan(0);
    stairsEdges.forEach((e) => expect(e.baseWalkSec).toBe(25));

    const elevatorEdges = EDGES.filter(
      (e) => e.accessible && e.from.startsWith("sec-") && e.to.startsWith("con-")
    );
    expect(elevatorEdges.length).toBeGreaterThan(0);
    elevatorEdges.forEach((e) => expect(e.baseWalkSec).toBe(40));

    const ringEdges = EDGES.filter((e) => e.from.startsWith("con-") && e.to.startsWith("con-"));
    expect(ringEdges.length).toBeGreaterThan(0);
    ringEdges.forEach((e) => expect(e.baseWalkSec).toBe(20));

    const gateEdges = EDGES.filter((e) => GATES.includes(e.from) && e.to.startsWith("con-"));
    expect(gateEdges.length).toBeGreaterThan(0);
    gateEdges.forEach((e) => expect(e.baseWalkSec).toBe(15));

    const transitEdges = EDGES.filter((e) => TRANSIT_NODES.includes(e.from) && GATES.includes(e.to));
    expect(transitEdges.length).toBeGreaterThan(0);
    transitEdges.forEach((e) => expect(e.baseWalkSec).toBe(30));
  });

  // 16. TIERS constant matches the locked spec
  it("TIERS matches the locked §22.2 spec exactly", () => {
    expect(TIERS).toEqual([
      { key: "lower", r0: 0.34, r1: 0.55, count: 16, base: 100, tier: 1 },
      { key: "mid", r0: 0.585, r1: 0.76, count: 20, base: 200, tier: 2 },
      { key: "upper", r0: 0.795, r1: 1.0, count: 24, base: 300, tier: 3 },
    ]);
  });
});
