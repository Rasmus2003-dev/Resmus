/**
 * GTFS Destination Resolution – Trafiklab static data
 * Laddar trips.txt, stop_times.txt, stops.txt från sweden.zip.
 * Prioritet: realtime headsign → trips.trip_headsign → stop_times sista stopp → stops.txt → route_fallback.
 */

import { getStaticKeys } from './config';

const IDB_NAME = 'gtfs-destination-index';
const IDB_STORE = 'cache';
const CACHE_KEY = 'indexes';
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 timmar

export type GtfsIndexes = {
  ts: number;
  /** trip_id -> { route_id, trip_headsign?, direction_id? } */
  trips: Record<string, { route_id: string; trip_headsign?: string; direction_id?: string }>;
  /** trip_id -> last stop_id (sista stoppet i tripen) */
  lastStopByTrip: Record<string, string>;
  /** stop_id -> stop_name */
  stops: Record<string, string>;
  /** route_id -> [trip_id] (för route_fallback) */
  tripsByRoute: Record<string, string[]>;
};

let memoryCache: GtfsIndexes | null = null;
let loadPromise: Promise<GtfsIndexes | null> | null = null;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<GtfsIndexes | null> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(CACHE_KEY);
      req.onsuccess = () => resolve((req.result as GtfsIndexes) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(data: GtfsIndexes): Promise<void> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data, CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let end = line.indexOf('"', i + 1);
      if (end === -1) end = line.length;
      out.push(line.slice(i + 1, end).replace(/""/g, '"'));
      i = end + 1;
      if (line[i] === ',') i++;
    } else {
      const comma = line.indexOf(',', i);
      const val = (comma === -1 ? line.slice(i) : line.slice(i, comma)).trim();
      out.push(val);
      i = comma === -1 ? line.length : comma + 1;
    }
  }
  return out;
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => parseCsvLine(l));
  return { header, rows };
}

function normalizeId(id: string): string {
  const t = id.trim();
  if (t.includes(':')) return t.split(':').pop() ?? t;
  return t;
}

