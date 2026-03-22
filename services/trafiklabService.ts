
import { API_KEYS, API_URLS, getRealtimeKeys } from './config';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import jltVehicles from '../src/jlt-vehicles.json';
import slVehicles from '../src/sl-vehicles.json';
import skaneVehicles from '../src/skane-vehicles.json';
import { GtfsShapeService } from './gtfsShapeService';
import { GtfsSwedenStaticService } from './gtfsSwedenStaticService';

// Helper for CORS requests
const fetchWithCors = async (url: string, options: RequestInit = {}) => {
    const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(targetUrl);
    return fetch(proxyUrl, options);
};

// TripUpdate cache per operator (30s TTL)
const tripUpdateCache: Record<string, { ts: number; data: any[] }> = {};

export interface VehiclePosition {
    id: string;
    line: string;
    direction?: string;
    dest?: string;  // destination (trip_headsign från GTFS-RT)
    lat: number;
    lng: number;
    bearing?: number;
    speed?: number;
    type: string;
    operator?: string;
    // GTFS-RT trip linkage (used for shape resolution)
    tripId?: string;
    routeId?: string;
    vehicleLabel?: string;
    // Real-time status
    currentStatus?: string;   // IN_TRANSIT_TO | STOPPED_AT | INCOMING_AT
    stopId?: string;
    stopSequence?: number;
    occupancyStatus?: string;
    timestamp?: number;       // Unix seconds
}


const inferOperatorFromId = (id?: string | null): string | null => {
    const v = String(id || '');
    if (!v) return null;

    // 1. National GID/NetEx prefixes (9011 or 9031)
    // Map specific authority codes
    if (v.startsWith('9011001') || v.startsWith('9031001')) return 'sl';
    if (v.startsWith('9011003') || v.startsWith('9031003')) return 'ul';
    if (v.startsWith('9011004') || v.startsWith('9031004')) return 'sormland';
    if (v.startsWith('9011005') || v.startsWith('9031005')) return 'otraf';
    if (v.startsWith('9011006') || v.startsWith('9031006')) return 'jlt';
    if (v.startsWith('9011007') || v.startsWith('9031007')) return 'krono';
    if (v.startsWith('9011008') || v.startsWith('9031008')) return 'klt';
    if (v.startsWith('9011009') || v.startsWith('9031009')) return 'gotland';
    if (v.startsWith('9011010') || v.startsWith('9031010')) return 'blekinge';
    if (v.startsWith('9011012') || v.startsWith('9031012')) return 'skane';
    if (v.startsWith('9011013') || v.startsWith('9031013')) return 'halland';
    if (v.startsWith('9011014') || v.startsWith('9031014')) return 'vasttrafik';
    if (v.startsWith('9011017') || v.startsWith('9031017')) return 'varm';
    if (v.startsWith('9011018') || v.startsWith('9031018')) return 'orebro';
    if (v.startsWith('9011019') || v.startsWith('9031019')) return 'vastmanland';
    if (v.startsWith('9011020') || v.startsWith('9031020')) return 'dt';
    if (v.startsWith('9011021') || v.startsWith('9031021')) return 'xt';
    if (v.startsWith('9011022') || v.startsWith('9031022')) return 'dintur';
    if (v.startsWith('9011023') || v.startsWith('9031023')) return 'jamtland';
    if (v.startsWith('9011024') || v.startsWith('9031024')) return 'vasterbotten';
    if (v.startsWith('9011025') || v.startsWith('9031025')) return 'norrbotten';

    // 2. Specific Authority Prefixes (Older or Proprietary)
    if (v.startsWith('1082') || v.startsWith('1065')) return 'sl';
    if (v.startsWith('9024')) return 'skane';
    if (v.startsWith('9025')) return 'vasttrafik';
    if (v.startsWith('9027') || v.startsWith('18118')) return 'orebro';
    if (v.startsWith('9013')) return 'vastmanland';
    if (v.startsWith('9021')) return 'otraf';
    if (v.startsWith('9012')) return 'ul';
    if (v.startsWith('9023')) return 'dt';
    if (v.startsWith('9022')) return 'varm';
    if (v.startsWith('9016')) return 'sormland';
    if (v.startsWith('9032')) return 'krono';
    if (v.startsWith('9020')) return 'jlt';
    if (v.startsWith('9019')) return 'klt';
    if (v.startsWith('9026') || v.startsWith('9018')) return 'halland';
    if (v.startsWith('9017')) return 'blekinge';
    if (v.startsWith('9014')) return 'xt';

    // 3. Last fallback
    if (v.startsWith('9011') || v.startsWith('9031')) return v.substring(4, 7).endsWith('001') ? 'sl' : null;

    return null;
}

