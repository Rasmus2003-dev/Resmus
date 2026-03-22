
export enum Provider {
  VASTTRAFIK = 'VT',
  SL = 'SL',
  RESROBOT = 'RESROBOT',
  TRAFIKVERKET = 'TRV'
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Station {
  id: string;
  name: string;
  provider: Provider;
  coords: Coordinates;
}

export interface Departure {
  id: string;
  line: string;
  direction: string;
  time: string; // HH:MM
  datetime: string; // ISO Full DateTime (alias for timestamp, or we add both)
  timestamp: string; // ISO Full DateTime for sorting
  realtime?: string; // HH:MM
  stopPoint: { name: string; gid: string }; // Add missing stopPoint object
  track: string;
  provider: Provider;
  status: 'ON_TIME' | 'LATE' | 'CANCELLED' | 'EARLY';
  fgColor?: string;
  bgColor?: string;
  journeyRef?: string;
  journeyDetailRefUrl?: string;
  hasDisruption?: boolean;
  disruptionSeverity?: 'severe' | 'normal' | 'slight' | 'unknown';
  disruptionMessage?: string;
  type?: 'BUS' | 'TRAM' | 'TRAIN' | 'FERRY' | 'METRO' | 'UNK';
  serviceJourneyGid?: string;
  lineGid?: string;
  operationalTransportIdentifiers?: any;
}

export interface StopOnTrip {
  name: string;
  time: string;
  plannedIso: string;
  estimatedIso?: string;
  isCompleted: boolean;
}

export interface TrafficSituation {
  situationNumber: string;
  creationTime: string;
  startTime: string;
  endTime?: string;
  /** Tid då händelsen publicerades/ändrades (t.ex. ModifiedDateTime). */
  publishedTime?: string;
  /** Orsakskod (t.ex. OMÄ03) från Trafikverket. */
  reasonCode?: string;
  severity: 'severe' | 'normal' | 'slight';
  title: string;
  description: string;
  affectedLines: {
    gid: string;
    designation: string;
    transportAuthorityName?: string;
    textColor?: string;
    backgroundColor?: string;
  }[];
  affectedStopPoints?: {
    gid: string;
    name: string;
  }[];
  affected?: { designation: string; color?: string; textColor?: string }[];
}

// --- Trip Planner Types ---

export interface TripLeg {
  origin: { name: string; time: string; track?: string; date?: string; coords?: Coordinates };
  destination: { name: string; time: string; track?: string; date?: string; coords?: Coordinates };
  name: string;
  direction?: string;
  type: 'WALK' | 'BUS' | 'TRAM' | 'TRAIN' | 'METRO' | 'FERRY' | 'UNK';
  fgColor?: string;
  bgColor?: string;
  duration: number; // minutes
  distance?: number; // meters (for walking)
  messages?: string[];
  cancelled?: boolean;
  disruptionSeverity?: 'severe' | 'normal' | 'slight' | 'unknown';
  intermediateStops?: { name: string; time: string; coords?: Coordinates; }[];
}

export interface Journey {
  id: string;
  legs: TripLeg[];
  startTime: string;
  endTime: string;
  duration: number; // minutes
}

export interface JourneyDetail {
  name: string;
  time: string; // Keep legacy for fallback
  track?: string;
  date?: string;
  isCancelled?: boolean;
  isDeparture?: boolean;
  coords?: Coordinates;
  arrivalTime?: string;
  departureTime?: string;
  realtimeArrival?: string;
  realtimeDeparture?: string;
  operationalTransportIdentifiers?: any;
}
