// Superellipse boundary point at angle theta (degrees), radius r, exponent n (default 4).
// Translates angle to radians internally.
export function superellipsePoint(r: number, theta: number, n = 4): { x: number; y: number } {
  const thetaRad = (theta * Math.PI) / 180;
  const cosVal = Math.cos(thetaRad);
  const sinVal = Math.sin(thetaRad);
  
  // Custom sign check to stay robust at exact boundaries
  const xSign = cosVal >= 0 ? 1 : -1;
  const ySign = sinVal >= 0 ? 1 : -1;
  
  const x = r * xSign * Math.pow(Math.abs(cosVal), 2 / n);
  const y = r * ySign * Math.pow(Math.abs(sinVal), 2 / n);
  
  return { x, y };
}

// Builds an annular-sector polygon (array of [x,y] points: outer arc then inner arc reversed)
// for one section, given center angle, angular width, rInner, rOuter, exponent n, and a
// sample count (points per arc, default 8) for smoothness.
export function sectionPolygon(
  centerAngleDeg: number,
  widthDeg: number,
  rInner: number,
  rOuter: number,
  n = 4,
  samplesPerArc = 8
): [number, number][] {
  const startAngle = centerAngleDeg - widthDeg / 2;
  const endAngle = centerAngleDeg + widthDeg / 2;
  const points: [number, number][] = [];

  // Outer arc: from startAngle to endAngle
  for (let i = 0; i < samplesPerArc; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / (samplesPerArc - 1));
    const pt = superellipsePoint(rOuter, angle, n);
    points.push([pt.x, pt.y]);
  }

  // Inner arc: from endAngle to startAngle (reversed)
  for (let i = samplesPerArc - 1; i >= 0; i--) {
    const angle = startAngle + (endAngle - startAngle) * (i / (samplesPerArc - 1));
    const pt = superellipsePoint(rInner, angle, n);
    points.push([pt.x, pt.y]);
  }

  return points;
}

// Converts a polar (angleDeg, r) POI/marker position to cartesian using the same superellipse
// warp as sections, so POIs sit visually on the bowl (not on a plain circle).
export function polarToSuperellipseXY(angleDeg: number, r: number, n = 4): { x: number; y: number } {
  return superellipsePoint(r, angleDeg, n);
}