const getRegionalOperator = (lat: number, lng: number): string => {
    // Priority order: Small/dense regions first, large/overlapping regions later

    // Stockholm (SL) - expanded bounds
    if (lat >= 58.7 && lat <= 60.3 && lng >= 17.0 && lng <= 19.5) return 'sl';

    // Skåne (Skånetrafiken)
    if (lat >= 55.2 && lat <= 56.5 && lng >= 12.4 && lng <= 14.6) return 'skane';

    // Västtrafik (Västra Götaland / Göteborg)
    if (lat >= 57.0 && lat <= 59.0 && lng >= 11.0 && lng <= 13.5) return 'vasttrafik';

    // Halland - dedicated check
    if (lat >= 56.3 && lat <= 57.6 && lng >= 11.8 && lng <= 13.5) return 'halland';

    // Uppsala (UL)
    if (lat >= 59.2 && lat <= 60.7 && lng >= 16.9 && lng <= 18.2) return 'ul';

    // Örebro Län - Expanded to include Karlskoga and Lindesberg
    if (lat >= 58.6 && lat <= 60.2 && lng >= 14.1 && lng <= 15.9) return 'orebro';

    // Västmanland (VL) - Expanded
    if (lat >= 59.1 && lat <= 60.3 && lng >= 15.4 && lng <= 17.5) return 'vastmanland';

    // Värmland
    if (lat >= 59.0 && lat <= 61.0 && lng >= 12.0 && lng <= 14.3) return 'varm';

    // Östergötland (Östgötatrafiken)
    if (lat >= 57.7 && lat <= 58.9 && lng >= 14.5 && lng <= 16.9) return 'otraf';

    // Jönköping (JLT)
    if (lat >= 57.1 && lat <= 58.2 && lng >= 13.5 && lng <= 15.6) return 'jlt';

    // Kronoberg
    if (lat >= 56.4 && lat <= 57.2 && lng >= 13.5 && lng <= 15.6) return 'krono';

    // Kalmar (KLT)
    if (lat >= 56.2 && lat <= 58.0 && lng >= 15.5 && lng <= 17.2) return 'klt';

    // Dalarna (Dalatrafik)
    if (lat >= 60.0 && lat <= 62.3 && lng >= 13.0 && lng <= 16.8) return 'dt';

    // Gävleborg (X-trafik)
    if (lat >= 60.2 && lat <= 62.3 && lng >= 16.0 && lng <= 17.8) return 'xt';

    // Sörmland
    if (lat >= 58.6 && lat <= 59.6 && lng >= 15.8 && lng <= 17.6) return 'sormland';

    // Blekinge
    if (lat >= 56.0 && lat <= 56.5 && lng >= 14.5 && lng <= 16.0) return 'blekinge';

    // Västernorrland (Din Tur)
    if (lat >= 62.0 && lat <= 64.0 && lng >= 16.0 && lng <= 19.5) return 'dintur';

    // Jämtland
    if (lat >= 61.5 && lat <= 65.0 && lng >= 12.0 && lng <= 16.0) return 'jamtland';

    // Västerbotten
    if (lat >= 63.5 && lat <= 65.5 && lng >= 15.0 && lng <= 21.0) return 'vasterbotten';

    // Norrbotten
    if (lat >= 65.0 && lat <= 69.1 && lng >= 16.0 && lng <= 24.2) return 'norrbotten';

    // Gotland
    if (lat >= 56.8 && lat <= 58.0 && lng >= 18.0 && lng <= 19.5) return 'gotland';

    return 'sl';
};

const inferVehicleType = (
    _effectiveOperator: string,
    routeId?: string,
    line?: string,
    _speedKmh?: number,  // Speed is NOT a reliable mode indicator – buses do 95+ km/h on highways
    _vehicleId?: string
): string => {
    const text = `${routeId || ''} ${line || ''}`.toLowerCase();
    // Only use explicit text patterns in routeId/line text – never speed, never generic prefixes
    // NOTE: 9031 is used by ALL Skånetrafiken vehicles (buses AND trains), so don't use it as a mode signal
    if (/\b(train|rail|tåg|tag|pendel)\b/.test(text)) return 'TRAIN';
    if (/\b(ferry|boat|båt|bat|färja|fartyg)\b/.test(text)) return 'FERRY';
    if (/\b(tram|spårvagn|spår|spar|lightrail)\b/.test(text)) return 'TRAM';
    if (/\b(metro|subway|tunnelbana|tub)\b/.test(text)) return 'METRO';
    // Rely on GTFS static route_type (resolved later by GtfsShapeService) for accurate mode detection
    return 'BUS';
};

type VehicleBBox = { minLat: number, minLng: number, maxLat: number, maxLng: number };

type OperatorBounds = {
    id: string;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
};

const SWEDEN_OPERATOR_FEEDS = [
    'sl', 'ul', 'otraf', 'jlt', 'krono', 'klt', 'gotland',
    'skane', 'vasttrafik', 'varm', 'orebro', 'vastmanland', 'dt', 'xt',
    'dintur', 'halland', 'blekinge', 'sormland', 'jamtland',
    'vasterbotten', 'norrbotten'
];