/** Laddar och cachar static GTFS-index (trips, stop_times, stops) från Trafiklab sweden.zip. */
export async function loadGtfsIndexes(): Promise<GtfsIndexes | null> {
  if (memoryCache && Date.now() - memoryCache.ts < CACHE_TTL_MS) return memoryCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = await idbGet();
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      memoryCache = cached;
      return cached;
    }

    const keys = getStaticKeys();
    if (keys.length === 0) {
      console.warn('[GTFS Destination] No static API key configured');
      return null;
    }

    let res: Response | null = null;
    let lastStatus = 0;
    const base = 'https://opendata.samtrafiken.se/';
    for (const key of keys) {
      const path = `gtfs-sweden/sweden.zip?key=${key}`;
      const url = import.meta.env.DEV
        ? `/trafiklab-proxy/${path}`
        : `https://corsproxy.io/?${encodeURIComponent(base + path)}`;
      res = await fetch(url);
      lastStatus = res.status;
      if (res.ok) break;
      if (res.status === 403 || res.status === 429) {
        console.warn('[GTFS Destination] Key quota exceeded (', res.status, '), trying next key');
        continue;
      }
      console.error('[GTFS Destination] Fetch failed', res.status, res.statusText);
      return null;
    }
    if (!res || !res.ok) {
      console.error('[GTFS Destination] All keys failed (last status', lastStatus, ')');
      return null;
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1000) {
      console.error('[GTFS Destination] Response too small', buf.byteLength);
      return null;
    }

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);

    const findFile = (suffix: string) => {
      const n = names.find((x) => x.toLowerCase().endsWith(suffix));
      return n ? zip.file(n) : zip.file(suffix);
    };

    const tripsFile = findFile('trips.txt');
    const stopTimesFile = findFile('stop_times.txt');
    const stopsFile = findFile('stops.txt');

    if (!tripsFile || !stopTimesFile || !stopsFile) {
      console.error('[GTFS Destination] Missing trips/stop_times/stops. Files:', names.slice(0, 25));
      return null;
    }

    const [tripsText, stopTimesText, stopsText] = await Promise.all([
      tripsFile.async('text'),
      stopTimesFile.async('text'),
      stopsFile.async('text'),
    ]);

    const tripsCsv = parseCsv(tripsText);
    const stopTimesCsv = parseCsv(stopTimesText);
    const stopsCsv = parseCsv(stopsText);

    const tripIdIdx = tripsCsv.header.indexOf('trip_id');
    const routeIdIdx = tripsCsv.header.indexOf('route_id');
    const tripHeadsignIdx = tripsCsv.header.indexOf('trip_headsign');
    const directionIdIdx = tripsCsv.header.indexOf('direction_id');

    const stTripIdIdx = stopTimesCsv.header.indexOf('trip_id');
    const stStopIdIdx = stopTimesCsv.header.indexOf('stop_id');
    const stSeqIdx = stopTimesCsv.header.indexOf('stop_sequence');

    const stopIdIdx = stopsCsv.header.indexOf('stop_id');
    const stopNameIdx = stopsCsv.header.indexOf('stop_name');

    if (
      tripIdIdx === -1 ||
      routeIdIdx === -1 ||
      stTripIdIdx === -1 ||
      stStopIdIdx === -1 ||
      stSeqIdx === -1 ||
      stopIdIdx === -1 ||
      stopNameIdx === -1
    ) {
      console.error('[GTFS Destination] Missing columns. trips:', tripsCsv.header, 'stop_times:', stopTimesCsv.header?.slice(0, 8), 'stops:', stopsCsv.header?.slice(0, 5));
      return null;
    }

    const trips: GtfsIndexes['trips'] = {};
    const tripsByRoute: Record<string, string[]> = {};

    for (const row of tripsCsv.rows) {
      if (row.length <= Math.max(tripIdIdx, routeIdIdx)) continue;
      const tid = row[tripIdIdx]?.trim();
      const rid = row[routeIdIdx]?.trim();
      if (!tid || !rid) continue;
      const trip_headsign = tripHeadsignIdx >= 0 ? row[tripHeadsignIdx]?.trim() : undefined;
      const direction_id = directionIdIdx >= 0 ? row[directionIdIdx]?.trim() : undefined;
      trips[tid] = { route_id: rid, trip_headsign: trip_headsign || undefined, direction_id: direction_id || undefined };
      if (tid.includes(':')) trips[normalizeId(tid)] = trips[tid];
      if (!tripsByRoute[rid]) tripsByRoute[rid] = [];
      tripsByRoute[rid].push(tid);
      if (rid.includes(':')) {
        const rn = normalizeId(rid);
        if (!tripsByRoute[rn]) tripsByRoute[rn] = [];
        tripsByRoute[rn].push(tid);
      }
    }
    for (const r of Object.keys(tripsByRoute)) {
      if (/^\d{10,}$/.test(r)) {
        for (const len of [14, 12, 10, 8]) {
          if (r.length >= len) {
            const key = r.slice(-len);
            if (!tripsByRoute[key]) tripsByRoute[key] = tripsByRoute[r];
          }
        }
      }
    }

    const stopTimesByTrip: Record<string, { stop_id: string; stop_sequence: number }[]> = {};
    for (const row of stopTimesCsv.rows) {
      if (row.length <= Math.max(stTripIdIdx, stStopIdIdx, stSeqIdx)) continue;
      const tid = row[stTripIdIdx]?.trim();
      const stopId = row[stStopIdIdx]?.trim();
      const seq = parseInt(row[stSeqIdx] ?? '0', 10);
      if (!tid || !stopId) continue;
      if (!stopTimesByTrip[tid]) stopTimesByTrip[tid] = [];
      stopTimesByTrip[tid].push({ stop_id: stopId, stop_sequence: seq });
    }

    for (const tid of Object.keys(stopTimesByTrip)) {
      stopTimesByTrip[tid].sort((a, b) => a.stop_sequence - b.stop_sequence);
    }

    const lastStopByTrip: Record<string, string> = {};
    for (const [tid, arr] of Object.entries(stopTimesByTrip)) {
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        lastStopByTrip[tid] = last.stop_id;
        if (tid.includes(':')) lastStopByTrip[normalizeId(tid)] = last.stop_id;
      }
    }

    const stops: Record<string, string> = {};
    for (const row of stopsCsv.rows) {
      if (row.length <= Math.max(stopIdIdx, stopNameIdx)) continue;
      const sid = row[stopIdIdx]?.trim();
      const name = row[stopNameIdx]?.trim();
      if (!sid) continue;
      stops[sid] = name || sid;
      if (sid.includes(':')) stops[normalizeId(sid)] = name || sid;
    }

    const data: GtfsIndexes = {
      ts: Date.now(),
      trips,
      lastStopByTrip,
      stops,
      tripsByRoute,
    };

    await idbSet(data);
    memoryCache = data;
    console.log(
      '[GTFS Destination] Loaded',
      Object.keys(trips).length,
      'trips,',
      Object.keys(lastStopByTrip).length,
      'with last stop,',
      Object.keys(stops).length,
      'stops'
    );
    return data;
  })();

  const result = await loadPromise;
  loadPromise = null;
  return result;
}

