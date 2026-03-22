
import { API_KEYS, API_URLS } from './config';
import { TrafiklabService } from './trafiklabService';
import { EnturService } from './enturService';

// -- INTERNAL HELPERS --
// Note: These helper functions (fetchWithCors, getVasttrafikToken) are duplicated from transitService.
// Ideally they should be in a shared 'apiUtils.ts' or similar. 
// For now, to respect "Separera helt" (Separate completely), I'll copy the necessary parts or import them if exposed.
// Since getVasttrafikToken is internal in transitService, I'll need to duplicate or refactor.
// To avoid breaking transitService by extensive refactor, I will duplicate the token logic here too.
// or stick to using public APIs where possible. 
// Actually, I can export getVasttrafikToken from transitService? No, it's not exported.
// I will create a robust token fetcher here too.

// ── Smart Caching System (BKT-stil: 5s cache för färre anrop vid pan/zoom) ──
const vehicleCache = new Map<string, { data: any[], timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds – som BKT busmap
const MAX_VEHICLES_PER_REGION = 2000; // Prevent massive data transfers

// ── GPS Validation Helper ──
const isValidGpsCoordinate = (lat: number, lng: number): boolean => {
    // Basic validation: lat -90 to 90, lng -180 to 180
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    // Additional check: ensure it's in Sweden/Nordic region (approximately)
    // This helps filter out completely wrong GPS data
    if (lng < 2 || lng > 35 || lat < 54 || lat > 72) return false;
    return true;
};

// ── Compact Vehicle Data Helper ── 
const compressVehicleData = (vehicle: any): any => {
    // Only keep essential fields for display
    return {
        id: vehicle.id,
        lat: vehicle.lat,
        lng: vehicle.lng,
        bearing: vehicle.bearing ?? 0,
        speed: vehicle.speed ?? 0,
        line: vehicle.line ?? '?',
        dest: vehicle.dest ?? '',
        transportMode: vehicle.transportMode || 'BUS',
        timestamp: vehicle.timestamp ?? (Date.now() / 1000),
        tripId: vehicle.tripId,
        routeId: vehicle.routeId,
        vehicleLabel: vehicle.vehicleLabel,
        operator: vehicle.operator,
        currentStatus: vehicle.currentStatus,
        stopId: vehicle.stopId,
        stopSequence: vehicle.stopSequence,
        occupancyStatus: vehicle.occupancyStatus,
    };
};

const TOKEN_STORAGE_KEY = 'vt_access_token';
let vtToken: string | null = null;
let vtTokenExpiry: number = 0;

const fetchWithCors = async (url: string, options: RequestInit = {}) => {
    // Basic CORS proxy wrapper
    const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(targetUrl);
    return fetch(proxyUrl, options);
};

const getVasttrafikToken = async (): Promise<string | null> => {
    if (vtToken && Date.now() < vtTokenExpiry) return vtToken;

    try {
        const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (stored) {
            const { token, expiry } = JSON.parse(stored);
            if (Date.now() < expiry) {
                vtToken = token;
                vtTokenExpiry = expiry;
                return token;
            }
        }
    } catch (e) { }

    if (!API_KEYS.VASTTRAFIK_AUTH) return null;

    // Retry Logic
    const proxies = [
        (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` // specific fallback for post
    ];

    for (const proxyGen of proxies) {
        try {
            const finalUrl = proxyGen(API_URLS.VASTTRAFIK_TOKEN);
            const res = await fetch(finalUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${API_KEYS.VASTTRAFIK_AUTH.trim()}`
                },
                body: 'grant_type=client_credentials'
            });

            if (res.ok) {
                const data = await res.json();
                if (data.access_token) {
                    vtToken = data.access_token;
                    vtTokenExpiry = Date.now() + (data.expires_in * 1000) - 30000;
                    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token: vtToken, expiry: vtTokenExpiry }));
                    return vtToken;
                }
            }
        } catch (e) { console.warn("MapService Auth Error", e); }
    }
    return null;
};

// -- MAP SERVICE --