const REGIONAL_OPERATOR_BOUNDS: OperatorBounds[] = [
    { id: 'sl', minLat: 58.7, maxLat: 60.3, minLng: 17.0, maxLng: 19.5 },
    { id: 'skane', minLat: 55.2, maxLat: 56.5, minLng: 12.4, maxLng: 14.6 },
    { id: 'vasttrafik', minLat: 57.0, maxLat: 59.0, minLng: 11.0, maxLng: 13.5 },
    { id: 'halland', minLat: 56.3, maxLat: 57.6, minLng: 11.8, maxLng: 13.5 },
    { id: 'ul', minLat: 59.2, maxLat: 60.7, minLng: 16.9, maxLng: 18.2 },
    { id: 'orebro', minLat: 58.6, maxLat: 60.2, minLng: 14.1, maxLng: 15.9 },
    { id: 'vastmanland', minLat: 59.1, maxLat: 60.3, minLng: 15.4, maxLng: 17.5 },
    { id: 'varm', minLat: 59.0, maxLat: 61.0, minLng: 12.0, maxLng: 14.3 },
    { id: 'otraf', minLat: 57.7, maxLat: 58.9, minLng: 14.5, maxLng: 16.9 },
    { id: 'jlt', minLat: 57.1, maxLat: 58.2, minLng: 13.5, maxLng: 15.6 },
    { id: 'krono', minLat: 56.4, maxLat: 57.2, minLng: 13.5, maxLng: 15.6 },
    { id: 'klt', minLat: 56.2, maxLat: 58.0, minLng: 15.5, maxLng: 17.2 },
    { id: 'dt', minLat: 60.0, maxLat: 62.3, minLng: 13.0, maxLng: 16.8 },
    { id: 'xt', minLat: 60.2, maxLat: 62.3, minLng: 16.0, maxLng: 17.8 },
    { id: 'sormland', minLat: 58.6, maxLat: 59.6, minLng: 15.8, maxLng: 17.6 },
    { id: 'blekinge', minLat: 56.0, maxLat: 56.5, minLng: 14.5, maxLng: 16.0 },
    { id: 'dintur', minLat: 62.0, maxLat: 64.0, minLng: 16.0, maxLng: 19.5 },
    { id: 'jamtland', minLat: 61.5, maxLat: 65.0, minLng: 12.0, maxLng: 16.0 },
    { id: 'vasterbotten', minLat: 63.5, maxLat: 65.5, minLng: 15.0, maxLng: 21.0 },
    { id: 'norrbotten', minLat: 65.0, maxLat: 69.1, minLng: 16.0, maxLng: 24.2 },
    { id: 'gotland', minLat: 56.8, maxLat: 58.0, minLng: 18.0, maxLng: 19.5 },
];

const normalizeText = (v?: string | null): string => String(v || '').trim();

/** Örebro stadsbuss har 1-siffriga linjer (1–9). Ta bort ledande noll: "03" → "3", "09" → "9". "34"/"103" oförändrade. */
const normalizeLineForDisplay = (s: string): string => {
    const v = String(s).trim();
    if (!v || v === '?') return v;
    if (/^\d+$/.test(v)) return v.replace(/^0+/, '') || '0';
    if (/^\d+[A-Z]$/i.test(v)) return v.replace(/^\d+/, (m) => m.replace(/^0+/, '') || '0') + v.slice(-1);
    return v;
};

const looksLikeLineCode = (value?: string | null): boolean => {
    const v = normalizeText(value);
    if (!v) return false;
    // Pure numeric: 1-4 digits (e.g. 4, 12, 100, 160, 800) — valid Swedish line codes
    if (/^\d{1,4}$/.test(v)) return true;
    // Numeric with ONE trailing letter (e.g. "14A", "3X", "100B")
    if (/^\d{1,4}[A-Z]$/i.test(v)) return true;
    // Alphanumeric starting with 1-3 letters then 1-4 digits (e.g. "E20", "T14", "RE10")
    if (/^[A-Z]{1,3}\d{1,4}[A-Z]?$/i.test(v)) return true;
    // Pure letter codes (e.g. "RED", "BLÅ") — max 6 letters
    if (/^[A-ZÅÄÖ]{1,6}$/i.test(v)) return true;
    return false;
};

