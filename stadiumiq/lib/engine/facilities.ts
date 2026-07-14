import type { Poi } from '../types';
import { EDGES, ZONES } from '../venue/venue';
import { buildGraph, shortestDistance } from './routing';

function getTierAndSectionNumber(zoneId: string): { tier: number; num: number } | null {
  if (!zoneId.startsWith('sec-')) return null;
  const numStr = zoneId.substring(4);
  const num = parseInt(numStr, 10);
  if (isNaN(num)) return null;
  const tier = Math.floor(num / 100);
  return { tier, num };
}

// Ring sizes must match venue.ts TIERS: lower (tier 1) = 16 sections,
// mid (tier 2) = 20, upper (tier 3) = 24.
function getTierSize(tier: number): number {
  if (tier === 1) return 16;
  if (tier === 2) return 20;
  if (tier === 3) return 24;
  return 16; // default
}

/**
 * Checks if two zones (e.g. standard vs accessible amenity) are comparably close.
 * Criteria:
 *   1. Both seating sections, in the same tier, and circular section delta <= 2.
 *   2. Or if walking distance delta is <= 60 seconds.
 */
function isComparablyClose(
  zoneA: string,
  zoneB: string,
  distA: number,
  distB: number
): boolean {
  const geomA = getTierAndSectionNumber(zoneA);
  const geomB = getTierAndSectionNumber(zoneB);
  if (geomA && geomB && geomA.tier === geomB.tier) {
    const N = getTierSize(geomA.tier);
    const diff = Math.abs(geomA.num - geomB.num);
    const ringDist = Math.min(diff, N - diff);
    if (ringDist <= 2) return true;
  }
  // Fallback to walking distance delta <= 60 seconds
  return Math.abs(distA - distB) <= 60;
}

/**
 * Sorts and filters facilities to prioritize accessible variants when the fan has an accessibility need.
 * If needsAccessible is true and an accessible variant exists comparably close to the closest standard variant,
 * the accessible variant is moved/ranked first. Otherwise, sorted purely by walking distance.
 */
export function prioritizeAccessibleFacilities(
  pois: Poi[],
  fromZoneId: string,
  needsAccessible: boolean
): Poi[] {
  // Build a standard distance-only graph to compute actual walking time using Dijkstra
  const distGraph = buildGraph(EDGES, ZONES, {}, {}, {}, {});

  // Pre-calculate distance for each POI
  const poisWithDist = pois.map((poi) => {
    const dist = shortestDistance(distGraph, fromZoneId, poi.nearestZone);
    return { poi, dist };
  });

  // Always sort by walking distance first (ascending)
  poisWithDist.sort((a, b) => a.dist - b.dist);

  if (!needsAccessible) {
    return poisWithDist.map((x) => x.poi);
  }

  // Find the closest standard variant (e.g. 'restroom') and closest accessible variant (e.g. 'restroom_accessible')
  const standardPois = poisWithDist.filter((x) => x.poi.type === 'restroom');
  const accessiblePois = poisWithDist.filter((x) => x.poi.type === 'restroom_accessible');

  if (standardPois.length > 0 && accessiblePois.length > 0) {
    const closestStandard = standardPois[0];
    const closestAccessible = accessiblePois[0];

    // Check if the closest accessible POI is "comparably close" to the closest standard POI
    const canPromote = isComparablyClose(
      closestStandard.poi.nearestZone,
      closestAccessible.poi.nearestZone,
      closestStandard.dist,
      closestAccessible.dist
    );

    if (canPromote) {
      // Promote the closest accessible variant to the absolute top of the sorted list
      const otherPois = poisWithDist.filter((x) => x.poi.id !== closestAccessible.poi.id);
      return [closestAccessible.poi, ...otherPois.map((x) => x.poi)];
    }
  }

  return poisWithDist.map((x) => x.poi);
}
