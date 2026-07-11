import { describe, it, expect } from "vitest";
import { pt, sectorPath, pctPos, densityToBand, cx, cy, SX, SY } from "./geometry";

describe("F2/M4 Geometry Unit Tests (MAP BUILD SPEC §22.1/§22.6)", () => {
  describe("pt() — superellipse point", () => {
    it("matches the exact formula at cardinal angles (East=0, South=90, West=180, North=270/-90)", () => {
      const east = pt(1, 0);
      expect(east.x).toBeCloseTo(cx + SX, 1);
      expect(east.y).toBeCloseTo(cy, 1);

      const south = pt(1, 90);
      expect(south.x).toBeCloseTo(cx, 1);
      expect(south.y).toBeCloseTo(cy + SY, 1);

      const west = pt(1, 180);
      expect(west.x).toBeCloseTo(cx - SX, 1);
      expect(west.y).toBeCloseTo(cy, 1);

      const north = pt(1, -90);
      expect(north.x).toBeCloseTo(cx, 1);
      expect(north.y).toBeCloseTo(cy - SY, 1);

      // -90 and 270 are the same physical angle
      const northEquivalent = pt(1, 270);
      expect(northEquivalent.x).toBeCloseTo(north.x, 3);
      expect(northEquivalent.y).toBeCloseTo(north.y, 3);
    });

    it("scales linearly with r and stays finite/non-NaN across the full angle range", () => {
      for (let angle = -180; angle <= 360; angle += 15) {
        const p1 = pt(1, angle);
        expect(p1.x).not.toBeNaN();
        expect(p1.y).not.toBeNaN();

        const p2 = pt(2, angle);
        // r scales linearly (superellipse point is a direct multiple of r)
        expect(p2.x - cx).toBeCloseTo((p1.x - cx) * 2, 5);
        expect(p2.y - cy).toBeCloseTo((p1.y - cy) * 2, 5);
      }
    });
  });

  describe("sectorPath() — annular-sector polygon", () => {
    it("generates a valid, closed SVG path starting with M and ending with Z", () => {
      const pathStr = sectorPath(0, 90, 0.3, 0.6);

      expect(typeof pathStr).toBe("string");
      expect(pathStr.startsWith("M")).toBe(true);
      expect(pathStr.endsWith("Z")).toBe(true);
    });

    it("samples exactly 7 points per arc (m=6), 14 total, 13 L commands", () => {
      const pathStr = sectorPath(0, 90, 0.3, 0.6);
      const lMatches = pathStr.match(/L/g);
      const mMatches = pathStr.match(/M/g);
      const zMatches = pathStr.match(/Z/g);

      expect(mMatches?.length).toBe(1);
      expect(zMatches?.length).toBe(1);
      // 7 outer + 7 inner = 14 points; M consumes the first, so 13 L's remain.
      expect(lMatches?.length).toBe(13);
    });
  });

  describe("pctPos() — HTML overlay percent position", () => {
    it("converts a pt() coordinate into a 0-100 percentage of the 680x396 canvas", () => {
      const east = pctPos(1, 0);
      expect(east.left).toBeCloseTo(((cx + SX) / 680) * 100, 3);
      expect(east.top).toBeCloseTo((cy / 396) * 100, 3);
    });
  });

  describe("densityToBand() — §22.6 exact 3-band thresholds (discrete, no interpolation)", () => {
    it("d < 0.34 -> clear green", () => {
      expect(densityToBand(0)).toEqual({ fill: "#C0DD97", stroke: "#639922" });
      expect(densityToBand(0.33)).toEqual({ fill: "#C0DD97", stroke: "#639922" });
    });

    it("d < 0.67 -> busy amber", () => {
      expect(densityToBand(0.34)).toEqual({ fill: "#FAC775", stroke: "#BA7517" });
      expect(densityToBand(0.66)).toEqual({ fill: "#FAC775", stroke: "#BA7517" });
    });

    it("else -> crowded red", () => {
      expect(densityToBand(0.67)).toEqual({ fill: "#F09595", stroke: "#A32D2D" });
      expect(densityToBand(1)).toEqual({ fill: "#F09595", stroke: "#A32D2D" });
    });
  });
});