/** Linjenummer från routeId/tripId/vehicleLabel/vehicleId. Gemensam logik för alla län. */
const pickLineDisplay = (routeId?: string, vehicleLabel?: string, tripId?: string, operatorId?: string, vehicleId?: string): string => {
    const rid = normalizeText(routeId);
    const label = normalizeText(vehicleLabel);
    const tid = normalizeText(tripId);
    const vid = normalizeText(vehicleId);

    const op = normalizeText(operatorId).toLowerCase();

    // 1) GTFS Sweden 3 Static – en källa för linje (och destination). Använd för alla inkl. Örebro.
    const gtfsLine = GtfsSwedenStaticService.getLineSync(tid || undefined, rid || undefined);
    if (gtfsLine && looksLikeLineCode(gtfsLine)) return normalizeLineForDisplay(gtfsLine);

    // 2) ÖREBRO: Stadsbussen har 1-siffriga linjer (1–9). Endast feed/static, ingen tryFromId. route_id, trip_id, vehicle.id.
    if (op === 'orebro') {
        const orebroLineFromId = (id: string): string | null => {
            if (!id || id.length < 12) return null;
            if ((/^9011018\d+$/.test(id) || /^9031018\d+$/.test(id))) {
                const c = id.substring(8, 12).replace(/^0+/, '');
                return c && looksLikeLineCode(c) ? c : null;
            }
            if (/^18118\d+$/.test(id)) {
                const c = id.substring(8, 12).replace(/^0+/, '');
                return c && looksLikeLineCode(c) ? c : null;
            }
            return null;
        };
        const c = (rid && orebroLineFromId(rid)) || (tid && orebroLineFromId(tid)) || (vid && orebroLineFromId(vid));
        if (c) return normalizeLineForDisplay(c);
        return '?';
    }

    // 3) NeTEx (GtfsShapeService) – hoppa över för Örebro
    try {
        if (op && op !== 'orebro' && (GtfsShapeService as any).isLoaded && (GtfsShapeService as any).isLoaded(op)) {
            const info = (GtfsShapeService as any).getLineInfo(op, tid || undefined, rid || undefined) as { line: string } | null;
            if (info?.line && looksLikeLineCode(info.line)) {
                return info.line;
            }
        }
    } catch {
        /* fallback */
    }

    // 3) Övrig operatörsspecifik extraktion (Örebro redan hanterat ovan)
    // JLT trip_id 66100000082292707 – linjenummer finns INTE i fast position, visa "?" istället för felaktig "82"
    if (op === 'jlt' && tid && /^661\d+$/.test(tid) && !rid) {
        return '?';
    }

    const tryFromId = (id: string): string | null => {
        if (!id) return null;
        // Långa numeriska ID:n (svenskt NeTEx): position 7–11 = linjekod
        // Undvik enkeltsiffror 2–9 – ofta fel extraktion (riktning, sekvens)
        if (/^\d{10,22}$/.test(id)) {
            const offsets: [number, number][] = [[7, 11], [8, 12], [6, 10], [4, 8]];
            for (const [s, e] of offsets) {
                if (id.length < e) continue;
                const c = id.substring(s, e).replace(/^0+/, '');
                if (!c || !looksLikeLineCode(c) || /^\d{5,}$/.test(c)) continue;
                if (/^[2-9]$/.test(c)) continue; // Enkeltsiffror 2–9 = nästan alltid fel
                return c;
            }
        }
        if (id.includes(':')) {
            const parts = id.split(':');
            const i = parts.findIndex(p => p.toLowerCase() === 'line');
            if (i >= 0 && parts[i + 1]) {
                const c = parts[i + 1].replace(/^0+/, '');
                if (c && looksLikeLineCode(c)) return c;
            }
            const last = parts[parts.length - 1].replace(/^0+/, '');
            if (last && looksLikeLineCode(last) && !/^\d{5,}$/.test(last)) return last;
        }
        if (/[_-]/.test(id)) {
            for (const p of id.split(/[_-]+/)) {
                const c = p.replace(/^0+/, '');
                if (c && looksLikeLineCode(c) && !/^\d{5,}$/.test(c)) return c;
            }
        }
        return null;
    };

    const fromRoute = rid ? tryFromId(rid) : null;
    if (fromRoute) return fromRoute;
    const fromTrip = tid ? tryFromId(tid) : null;
    if (fromTrip) return fromTrip;

    // vehicleLabel: lita inte på 1–2 siffror (ofta fordon/depå-kod, inte linje)
    if (label && looksLikeLineCode(label) && !/^\d{5,}$/.test(label)) {
        if (label.length >= 3 || /[A-Za-z]/.test(label)) return label;
        if (label.length <= 2 && /^\d+$/.test(label) && !rid && !tid) return label;
    }
    if (rid && looksLikeLineCode(rid) && !/^\d{5,}$/.test(rid)) return rid;
    if (rid && !/^\d{13,}$/.test(rid)) {
        const m = rid.match(/(?:^|[^0-9])(\d{1,4})(?:[^0-9]|$)/);
        if (m && m[1] !== '0') return m[1];
    }
    if (label && /^[1-9]$/.test(label)) return label;
    return '?';
};

const intersects = (bbox: VehicleBBox, bounds: OperatorBounds, margin = 0.2): boolean => {
    const minLat = bounds.minLat - margin;
    const maxLat = bounds.maxLat + margin;
    const minLng = bounds.minLng - margin;
    const maxLng = bounds.maxLng + margin;
    return !(bbox.maxLat < minLat || bbox.minLat > maxLat || bbox.maxLng < minLng || bbox.minLng > maxLng);
};

