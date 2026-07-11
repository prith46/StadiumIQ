/**
 * lib/engine/sensoryFilters.ts
 *
 * Pure translation from a fan's `FanContext.sensory` preferences to the
 * `RouteFilters` shape M3's routing engine (`lib/engine/routing.ts`) already
 * understands. This is the ONE canonical mapping — every call site (M2's tool
 * adapter, M6's alertService, M9's incentiveService) uses this function rather
 * than reimplementing the mapping inline.
 *
 * No zustand/react/network imports — trivially unit-testable.
 */

import type { RouteFilters } from './routing';
import type { FanContext } from '../types';

/**
 * `quiet` maps to BOTH `avoidEnclosed` and `maxNoise: 'low'` — a fan asking for
 * quiet cares about decibel level (maxNoise), which correlates with but is not
 * identical to enclosure (avoidEnclosed). Enclosed concourses in this venue are
 * tagged noise 'med', not universally loud, so noise and enclosure are related-
 * but-distinct concepts and both are penalised for a "quiet" request.
 *
 * `openAir` maps to `avoidEnclosed` only — it is the direct inverse of enclosed
 * space, with no noise-level implication of its own.
 *
 * Both `quiet` and `openAir` independently imply `avoidEnclosed`; either one
 * being true is sufficient (OR logic) to set it.
 */
export function sensoryToRouteFilters(
  sensory?: FanContext['sensory']
): Pick<RouteFilters, 'avoidEnclosed' | 'maxNoise' | 'avoidAffiliation'> {
  const avoidEnclosed = sensory?.quiet || sensory?.openAir ? true : undefined;
  const maxNoise = sensory?.quiet ? 'low' : undefined;
  const avoidAffiliation = sensory?.avoidAffiliation;

  return { avoidEnclosed, maxNoise, avoidAffiliation };
}
