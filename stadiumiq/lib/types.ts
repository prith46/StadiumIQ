export type ZoneType = 'section' | 'concourse' | 'gate' | 'transit' | 'field';

export interface Zone {
  id: string;
  label: string;
  type: ZoneType;
  tier?: 1 | 2 | 3;
  stand?: 'n' | 'e' | 's' | 'w';
  angle?: number;
  rInner?: number;
  rOuter?: number;
  capacity?: number;
  attrs: {
    accessible: boolean;
    enclosed: boolean;
    noise: 'low' | 'med' | 'high';
    affiliation?: 'home' | 'away' | 'neutral';
  };
}

export interface Edge {
  from: string;
  to: string;
  baseWalkSec: number;
  accessible: boolean;
  enclosed: boolean;
  noise: 'low' | 'med' | 'high';
}

export type PoiType =
  | 'restroom' | 'restroom_accessible' | 'water' | 'food' | 'first_aid' | 'atm'
  | 'merch' | 'info' | 'stairs' | 'elevator' | 'exit' | 'security' | 'recycling' | 'qr_beacon';

export interface Poi {
  id: string;
  type: PoiType;
  label: string;
  nearestZone: string;
  angle: number;
  r: number;
  status: 'open' | 'busy' | 'closed';
}

export type MatchPhase = 'pre' | 'firstHalf' | 'half' | 'secondHalf' | 'fullTime';

export interface SimConfig {
  tickIntervalMs: number;      // real-world ms between ticks
  simSecondsPerTick: number;   // sim-seconds advanced per tick
  seed: number;                // PRNG seed for timeline + per-zone jitter
}

export interface SosState {
  active: boolean;
  triggeredBy: 'fan' | 'organizer' | null;
  triggeredAtSec: number;
}

export interface SimState {
  matchClockSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  incidents: Incident[];
  routedLoad: Record<string, number>;
  sensorCounts: Record<string, number>;
  timeline: DensityFrame[];
  sos?: SosState;
}

export interface DensityFrame {
  atSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
}

export interface FanContext {
  language: string;
  location?: string;
  accessibility: boolean;
  sensory?: { quiet?: boolean; openAir?: boolean; avoidAffiliation?: 'home' | 'away' };
  group?: 'solo' | 'family' | 'group';
  leavingEarly?: boolean;
  ticket?: TicketData;
}

export interface TicketData {
  section: string;
  gate: string;
  nationality: string;
  countryCode: string;
  seat?: string;
}

export interface Alert {
  id: string;
  kind: 'proactive' | 'incentive' | 'safety' | 'ops';
  priority: 1 | 2 | 3;
  title: string;
  body: string;
  zoneId?: string;
  createdAt: number;
  action?: string;
}

export interface Incident {
  id: string;
  type: 'crowd' | 'medical' | 'assistance' | 'security' | 'evacuation';
  zoneId: string;
  note: string;
  status: 'pending' | 'dispatched' | 'resolved';
  createdAt: number;
  responderId?: string;
  etaSec?: number;
}

export interface Responder {
  id: string;
  label: string;
  zoneId: string;
  skills: Incident['type'][];
  available: boolean;
}

export interface Incentive {
  id: string;
  fromZone: string;
  toZone: string;
  reward: string;
  qrPayload: string;
  expiresAt: number;
}

export interface AssistantResponse {
  message: string;
  language: string;
  mapActions: Array<{ op: 'highlight' | 'route' | 'pin'; zoneId?: string; path?: string[] }>;
  alertLevel: 'none' | 'info' | 'warn' | 'critical';
  meta?: { tool?: string; stress?: boolean };
}

export interface Scenario {
  id: string;
  label: string;
  patch: Partial<SimState>;
}

export interface UploadDataset {
  density?: Record<string, number>;
  incidents?: Incident[];
  gateStatus?: Record<string, 'open' | 'congested' | 'closed'>;
}