const getOperatorsForBbox = (bbox?: VehicleBBox): string[] => {
    if (!bbox) return [...SWEDEN_OPERATOR_FEEDS];
    const byIntersect = REGIONAL_OPERATOR_BOUNDS.filter(b => intersects(bbox, b)).map(b => b.id);
    if (byIntersect.length > 0) return Array.from(new Set(byIntersect));

    const lat = (bbox.minLat + bbox.maxLat) / 2;
    const lng = (bbox.minLng + bbox.maxLng) / 2;
    return [getRegionalOperator(lat, lng)];
};

// GTFS Sweden 3 använder "vt" för Västtrafik, regional använder "vasttrafik"
const toSweden3Operator = (op: string): string => (op === 'vasttrafik' ? 'vt' : op);

const buildRealtimeUrl = (path: string, key: string): string => {
    const ts = Date.now();
    const full = path + (path.includes('?') ? '&' : '?') + 'key=' + key + '&_t=' + ts;
    if (import.meta.env.DEV) return '/trafiklab-proxy/' + full;
    return 'https://opendata.samtrafiken.se/' + full;
};

/** Hämtar VehiclePositions – provar flera nycklar vid 403/429 (kvot slut). */
const fetchVehicleFeed = async (operatorId: string): Promise<Response> => {
    const keys = getRealtimeKeys();
    const headers: HeadersInit = { Accept: 'application/octet-stream,application/x-protobuf,*/*' };
    let lastRes: Response | null = null;
    for (const key of keys) {
        const isRegional = key === API_KEYS.TRAFIKLAB_API_KEY;
        const path = isRegional
            ? 'gtfs-rt/' + operatorId + '/VehiclePositions.pb'
            : 'gtfs-rt-sweden/' + toSweden3Operator(operatorId) + '/VehiclePositionsSweden.pb';
        const url = buildRealtimeUrl(path, key);
        console.log('[Trafiklab] Fetching PBF from: ' + url.slice(0, 80) + '...');
        const res = import.meta.env.DEV ? await fetch(url, { headers }) : await fetchWithCors(url, { headers });
        lastRes = res;
        if (res.ok) return res;
        if (res.status === 403 || res.status === 429) {
            console.warn('[Trafiklab] Key quota exceeded (' + res.status + '), trying next key');
            continue;
        }
        return res;
    }
    return lastRes || new Response(null, { status: 503, statusText: 'No key available' });
};

const decodeFeed = async (res: Response): Promise<any | null> => {
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    try {
        const uint8 = new Uint8Array(buffer);
        return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(uint8);
    } catch (decodeErr) {
        console.error('[Trafiklab] Failed to decode GTFS PBF data:', decodeErr);
        return null;
    }
};