export const MapService = {

    /**
     * Get live vehicle positions for the map.
     * Delegates to TrafiklabService for GTFS-RT data, or Entur for Norway.
     */
    getVehiclePositions: async (minLat: number, minLng: number, maxLat: number, maxLng: number, operatorId?: string): Promise<any[]> => {
        // Check cache first
        const cacheKey = `${minLat}|${minLng}|${maxLat}|${maxLng}|${operatorId}`;
        const cached = vehicleCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            return cached.data;
        }

        let tlVehicles: any[] = [];
        if (minLat && minLng && maxLat && maxLng) {
            const op = operatorId || 'sweden';
            if (op === 'entur') {
                tlVehicles = await EnturService.getLiveVehicles({ minLat, maxLat, minLng, maxLng });
                // Entur natively maps to the right structure, no need for the massive remapping below
                vehicleCache.set(cacheKey, { data: tlVehicles, timestamp: Date.now() });
                return tlVehicles;
            } else {
                tlVehicles = await TrafiklabService.getLiveVehicles(op, { minLat, minLng, maxLat, maxLng });
            }
        }

        // Filter and compress vehicle data for Trafiklab
        const tlMapped = tlVehicles
            .filter(v => isValidGpsCoordinate(v.lat, v.lng)) // Validate GPS coordinates
            .slice(0, MAX_VEHICLES_PER_REGION) // Cap to prevent massive datasets
            .map(v => compressVehicleData({
                id: `tl-${v.id}`,
                lat: v.lat,
                lng: v.lng,
                bearing: v.bearing,
                speed: v.speed,
                line: v.line,
                dest: v.dest ?? v.direction ?? '', // trip_headsign från GTFS-RT eller direction
                transportMode: (() => {
                    const t = String(v.type || '').toUpperCase();
                    if (t === 'TRAM' || t === 'TRAIN' || t === 'FERRY' || t === 'METRO') return t;
                    return 'BUS';
                })(),
                detailsReference: null,
                timestamp: v.timestamp ?? (Date.now() / 1000),
                // GTFS-RT trip linkage – pass through for shape resolution
                tripId: v.tripId,
                routeId: v.routeId,
                vehicleLabel: v.vehicleLabel,
                currentStatus: v.currentStatus,
                stopId: v.stopId,
                stopSequence: v.stopSequence,
                occupancyStatus: v.occupancyStatus,
                operator: v.operator,
            }));

        // Cache the result
        vehicleCache.set(cacheKey, { data: tlMapped, timestamp: Date.now() });

        // Clean up old cache entries
        if (vehicleCache.size > 20) {
            const oldestKey = vehicleCache.keys().next().value;
            if (oldestKey !== undefined) {
                vehicleCache.delete(oldestKey);
            }
        }

        return tlMapped;
    },

    /**
     * Get Stops for the map(Västtrafik Geometry Search).
     */
    getMapStopAreas: async (minLat: number, minLng: number, maxLat: number, maxLng: number): Promise<any[]> => {
        const token = await getVasttrafikToken();
        if (!token) return [];
        const fix = (n: number) => n.toFixed(6);
        const wkt = `POLYGON((${fix(minLng)} ${fix(minLat)},${fix(maxLng)} ${fix(minLat)},${fix(maxLng)} ${fix(maxLat)},${fix(minLng)} ${fix(maxLat)},${fix(minLng)} ${fix(minLat)}))`;

        const url = `${API_URLS.VASTTRAFIK_GEO_API}/StopAreas?spatialFilter=${encodeURIComponent(wkt)}&srid=4326&limit=100`;

        try {
            const res = await fetchWithCors(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return [];
            const data = await res.json();

            if (!data || !Array.isArray(data)) return [];

            return data.map((sa: any) => ({
                id: sa.gid,
                name: sa.name,
                lat: sa.geometry?.y, // Y is Latitude
                lng: sa.geometry?.x, // X is Longitude
                municipality: sa.municipality?.name
            })).filter((s: any) => s.lat && s.lng);

        } catch (e) {
            console.error("MapService: Geo Fetch Error", e);
            return [];
        }
    },

    /**
     * Get Parkings (Västtrafik SPP).
     */
    getParkings: async (minLat: number, minLng: number, maxLat: number, maxLng: number): Promise<any[]> => {
        const token = await getVasttrafikToken();
        if (!token) return [];

        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;

        // Radius rough estimation
        const heightDeg = maxLat - minLat;
        const radiusM = Math.ceil((heightDeg * 111000) / 2) + 2000;

        const url = `${API_URLS.VASTTRAFIK_SPP_API}/parkingAreas?latitude=${centerLat}&longitude=${centerLng}&radius=${Math.min(radiusM, 10000)}`;

        try {
            const res = await fetchWithCors(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return [];
            const data = await res.json();

            if (!Array.isArray(data)) return [];

            return data.map((pa: any) => {
                const capacity = pa.parkingCapacity?.total || pa.capacity || '?';
                return {
                    id: pa.id || pa.gid,
                    name: pa.name || "Parkering",
                    lat: pa.location?.latitude,
                    lng: pa.location?.longitude,
                    capacity,
                    cameras: pa.cameras || []
                };
            }).filter(p => p.lat && p.lng);

        } catch (e) {
            console.error("MapService: SPP Parking Error", e);
            return [];
        }
    },

    /**
     * Get Parking Image.
     */
    getParkingImage: async (id: string, camera: number): Promise<string | null> => {
        const token = await getVasttrafikToken();
        if (!token) return null;

        const url = `${API_URLS.VASTTRAFIK_SPP_API}/parkingImages/${id}/${camera}`;

        try {
            const res = await fetchWithCors(url, { headers: { 'Authorization': `Bearer ${token}` } });

            if (!res.ok) {
                // Fallback logic
                const fallbackUrl = `${API_URLS.VASTTRAFIK_SPP_API}/parkingAreas/${id}`;
                const fallbackRes = await fetchWithCors(fallbackUrl, { headers: { 'Authorization': `Bearer ${token}` } });
                if (fallbackRes.ok) {
                    const data = await fallbackRes.json();
                    if (data?.cameras?.[camera - 1]?.imageUrl) {
                        return data.cameras[camera - 1].imageUrl;
                    }
                }
                return null;
            }

            const blob = await res.blob();
            return URL.createObjectURL(blob);

        } catch (e) {
            console.error("MapService: Parking Image Error", e);
            return null;
        }
    },

    /**
     * Get Traffic Disruptions. (Trafikverket API exkluderad – returnerar tom lista.)
     */
    getDisruptions: async (): Promise<any[]> => {
        return [];
    }
};