/** Hjälp: hitta värde i record med id eller numeriskt suffix (för match mot GTFS static). */
function lookupByTripId<T>(record: Record<string, T> | undefined, tripId: string): T | undefined {
  if (!record) return undefined;
  const tid = normalizeId(tripId);
  let v = record[tid] ?? record[tripId];
  if (v !== undefined) return v;
  if (/^\d{10,}$/.test(tripId)) {
    for (const len of [18, 16, 15, 14, 12, 10, 8]) {
      if (tripId.length >= len) { v = record[tripId.slice(-len)]; if (v !== undefined) return v; }
    }
  }
  return undefined;
}

/** Returnerar sista hållplatsens namn för en trip_id. */
export function getLastStopName(tripId: string | undefined | null, indexes: GtfsIndexes | null): string | null {
  if (!tripId || !indexes) return null;
  const lastStopId = lookupByTripId(indexes.lastStopByTrip, tripId);
  if (!lastStopId) return null;
  const name = indexes.stops[lastStopId] ?? indexes.stops[normalizeId(lastStopId)];
  return name || null;
}

export type TripUpdateEntry = {
  tripId: string;
  lastStopId: string | null;
  tripHeadsign: string | null;
};

function isValidHeadsign(s: string | null | undefined): boolean {
  if (s == null || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t === '?' || /^(ej linjesatt|linjesatt|okänd|unknown)$/i.test(t)) return false;
  return true;
}

export type ResolveDestinationResult = { destination: string; source: string };

/**
 * Obligatorisk destination-resolution. Returnerar alltid ett visningsbart värde (minst "Linje X okänd destination").
 * Loggar exakt källa: realtime.headsign | trips.trip_headsign | stop_times_last_stop | route_fallback.
 */