const parseVehicleEntities = (
    entities: any[],
    sourceOperatorId: string,
    requestedOperatorId: string,
    bbox?: VehicleBBox
): VehiclePosition[] => {
    const vehicles: VehiclePosition[] = [];

    entities.forEach((entity: any) => {
        const v = entity.vehicle;
        if (!v || !v.position) return;

        const pos = v.position;
        const lat = pos.latitude;
        const lng = pos.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') return;

        if (bbox && (lat < bbox.minLat || lat > bbox.maxLat || lng < bbox.minLng || lng > bbox.maxLng)) {
            return;
        }

        const trip = v.trip || {};
        const tripId = trip.tripId ?? trip.trip_id ?? undefined;
        const routeId = trip.routeId ?? trip.route_id ?? undefined;
        // Destination: GTFS-RT kan skicka tripHeadsign (camelCase) eller trip_headsign (snake_case)
        const tripHeadsign = trip.tripHeadsign ?? trip.trip_headsign ?? undefined;
        const vehicleLabel = v.vehicle?.label ?? undefined;
        const vehicleId = v.vehicle?.id || entity.id;

        // NEW: Fill missing tripId from TripUpdates cache if available
        let finalTripId = tripId;
        if (!finalTripId && vehicleId && sourceOperatorId !== 'sweden') {
            const cacheKey = `tu_${sourceOperatorId}`;
            const tuCache = (tripUpdateCache as any)[cacheKey]?.data;
            if (tuCache) {
                const match = tuCache.find((m: any) => m.vehicleId === vehicleId);
                if (match) finalTripId = match.tripId;
            }
        }

        const statusEnum = v.currentStatus;
        let currentStatus: string | undefined;
        if (statusEnum === 0) currentStatus = 'INCOMING_AT';
        else if (statusEnum === 1) currentStatus = 'STOPPED_AT';
        else if (statusEnum === 2) currentStatus = 'IN_TRANSIT_TO';

        const occEnum = v.occupancyStatus;
        let occupancyStatus: string | undefined;
        if (occEnum === 0) occupancyStatus = 'EMPTY';
        else if (occEnum === 1) occupancyStatus = 'MANY_SEATS_AVAILABLE';
        else if (occEnum === 2) occupancyStatus = 'FEW_SEATS_AVAILABLE';
        else if (occEnum === 3) occupancyStatus = 'STANDING_ROOM_ONLY';
        else if (occEnum === 4) occupancyStatus = 'CRUSHED_STANDING_ROOM_ONLY';
        else if (occEnum === 5) occupancyStatus = 'FULL';
        else if (occEnum === 6) occupancyStatus = 'NOT_ACCEPTING_PASSENGERS';

        let effectiveOperator = sourceOperatorId;
        if (sourceOperatorId === 'sweden') {
            const idOp = inferOperatorFromId(tripId) || inferOperatorFromId(routeId) || inferOperatorFromId(vehicleId);
            if (idOp) {
                effectiveOperator = idOp;
            } else {
                effectiveOperator = getRegionalOperator(lat, lng);
            }

            const rawId = vehicleLabel || String(vehicleId || '').replace(/^(tl-|vt-|veh-)/, '');
            if ((jltVehicles as any)[rawId]) effectiveOperator = 'jlt';
            if ((slVehicles as any)[rawId]) effectiveOperator = 'sl';
            if ((skaneVehicles as any)[rawId]) effectiveOperator = 'skane';
        }

        let line = pickLineDisplay(routeId, vehicleLabel, finalTripId, effectiveOperator, vehicleId);
        line = normalizeLineForDisplay(line);

        // Debug: log vehicles med olösta linjer
        if (line === '?' && (routeId || tripId)) {
            console.debug(`[pickLine ?] routeId=${routeId} label=${vehicleLabel} tripId=${tripId} op=${effectiveOperator}`);
        }

        vehicles.push({
            id: vehicleId,
            line: String(line),
            direction: tripHeadsign ?? undefined,
            dest: (tripHeadsign && !/^(?:\?|ej linjesatt|linjesatt)$/i.test(String(tripHeadsign).trim())) ? tripHeadsign : undefined,
            lat,
            lng,
            bearing: pos.bearing ?? 0,
            speed: pos.speed != null ? Math.round(pos.speed * 3.6) : undefined,
            type: inferVehicleType(
                effectiveOperator,
                routeId,
                String(line),
                pos.speed != null ? Math.round(pos.speed * 3.6) : undefined,
                String(vehicleId)
            ),
            operator: effectiveOperator,
            tripId: finalTripId,
            routeId,
            vehicleLabel,
            currentStatus,
            stopId: v.stopId ?? undefined,
            stopSequence: v.currentStopSequence ?? undefined,
            occupancyStatus,
            timestamp: v.timestamp != null ? Number(v.timestamp) : undefined,
        });
    });

    if (requestedOperatorId === 'sweden') {
        console.log('[Trafiklab] Parsed ' + vehicles.length + ' vehicles for feed ' + sourceOperatorId);
        // Debug JLT
        const jltVehs = vehicles.filter(v => v.operator === 'jlt').slice(0, 3);
        if (jltVehs.length) {
            console.log('[Trafiklab] Sample JLT:', jltVehs.map(v => ({ id: v.id, tripId: v.tripId, line: v.line })));
        }
    }
    return vehicles;
};

const dedupeVehicles = (vehicles: VehiclePosition[]): VehiclePosition[] => {
    const seen = new Set<string>();
    const out: VehiclePosition[] = [];

    for (const v of vehicles) {
        const key = [v.id, v.tripId || '', v.routeId || '', v.operator || ''].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
    }
    return out;
};

const fetchSingleOperatorVehicles = async (
    operatorId: string,
    requestedOperatorId: string,
    bbox?: VehicleBBox
): Promise<VehiclePosition[]> => {
    try {
        const res = await fetchVehicleFeed(operatorId);
        if (!res.ok) {
            console.error('[Trafiklab] Fetch failed for ' + operatorId + ': ' + res.status + ' ' + res.statusText);
            return [];
        }

        const data = await decodeFeed(res);
        const entities = data?.entity || [];
        if (!entities.length) return [];

        return parseVehicleEntities(entities, operatorId, requestedOperatorId, bbox);
    } catch (e) {
        console.error('[Trafiklab] Error fetching GTFS-RT positions for ' + operatorId + ':', e);
        return [];
    }
};

