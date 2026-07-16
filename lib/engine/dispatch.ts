import { Incident, Responder } from '../types';

export interface DispatchAssignment {
  incidentId: string;
  responderId: string | null;   // null if no match found
  etaSec: number | null;
  predictedBreach: boolean;     // true if etaSec exceeds a defined SLA threshold
}

/**
 * Sync responder assignment logic.
 * Finds the nearest available responder who possesses the skill matching the incident type.
 * ETA is equal to the graph walk time.
 */
export function assignResponder(
  incident: Incident,
  responders: Responder[],
  graphDistanceFn: (fromZoneId: string, toZoneId: string) => number
): DispatchAssignment {
  // 1. Filter responders by availability and required skill
  const candidates = responders.filter(
    (resp) => resp.available && resp.skills.includes(incident.type)
  );

  if (candidates.length === 0) {
    return {
      incidentId: incident.id,
      responderId: null,
      etaSec: null,
      predictedBreach: false,
    };
  }

  // 2. Find closest responder by graph distance
  let bestResponder: Responder | null = null;
  let minDistance = Infinity;

  for (const resp of candidates) {
    const dist = graphDistanceFn(resp.zoneId, incident.zoneId);
    if (dist < minDistance) {
      minDistance = dist;
      bestResponder = resp;
    }
  }

  // If the closest is unreachable (Infinity), treat as no responder found
  if (minDistance === Infinity || bestResponder === null) {
    return {
      incidentId: incident.id,
      responderId: null,
      etaSec: null,
      predictedBreach: false,
    };
  }

  const etaSec = Math.round(minDistance);
  const predictedBreach = isBreachPredicted(etaSec);

  return {
    incidentId: incident.id,
    responderId: bestResponder.id,
    etaSec,
    predictedBreach,
  };
}

/**
 * Predicts SLA breach if ETA exceeds threshold.
 * SLA default threshold is set to 300 seconds (5 minutes).
 */
export function isBreachPredicted(etaSec: number, slaSec: number = 300): boolean {
  return etaSec > slaSec;
}