export function resolveDestination(
  vehicle: {
    id?: string;
    tripId?: string;
    routeId?: string;
    dest?: string;
    direction?: string;
    line?: string;
  },
  tripUpdates: TripUpdateEntry[] | null,
  gtfsIndexes: GtfsIndexes | null,
  displayLine: string | null
): ResolveDestinationResult {
  const vid = vehicle.id ?? vehicle.tripId ?? '?';
  const lineFallback = displayLine && displayLine !== '?' ? `Linje ${displayLine} okänd destination` : 'Okänd destination';

  const log = (source: string, value: string) => {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[Destination]', source, { vehicleId: vid, tripId: vehicle.tripId, value });
    }
  };

  // 1. Realtime headsign från VehiclePosition (trip.tripHeadsign)
  const realtimeHeadsign = vehicle.dest ?? vehicle.direction;
  if (isValidHeadsign(realtimeHeadsign)) {
    log('realtime.headsign', realtimeHeadsign!);
    return { destination: realtimeHeadsign!.trim(), source: 'realtime.headsign' };
  }

  // 2. TripUpdate för denna trip (om feed innehåller trip_headsign)
  const tid = vehicle.tripId ? normalizeId(vehicle.tripId) : null;
  if (tid && tripUpdates?.length) {
    const tu = tripUpdates.find((e) => normalizeId(e.tripId) === tid || e.tripId === vehicle.tripId);
    if (tu?.tripHeadsign && isValidHeadsign(tu.tripHeadsign)) {
      log('realtime.headsign', tu.tripHeadsign);
      return { destination: tu.tripHeadsign.trim(), source: 'realtime.headsign' };
    }
    if (tu?.lastStopId && gtfsIndexes?.stops) {
      const name = gtfsIndexes.stops[tu.lastStopId] ?? gtfsIndexes.stops[normalizeId(tu.lastStopId)];
      if (name && name.trim()) {
        log('stop_times_last_stop (TripUpdate)', name);
        return { destination: name.trim(), source: 'stop_times_last_stop' };
      }
    }
  }

  // 3. Static GTFS trips.txt – trip_headsign (match även med numeriskt suffix)
  if (tid && gtfsIndexes?.trips) {
    const t = lookupByTripId(gtfsIndexes.trips, tid) ?? lookupByTripId(gtfsIndexes.trips, vehicle.tripId ?? '');
    if (t?.trip_headsign && isValidHeadsign(t.trip_headsign)) {
      log('trips.trip_headsign', t.trip_headsign);
      return { destination: t.trip_headsign.trim(), source: 'trips.trip_headsign' };
    }
  }

  // 4. Static GTFS stop_times + stops – sista stoppet
  const lastStopName = getLastStopName(vehicle.tripId ?? undefined, gtfsIndexes);
  if (lastStopName && lastStopName.trim()) {
    log('stop_times_last_stop', lastStopName);
    return { destination: lastStopName.trim(), source: 'stop_times_last_stop' };
  }

  // 5. trip_id saknas men route_id finns – hitta någon trip för route_id (match även med suffix), använd dess headsign eller sista stopp
  const rid = vehicle.routeId ? normalizeId(vehicle.routeId) : null;
  let tripIds: string[] | undefined = rid && gtfsIndexes?.tripsByRoute ? gtfsIndexes.tripsByRoute[rid] : undefined;
  if (!tripIds && rid && /^\d{10,}$/.test(rid)) {
    for (const len of [14, 12, 10, 8]) {
      if (rid.length >= len) { tripIds = gtfsIndexes?.tripsByRoute?.[rid.slice(-len)]; if (tripIds) break; }
    }
  }
  if (rid && tripIds && gtfsIndexes) {
    for (const tid2 of tripIds.slice(0, 50)) {
      const t = gtfsIndexes.trips[tid2];
      if (t?.trip_headsign && isValidHeadsign(t.trip_headsign)) {
        log('route_fallback (headsign)', t.trip_headsign);
        return { destination: t.trip_headsign.trim(), source: 'route_fallback' };
      }
    }
    for (const tid2 of tripIds.slice(0, 50)) {
      const name = getLastStopName(tid2, gtfsIndexes);
      if (name && name.trim()) {
        log('route_fallback (last stop)', name);
        return { destination: name.trim(), source: 'route_fallback' };
      }
    }
  }

  // 6. Endast fallback – linjenamn + okänd destination
  log('route_fallback', lineFallback);
  return { destination: lineFallback, source: 'route_fallback' };
}

/** Synkron tillgång till cache (efter loadGtfsIndexes). */
export function getGtfsIndexesSync(): GtfsIndexes | null {
  return memoryCache;
}

/**
 * Tvingande destination: samma kedja som resolveDestination men returnerar endast strängen.
 * Använd när destination är tom, "—" eller "Ej angiven hållplats".
 * Ordning: realtime headsign → trips.txt → sista stopp (stop_times + stops) → route-baserad trip → "okänd destination".
 */
export function resolveDestinationStrict(
  vehicle: {
    id?: string;
    tripId?: string;
    routeId?: string;
    dest?: string;
    direction?: string;
    line?: string;
  },
  tripUpdates: TripUpdateEntry[] | null,
  gtfsIndexes: GtfsIndexes | null,
  displayLine: string | null
): string {
  const result = resolveDestination(vehicle, tripUpdates, gtfsIndexes, displayLine);
  return result.destination;
}

/** Returnerar true om destination inte får visas – visa då "Linje X" istället. */
export function isForbiddenDestination(d: string | null | undefined): boolean {
  if (d == null) return true;
  const t = String(d).trim();
  if (t === '') return true;
  if (t === '—' || t === '–') return true;
  if (/^ej\s+angiven\s+hållplats$/i.test(t)) return true;
  if (/okänd\s+destination/i.test(t)) return true;
  return false;
}

export const GtfsDestinationService = {
  loadGtfsIndexes,
  getLastStopName,
  resolveDestination,
  resolveDestinationStrict,
  isForbiddenDestination,
  getGtfsIndexesSync,
};
