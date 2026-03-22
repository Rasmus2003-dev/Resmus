import { Departure, Provider, Station, Journey, TripLeg, JourneyDetail } from '../types';
import { API_KEYS, API_URLS } from './config';

const fetchWithCors = async (url: string, retries = 3) => {
    // If using local proxy (starts with /), fetch directly.
    let proxyUrl = "";
    if (url.startsWith('/')) {
        const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
        proxyUrl = targetUrl;
    } else {
        const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
        proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(targetUrl);
    }

    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(proxyUrl);

            // 429 Too Many Requests - Wait
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                continue;
            }

            // Success
            if (res.ok) return res;

            // Server Errors - Retry
            if (res.status >= 500) {
                lastError = new Error(`Status ${res.status}`);
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
                continue;
            }

            return res; // Return client errors directly
        } catch (e) {
            lastError = e;
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
        }
    }

    // Fallback if all retries fail
    console.error(`Resrobot Fetch failed after ${retries} attempts`, lastError);
    // Return a mocked error response to avoid crashes downstream
    return new Response(JSON.stringify({ error: 'Network Error' }), { status: 503, statusText: 'Service Unavailable' });
};

export const ResrobotService = {
    searchStations: async (query: string): Promise<Station[]> => {
        if (!query) return [];
        console.log("Resrobot searching for:", query);
        try {
            // Note the extra ? for fuzzy search as per user request
            const url = `${API_URLS.RESROBOT_API}/location.name?input=${encodeURIComponent(query)}&maxNo=50&accessId=${API_KEYS.RESROBOT_API_KEY}&format=json`;
            console.log("Fetching URL:", url);

            const res = await fetchWithCors(url);
            console.log("Response status:", res.status);

            if (!res.ok) {
                console.error("Resrobot fetch failed:", res.statusText);
                return [];
            }
            const data = await res.json();
            console.log("Resrobot data:", JSON.stringify(data));

            if (data.errorCode) {
                console.error("ResRobot API Error:", data.errorCode, data.errorText);
                return [];
            }

            // ResRobot structure handling
            let locations: any[] = [];

            if (data.stopLocationOrCoordLocation && Array.isArray(data.stopLocationOrCoordLocation)) {
                locations = data.stopLocationOrCoordLocation
                    .map((item: any) => item.StopLocation || item.CoordLocation)
                    .filter((item: any) => item);
            }
            else if (Array.isArray(data)) locations = data;
            else if (Array.isArray(data.StopLocation)) locations = data.StopLocation;
            else if (data.StopLocation) locations = [data.StopLocation]; // Single object
            else if (data.LocationList?.StopLocation) {
                locations = Array.isArray(data.LocationList.StopLocation)
                    ? data.LocationList.StopLocation
                    : [data.LocationList.StopLocation];
            }

            return locations.map((item: any) => ({
                id: item.extId || item.id,
                gid: item.extId || item.id,
                name: item.name,
                provider: Provider.RESROBOT,
                coords: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
                favorite: false
            }));
        } catch (e) {
            console.error("Resrobot search error:", e);
            return [];
        }
    },

    getDepartures: async (stationId: string, duration = 60): Promise<Departure[]> => {
        try {
            const url = `${API_URLS.RESROBOT_API}/departureBoard?id=${stationId}&duration=${duration}&accessId=${API_KEYS.RESROBOT_API_KEY}&format=json&maxJourneys=500`;
            const res = await fetchWithCors(url);
            if (!res.ok) return [];
            const data = await res.json();

            if (!data.Departure) return [];

            const departures = Array.isArray(data.Departure) ? data.Departure : [data.Departure];

            return departures.map((item: any) => {
                let transportType: 'BUS' | 'TRAIN' | 'TRAM' | 'FERRY' | 'METRO' | 'UNK' = 'BUS';
                // Product can be object or array
                const product = Array.isArray(item.Product) ? item.Product[0] : item.Product;
                const catCode = product?.catCode;

                if (catCode === '1' || catCode === '2') transportType = 'TRAIN';
                else if (catCode === '4') transportType = 'TRAM';
                else if (catCode === '6') transportType = 'FERRY';
                else if (catCode === '9') transportType = 'METRO';
                else transportType = 'BUS';

                // Clean Destination: Remove city name if it matches station's city
                let direction = item.direction.split('(')[0].trim();
                const stationName = item.stop || "";
                // Heuristic: First word of station is city.
                const city = stationName.split(' ')[0];
                if (city && direction.startsWith(city + " ") && city.length > 2) {
                    direction = direction.substring(city.length + 1);
                }

                // Color Heuristics
                let bgColor = '#475569';
                let fgColor = '#ffffff';

                if (transportType === 'TRAIN') { bgColor = '#f43f5e'; } // Rose
                else if (transportType === 'TRAM') { bgColor = '#0284c7'; } // Sky
                else if (transportType === 'METRO') { bgColor = '#db2777'; } // Pink
                else if (transportType === 'FERRY') { bgColor = '#4f46e5'; } // Indigo
                else if (transportType === 'BUS') {
                    const line = product?.num || "";
                    if (["1","2","3","4","5","6"].includes(line)) bgColor = '#16a34a'; // Local Express
                    else if (line.length >= 3 && line.startsWith('3')) bgColor = '#ea580c'; // Regional
                    else bgColor = '#0ea5e9';
                }

                // User requested to remove generic operator names in the board
                // We keep it undefined so the UI doesn't render the small gray text under the destination.
                let operator = undefined;
                // Exception: If we really want "Pågatågen" etc, we can keep it, but user said "Ta bort".
                // Safest to just hide it completely as requested.

                // Journey Ref
                let journeyRef = item.JourneyDetailRef?.ref;
                if (journeyRef) journeyRef = "resrobot:" + journeyRef;

                return {
                    id: `${item.name}-${item.date}-${item.time}`,
                    line: product?.num || item.name.replace(/\D/g, ''),
                    direction: direction,
                    stopPoint: { name: item.stop, gid: stationId },
                    time: item.time.substring(0, 5),
                    timestamp: `${item.date}T${item.time}`,
                    datetime: `${item.date}T${item.time}`,
                    // Check rtTime and ensure it's formatted HH:MM
                    realtime: item.rtTime ? item.rtTime.substring(0, 5) : null,
                    rtDate: item.rtDate,
                    bgColor: bgColor,
                    fgColor: fgColor,
                    provider: Provider.RESROBOT,
                    type: transportType,
                    // Check both predicted track (rtTrack) and planned track (track)
                    track: item.rtTrack || item.track || '',
                    status: item.rtTime && item.rtTime !== item.time ? 'LATE' : 'ON_TIME',
                    operator: operator,
                    journeyRef: journeyRef,
                    journeyDetailRefUrl: item.JourneyDetailRef?.ref
                };
            });
        } catch (e) {
            console.error("Resrobot departures error:", e);
            return [];
        }
    },

    getJourneyDetails: async (ref: string): Promise<any[]> => {
        if (!ref) return [];
        try {
            let url = ref;

            // Handle if ref is just an ID or partial (not a full URL)
            if (!url.startsWith('http')) {
                // Construct the full URL manually
                url = `${API_URLS.RESROBOT_API}/journeyDetail?ref=${encodeURIComponent(ref)}&accessId=${API_KEYS.RESROBOT_API_KEY}&format=json`;
            } else {
                // It is a URL. Ensure format=json is present (API defaults to XML sometimes)
                if (!url.includes('format=json')) {
                    url += (url.includes('?') ? '&' : '?') + 'format=json';
                }
                // Ensure accessId is present
                if (!url.includes('accessId=')) {
                    url += (url.includes('?') ? '&' : '?') + `accessId=${API_KEYS.RESROBOT_API_KEY}`;
                }
            }

            const res = await fetchWithCors(url);
            if (!res.ok) {
                console.error(`ResRobot JourneyDetails failed: ${res.status}`);
                return [];
            }
            const data = await res.json();

            // ResRobot JourneyDetail structure handling
            const journeyDetail = data.JourneyDetail || data.JourneyLocation || (Array.isArray(data) ? data[0]?.JourneyDetail : null);

            if (!journeyDetail) return [];

            // Sometimes Stops is directly under JourneyDetail
            let stops = journeyDetail.Stops?.Stop;

            if (!stops) return [];

            const list = Array.isArray(stops) ? stops : [stops];

            return list.map((s: any) => {
                const fmt = (t: string | undefined) => t ? t.substring(0, 5) : undefined;

                return {
                    name: s.name,
                    time: (s.depTime || s.arrTime || "").substring(0, 5),
                    arrivalTime: fmt(s.arrTime),
                    departureTime: fmt(s.depTime),
                    realtimeArrival: fmt(s.rtArrTime),
                    realtimeDeparture: fmt(s.rtDepTime),
                    date: s.depDate || s.arrDate,
                    track: s.rtTrack || s.track,
                    isCancelled: s.cancelled,
                    isDeparture: !!s.depTime,
                    coords: (s.lat && s.lon) ? { lat: parseFloat(s.lat), lng: parseFloat(s.lon) } : undefined
                };
            });

        } catch (e) {
            console.error("ResRobot JourneyDetails Error", e);
            return [];
        }
    },

    planTrip: async (originId: string, destId: string, dateTime?: string): Promise<Journey[]> => {
        try {
            let url = `${API_URLS.RESROBOT_API}/trip?originId=${originId}&destId=${destId}&format=json&accessId=${API_KEYS.RESROBOT_API_KEY}&passlist=0`;

            if (dateTime) {
                const parts = dateTime.split('T');
                if (parts.length === 2) {
                    url += `&date=${parts[0]}&time=${parts[1].substring(0, 5)}`;
                }
            }

            console.log('ResRobot PlanTrip URL:', url);
            const res = await fetchWithCors(url);
            if (!res.ok) {
                console.error('ResRobot PlanTrip Error:', res.status);
                return [];
            }
            const data = await res.json();

            if (!data.Trip) return [];

            const trips = Array.isArray(data.Trip) ? data.Trip : [data.Trip];

            return trips.map((trip: any, idx: number) => {
                const legsRaw = trip.LegList.Leg;
                const legsList = Array.isArray(legsRaw) ? legsRaw : [legsRaw];

                const legs: TripLeg[] = legsList.map((leg: any) => {
                    const isWalk = leg.type === 'WALK';

                    let transportType: any = 'BUS';
                    let name = "Gå";
                    let bgColor = '#cbd5e1';
                    let fgColor = '#334155';

                    if (!isWalk) {
                        const product = leg.Product ? (Array.isArray(leg.Product) ? leg.Product[0] : leg.Product) : null;
                        if (product) {
                            if (product.catCode === '1' || product.catCode === '2') transportType = 'TRAIN';
                            else if (product.catCode === '4') transportType = 'TRAM';
                            else if (product.catCode === '5' || product.catCode === '8') transportType = 'BUS';
                            else if (product.catCode === '9') transportType = 'METRO';
                            else if (product.catCode === '6') transportType = 'FERRY';
                            else transportType = 'BUS';

                            name = product.name || leg.name;
                            // Clean up name (e.g., "Bus 123" -> "123")
                            name = name.replace(/Bus |Tram |Tåg |Länstrafik |Expressbuss /gi, '').trim();
                        } else {
                            name = leg.name;
                        }

                        // Assign Colors based on type
                        if (transportType === 'TRAIN') { bgColor = '#fca5a5'; fgColor = '#b91c1c'; } // Reddish for trains
                        else if (transportType === 'TRAM') { bgColor = '#bae6fd'; fgColor = '#0369a1'; } // Blue for trams
                        else if (transportType === 'BUS') { bgColor = '#d9f99d'; fgColor = '#3f6212'; } // Green for bus
                        else if (transportType === 'METRO') { bgColor = '#fbcfe8'; fgColor = '#be185d'; } // Pink
                        else if (transportType === 'FERRY') { bgColor = '#c7d2fe'; fgColor = '#3730a3'; } // Indigo
                    } else {
                        transportType = 'WALK';
                        // dist is in meters
                        if (leg.dist) name = `Gå ${leg.dist}m`;
                    }

                    // Format times (HH:MM)
                    const startTime = leg.Origin.time.substring(0, 5);
                    const endTime = leg.Destination.time.substring(0, 5);

                    // Duration in min
                    const startD = new Date(`${leg.Origin.date}T${leg.Origin.time}`);
                    const endD = new Date(`${leg.Destination.date}T${leg.Destination.time}`);
                    const dur = Math.round((endD.getTime() - startD.getTime()) / 60000);

                    return {
                        type: transportType,
                        name: name,
                        direction: leg.direction || (isWalk ? `Mot ${leg.Destination.name}` : ''),
                        origin: {
                            name: leg.Origin.name,
                            time: startTime,
                            track: leg.Origin.track,
                            date: leg.Origin.date,
                            coords: (leg.Origin.lat && leg.Origin.lon) ? { lat: parseFloat(leg.Origin.lat), lng: parseFloat(leg.Origin.lon) } : undefined
                        },
                        destination: {
                            name: leg.Destination.name,
                            time: endTime,
                            track: leg.Destination.track,
                            date: leg.Destination.date,
                            coords: (leg.Destination.lat && leg.Destination.lon) ? { lat: parseFloat(leg.Destination.lat), lng: parseFloat(leg.Destination.lon) } : undefined
                        },
                        duration: dur,
                        bgColor: bgColor,
                        fgColor: fgColor,
                        distance: leg.dist,
                        cancelled: false, // ResRobot doesn't easily expose this in standard leg
                        messages: leg.Notes?.Note?.map((n: any) => n.value) || [],
                        intermediateStops: [] // requires passlist=1 and parsing
                    } as TripLeg;
                });

                // Calculate total Duration
                const first = legs[0];
                const last = legs[legs.length - 1];
                const totalDur = (new Date(`${last.destination.date}T${last.destination.time}:00`).getTime() - new Date(`${first.origin.date}T${first.origin.time}:00`).getTime()) / 60000;

                return {
                    id: `rr-trip-${idx}-${Date.now()}`,
                    legs: legs,
                    startTime: first.origin.time,
                    endTime: last.destination.time,
                    duration: Math.round(totalDur)
                };
            });

        } catch (e) {
            console.error("ResRobot planTrip error", e);
            return [];
        }
    },

    /** Hämta alla stopp mellan origin och dest (mellanstopp) – används som fallback när t.ex. Trafikverket bara ger start/slut. */
    getTripStops: async (originName: string, destName: string, dateTime: string): Promise<JourneyDetail[]> => {
        if (!originName || !destName) return [];
        try {
            const [origins, dests] = await Promise.all([
                ResrobotService.searchStations(originName),
                ResrobotService.searchStations(destName)
            ]);
            const originId = origins[0]?.id;
            const destId = dests[0]?.id;
            if (!originId || !destId) return [];

            let url = `${API_URLS.RESROBOT_API}/trip?originId=${encodeURIComponent(originId)}&destId=${encodeURIComponent(destId)}&format=json&accessId=${API_KEYS.RESROBOT_API_KEY}&passlist=1&showPassingPoints=true`;
            if (dateTime) {
                const iso = new Date(dateTime);
                const date = iso.toISOString().slice(0, 10);
                const time = iso.toTimeString().slice(0, 5);
                url += `&date=${date}&time=${time}`;
            }

            const res = await fetchWithCors(url);
            if (!res.ok) return [];
            const data = await res.json();
            const trips = data.Trip ? (Array.isArray(data.Trip) ? data.Trip : [data.Trip]) : [];
            const firstTrip = trips[0];
            if (!firstTrip?.LegList?.Leg) return [];

            const legs = Array.isArray(firstTrip.LegList.Leg) ? firstTrip.LegList.Leg : [firstTrip.LegList.Leg];
            const trainLeg = legs.find((leg: any) => leg.type !== 'WALK' && (leg.Product?.catCode === '1' || leg.Product?.catCode === '2' || !leg.type));
            const leg = trainLeg || legs[0];
            const fmt = (t: string | undefined) => t ? t.substring(0, 5) : undefined;

            const out: JourneyDetail[] = [];
            const add = (name: string, dep?: string, arr?: string, track?: string) => {
                out.push({
                    name,
                    time: fmt(dep) || fmt(arr) || '',
                    departureTime: fmt(dep),
                    arrivalTime: fmt(arr),
                    track
                });
            };

            if (leg.Origin) add(leg.Origin.name, leg.Origin.time, leg.Origin.time, leg.Origin.track);
            const stops = leg.Stops?.Stop ?? leg.PassingPoint ?? leg.stops;
            const stopList = Array.isArray(stops) ? stops : (stops ? [stops] : []);
            stopList.forEach((s: any) => {
                const name = s.name ?? s.Name ?? s.location?.name;
                if (name) add(name, s.depTime ?? s.departureTime, s.arrTime ?? s.arrivalTime, s.track ?? s.rtTrack);
            });
            if (leg.Destination && leg.Origin?.name !== leg.Destination?.name) add(leg.Destination.name, leg.Destination.time, leg.Destination.time, leg.Destination.track);

            return out;
        } catch (e) {
            console.error('ResRobot getTripStops error', e);
            return [];
        }
    }
};
