/**
 * lib/venue/geometry.ts
 *
 * F2 geometry — superellipse "rounded-rectangle bowl" projection, per MAP BUILD
 * SPEC §22.1 (exact values, zero decisions).
 *
 * Canvas: viewBox="0 0 680 396" (cx=340, cy=200), semi-axes SX=260, SY=165,
 * exponent e = 2/N_EXP = 0.5 (N_EXP=4).
 *
 * This file has NO React/zustand imports — pure geometry, trivially testable.
 */

export const cx = 340;
export const cy = 200;
export const SX = 260;
export const SY = 165;
export const N_EXP = 4;
export const SUPERELLIPSE_EXPONENT = 2 / N_EXP; // 0.5

/** Superellipse point (rounded-rectangle bowl). r is a 0..~1.25 radial fraction. */
export function pt(r: number, angDeg: number): { x: number; y: number } {
  const t = (angDeg * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return {
    x: cx + SX * r * Math.sign(ct) * Math.pow(Math.abs(ct), SUPERELLIPSE_EXPONENT),
    y: cy + SY * r * Math.sign(st) * Math.pow(Math.abs(st), SUPERELLIPSE_EXPONENT),
  };
}

/** Annular-sector polygon path between inner radius ri and outer ro, angles a1..a2. */
export function sectorPath(a1: number, a2: number, ri: number, ro: number): string {
  const m = 6;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= m; i++) {
    const a = a1 + ((a2 - a1) * i) / m;
    pts.push(pt(ro, a));
  }
  for (let i = m; i >= 0; i--) {
    const a = a1 + ((a2 - a1) * i) / m;
    pts.push(pt(ri, a));
  }
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
}

/** Percent position for HTML overlay markers (icons) over the SVG. */
export function pctPos(r: number, angDeg: number): { left: number; top: number } {
  const p = pt(r, angDeg);
  return { left: (p.x / 680) * 100, top: (p.y / 396) * 100 };
}

// ---------------------------------------------------------------------------
// Heatmap coloring — §22.6 (exact 3-band thresholds, discrete, no interpolation)
// ---------------------------------------------------------------------------

export interface HeatBand {
  fill: string;
  stroke: string;
}

/**
 * d < 0.34  -> clear (green)
 * d < 0.67  -> busy (amber)
 * else      -> crowded (red)
 */
export function densityToBand(density: number): HeatBand {
  if (density < 0.34) return { fill: '#C0DD97', stroke: '#639922' };
  if (density < 0.67) return { fill: '#FAC775', stroke: '#BA7517' };
  return { fill: '#F09595', stroke: '#A32D2D' };
}