export const TrafiklabService = {
    getLiveVehicles: async (operatorId: string = 'sweden', bbox?: { minLat: number, minLng: number, maxLat: number, maxLng: number }): Promise<VehiclePosition[]> => {
        if (getRealtimeKeys().length === 0) {
            console.warn("No Trafiklab realtime API key configured (TRAFIKLAB_SWEDEN3_REALTIME_KEY or TRAFIKLAB_API_KEY)");
            return [];
        }

        if (operatorId === 'sweden') {
            const candidates = getOperatorsForBbox(bbox);
            console.log('[Trafiklab] Sweden mode using ' + candidates.length + ' regional feeds: ' + candidates.join(', '));

            const BATCH_SIZE = 4;
            const all: VehiclePosition[] = [];
            for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
                const batch = candidates.slice(i, i + BATCH_SIZE);
                const chunk = await Promise.all(
                    batch.map(op => fetchSingleOperatorVehicles(op, operatorId, bbox))
                );
                chunk.forEach(list => all.push(...list));
            }

            const deduped = dedupeVehicles(all);
            console.log('[Trafiklab] Returning ' + deduped.length + ' vehicles in sweden mode');
            return deduped;
        }

        // Proactively refresh TripUpdates in background for regional operators
        // to help fill missing tripId -> line mapping in VehiclePositions
        if (operatorId !== 'sweden' && operatorId !== 'entur') {
            const cacheKey = `tu_${operatorId}`;
            const stale = !tripUpdateCache[cacheKey] || (Date.now() - tripUpdateCache[cacheKey].ts > 60000);
            if (stale) {
                // Fire and forget
                TrafiklabService.getTripUpdate(operatorId, 'sync-only').catch(() => { });
            }
        }

        const vehicles = await fetchSingleOperatorVehicles(operatorId, operatorId, bbox);
        console.log('[Trafiklab] Returning ' + vehicles.length + ' vehicles for ' + operatorId);
        return vehicles;
    },

    /**
     * Fetch TripUpdates for an operator and find the matching trip.
     * Returns delay (seconds) and next stop info.
     * Cached per operator for 30s to avoid burning API quota.
     */
    getTripUpdate: async (operatorId: string, tripId: string): Promise<{ delay: number | null; nextStopId: string | null; nextStopSequence: number | null; lastStopId: string | null } | null> => {
        const keys = getRealtimeKeys();
        if (!tripId || keys.length === 0) return null;

        const cacheKey = `tu_${operatorId}`;
        const now = Date.now();

        // Check cache (30s TTL)
        if (tripUpdateCache[cacheKey] && now - tripUpdateCache[cacheKey].ts < 30000) {
            const cached = tripUpdateCache[cacheKey].data;
            const match = cached.find((e: any) => e.tripId === tripId);
            return match ? { ...match, lastStopId: match.lastStopId ?? null } : null;
        }

        try {
            const keys = getRealtimeKeys();
            let res: Response | null = null;
            for (const key of keys) {
                const isRegional = key === API_KEYS.TRAFIKLAB_API_KEY;
                const op = isRegional ? operatorId : toSweden3Operator(operatorId);
                const path = isRegional ? 'gtfs-rt/' + operatorId + '/TripUpdates.pb' : 'gtfs-rt-sweden/' + op + '/TripUpdatesSweden.pb';
                const url = buildRealtimeUrl(path, key);
                res = await fetch(url, { headers: { Accept: 'application/octet-stream,application/x-protobuf,*/*' } });
                if (res.ok) break;
                if (res.status === 403 || res.status === 429) {
                    console.warn('[Trafiklab] TripUpdates key quota exceeded (' + res.status + '), trying next key');
                    continue;
                }
                return null;
            }
            if (!res || !res.ok) return null;

            const data = await decodeFeed(res);
            const entities = data?.entity || [];

            // Parse all trip updates into a lightweight array (incl. lastStopId + tripHeadsign for destination)
            const tripHeadsign = (t: any) => t?.tripHeadsign ?? t?.trip_headsign ?? null;
            const updates = entities.map((entity: any) => {
                const tu = entity.tripUpdate;
                if (!tu?.trip?.tripId) return null;
                let stops = tu.stopTimeUpdate || [];
                const seq = (s: any) => s?.stopSequence ?? 0;
                stops = [...stops].sort((a, b) => seq(a) - seq(b));
                const firstStop = stops[0];
                const lastStop = stops.length > 0 ? stops[stops.length - 1] : null;
                const lastStopId = lastStop?.stopId ?? lastStop?.stop_id ?? null;
                return {
                    tripId: tu.trip.tripId,
                    vehicleId: tu.vehicle?.id || null,
                    delay: firstStop?.arrival?.delay ?? firstStop?.departure?.delay ?? tu.delay ?? null,
                    nextStopId: firstStop?.stopId ?? firstStop?.stop_id ?? null,
                    nextStopSequence: firstStop?.stopSequence ?? null,
                    lastStopId,
                    tripHeadsign: tripHeadsign(tu.trip) || null,
                };
            }).filter(Boolean);

            // Cache
            tripUpdateCache[cacheKey] = { ts: now, data: updates };

            const match = updates.find((e: any) => e.tripId === tripId);
            return match || null;
        } catch (e) {
            console.warn('[Trafiklab] TripUpdates fetch failed for ' + operatorId, e);
            return null;
        }
    },

    /** Sync: return lastStopId for a trip from TripUpdates cache (for destination resolution). */
    getTripLastStopIdFromCache: (operatorId: string, tripId: string): string | null => {
        const cacheKey = `tu_${operatorId}`;
        const entry = tripUpdateCache[cacheKey];
        if (!entry || !tripId) return null;
        const match = entry.data.find((e: any) => e.tripId === tripId);
        return match?.lastStopId ?? null;
    },

    /** Sync: return cached TripUpdates for an operator (for resolveDestination + delay on markers). */
    getTripUpdatesCache: (operatorId: string): { tripId: string; lastStopId: string | null; tripHeadsign: string | null; delay: number | null }[] => {
        const cacheKey = `tu_${operatorId}`;
        const entry = tripUpdateCache[cacheKey];
        if (!entry?.data) return [];
        return entry.data.map((e: any) => ({
            tripId: e.tripId,
            lastStopId: e.lastStopId ?? null,
            tripHeadsign: e.tripHeadsign ?? null,
            delay: e.delay != null ? e.delay : null,
        }));
    },

    getDepartures: async (stopId: string): Promise<any[]> => {
        if (!API_KEYS.RESROBOT_API_KEY) {
            console.warn("Missing RESROBOT_API_KEY");
            return [];
        }

        const url = `${API_URLS.RESROBOT_API}/departureBoard?id=${stopId}&format=json&accessId=${API_KEYS.RESROBOT_API_KEY}&passlist=0`;

        try {
            console.log(`[Resrobot] Fetching departures for stop ${stopId}`);
            let res;

            // Handle Proxy/CORS
            if (import.meta.env.DEV) {
                res = await fetch(url);
            } else {
                // In production, use corsproxy if needed, or direct if allowed. 
                // Using fetchWithCors helper defined above.
                // Reconstruct full URL for proxy if using API_URLS.RESROBOT_API which might be relative?
                // API_URLS.RESROBOT_API is absolute in prod.
                res = await fetchWithCors(url);
            }

            if (!res.ok) {
                console.error(`[Resrobot] Fetch failed: ${res.status}`);
                return [];
            }

            const data = await res.json();
            const departures = data.Departure || [];

            return departures.map((dep: any) => {
                // Extract Line Number
                // 'name' often contains "Länstrafik - 101" or "Buss 101". 
                // Product.num is usually more direct e.g. "101".
                let line = dep.name;
                if (dep.Product && dep.Product.num) {
                    line = dep.Product.num;
                } else if (dep.Product && Array.isArray(dep.Product) && dep.Product[0]?.num) {
                    line = dep.Product[0].num;
                } else {
                    // Fallback regex to get number from "Buss 101"
                    const match = dep.name.match(/(\d+)$/);
                    if (match) line = match[1];
                }

                return {
                    line: line,
                    destination: dep.direction,
                    time: dep.time.substring(0, 5), // Ensure HH:MM
                    rtTime: dep.rtTime ? dep.rtTime.substring(0, 5) : null,
                    date: dep.date,
                    track: dep.track || null,
                    journeyRef: dep.JourneyDetailRef?.ref || null,
                    // Additional helpful fields
                    formattedTime: dep.rtTime || dep.time, // For sorting/display logic
                    isLate: dep.rtTime && dep.rtTime !== dep.time,
                    type: dep.ProductAtStop?.cls || 'BUS' // Class: B=Bus, etc.
                };
            });

        } catch (error) {
            console.error("[Resrobot] Error fetching departures:", error);
            return [];
        }
    },

    getJourneyDetails: async (journeyRef: string): Promise<any> => {
        if (!API_KEYS.RESROBOT_API_KEY) {
            console.warn("Missing RESROBOT_API_KEY");
            return null;
        }

        // Handle URL encoding for the ref if needed, though usually it's passed as is or already encoded.
        // Resrobot refs can be long strings.
        const url = `${API_URLS.RESROBOT_API}/journeyDetail?ref=${encodeURIComponent(journeyRef)}&format=json&accessId=${API_KEYS.RESROBOT_API_KEY}`;

        try {
            console.log(`[Resrobot] Fetching journey details for ref: ${journeyRef}`);
            let res;

            if (import.meta.env.DEV) {
                res = await fetch(url);
            } else {
                res = await fetchWithCors(url);
            }

            if (!res.ok) {
                console.error(`[Resrobot] Fetch failed: ${res.status}`);
                return null;
            }

            const data = await res.json();
            const stops = data.JourneyDetail?.Stop || [];

            return {
                stops: stops.map((stop: any) => ({
                    id: stop.id,
                    name: stop.name,
                    arrTime: stop.arrTime ? stop.arrTime.substring(0, 5) : null,
                    depTime: stop.depTime ? stop.depTime.substring(0, 5) : null,
                    rtArrTime: stop.rtArrTime ? stop.rtArrTime.substring(0, 5) : null,
                    rtDepTime: stop.rtDepTime ? stop.rtDepTime.substring(0, 5) : null,
                    track: stop.track,
                    routeIdx: stop.routeIdx
                }))
            };

        } catch (error) {
            console.error("[Resrobot] Error fetching journey details:", error);
            return null;
        }
    }
};


