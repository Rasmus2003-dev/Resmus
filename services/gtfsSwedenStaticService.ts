/**
 * GTFS Sweden 3 Static – linjeuppslag för alla län
 * Laddar sweden.zip max 1 gång per 23h, cachar i IndexedDB.
 * Sparar API-nyckel: ~1 request/dag ≈ 30/månad (kvot 50).
 */

import { getStaticKeys } from './config';

const IDB_NAME = 'gtfs-sweden-3-static';
const IDB_STORE = 'cache';
const CACHE_KEY = 'lookup';
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 timmar

type LookupCache = {
  ts: number;
  tripToLine: Record<string, string>;
  routeToLine: Record<string, string>;
};

let memoryCache: LookupCache | null = null;
let loadPromise: Promise<LookupCache | null> | null = null;
const onLoadedCallbacks: Array<() => void> = [];

export function onGtfsSwedenStaticLoaded(cb: () => void): void {
  onLoadedCallbacks.push(cb);
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<LookupCache | null> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(CACHE_KEY);
      req.onsuccess = () => resolve((req.result as LookupCache) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(data: LookupCache): Promise<void> {
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

/** Enkel CSV-rad: hanterar fält i citationstecken */
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

async function fetchAndParse(): Promise<LookupCache | null> {
  const keys = getStaticKeys();
  if (keys.length === 0) {
    console.warn('[GTFS Sweden 3 Static] No static API key configured');
    return null;
  }

  let res: Response | null = null;
  let lastStatus = 0;
  for (const key of keys) {
    const path = `gtfs-sweden/sweden.zip?key=${key}`;
    const url = import.meta.env.DEV
      ? `/trafiklab-proxy/${path}`
      : `https://corsproxy.io/?${encodeURIComponent('https://opendata.samtrafiken.se/' + path)}`;
    res = await fetch(url);
    lastStatus = res.status;
    if (res.ok) break;
    if (res.status === 403 || res.status === 429) {
      console.warn('[GTFS Sweden 3 Static] Key quota exceeded (', res.status, '), trying next key');
      continue;
    }
    console.error('[GTFS Sweden 3 Static] Fetch failed', res.status, res.statusText);
    return null;
  }
  if (!res || !res.ok) {
    console.error('[GTFS Sweden 3 Static] All keys failed (last status', lastStatus, ')');
    return null;
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1000) {
    console.error('[GTFS Sweden 3 Static] Response too small', buf.byteLength);
    return null;
  }

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);

  const names = Object.keys(zip.files);
  const routeName = names.find((n) => n.toLowerCase().endsWith('routes.txt'));
  const tripName = names.find((n) => n.toLowerCase().endsWith('trips.txt'));
  const routeFile = routeName ? zip.file(routeName) : zip.file('routes.txt');
  const tripFile = tripName ? zip.file(tripName) : zip.file('trips.txt');

  if (!routeFile || !tripFile) {
    console.error('[GTFS Sweden 3 Static] routes.txt or trips.txt missing. Files:', names.slice(0, 20));
    return null;
  }

  const routesText = await routeFile.async('text');
  const tripsText = await tripFile.async('text');

  const routeCsv = parseCsv(routesText);
  const tripCsv = parseCsv(tripsText);

  const routeIdIdx = routeCsv.header.indexOf('route_id');
  const shortNameIdx = routeCsv.header.indexOf('route_short_name');
  const tripRouteIdIdx = tripCsv.header.indexOf('route_id');
  const tripIdIdx = tripCsv.header.indexOf('trip_id');

  if (routeIdIdx === -1 || shortNameIdx === -1 || tripRouteIdIdx === -1 || tripIdIdx === -1) {
    console.error('[GTFS Sweden 3 Static] Missing columns. routes:', routeCsv.header?.slice(0, 8), 'trips:', tripCsv.header?.slice(0, 8));
    return null;
  }

  const routeToLine: Record<string, string> = {};
  for (const row of routeCsv.rows) {
    if (row.length > Math.max(routeIdIdx, shortNameIdx)) {
      const rid = row[routeIdIdx]?.trim();
      const line = row[shortNameIdx]?.trim();
      if (rid && line) {
        routeToLine[rid] = line;
        if (rid.includes(':')) routeToLine[rid.split(':').pop()!] = line;
        if (/^\d{8,}$/.test(rid)) {
          for (const len of [14, 12, 10, 8]) { if (rid.length >= len) routeToLine[rid.slice(-len)] = line; }
        }
      }
    }
  }

  const tripToLine: Record<string, string> = {};
  for (const row of tripCsv.rows) {
    if (row.length > Math.max(tripIdIdx, tripRouteIdIdx)) {
      const tid = row[tripIdIdx]?.trim();
      const rid = row[tripRouteIdIdx]?.trim();
      if (tid && rid && routeToLine[rid]) {
        const line = routeToLine[rid];
        tripToLine[tid] = line;
        if (tid.includes(':')) tripToLine[tid.split(':').pop()!] = line;
        if (/^\d{8,}$/.test(tid)) {
          for (const len of [18, 16, 14, 12, 10, 8]) { if (tid.length >= len) tripToLine[tid.slice(-len)] = line; }
        }
      }
    }
  }

  const data: LookupCache = {
    ts: Date.now(),
    tripToLine,
    routeToLine,
  };

  await idbSet(data);
  console.log('[GTFS Sweden 3 Static] Loaded', Object.keys(tripToLine).length, 'trips,', Object.keys(routeToLine).length, 'routes');
  memoryCache = data;
  onLoadedCallbacks.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.warn('[GTFS Sweden 3 Static] onLoaded callback error', e);
    }
  });
  return data;
}

async function ensureLoaded(): Promise<LookupCache | null> {
  if (memoryCache && Date.now() - memoryCache.ts < CACHE_TTL_MS) return memoryCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = await idbGet();
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      memoryCache = cached;
      onLoadedCallbacks.forEach((cb) => {
        try { cb(); } catch (e) { console.warn('[GTFS Sweden 3 Static] onLoaded callback error', e); }
      });
      return cached;
    }
    const fresh = await fetchAndParse();
    if (fresh) memoryCache = fresh;
    return fresh;
  })();

  const result = await loadPromise;
  loadPromise = null;
  return result;
}

/**
 * Returnerar linjenummer för trip_id och/eller route_id.
 * Anropa ensureLoaded() en gång (t.ex. vid app-start eller första kartladdning).
 */
export async function getLineFromGtfsSwedenStatic(tripId?: string | null, routeId?: string | null): Promise<string | null> {
  const cache = await ensureLoaded();
  if (!cache) return null;
  if (tripId && cache.tripToLine[tripId]) return cache.tripToLine[tripId];
  if (routeId && cache.routeToLine[routeId]) return cache.routeToLine[routeId];
  return null;
}

/** Hjälp: matcha även om static har prefix/suffix (t.ex. SE:661:ServiceJourney:661...). Numeriska id:n matchas även med suffix. */
function lookupLine(cache: LookupCache, tripId?: string | null, routeId?: string | null): string | null {
  if (tripId) {
    let t = cache.tripToLine[tripId] ?? (tripId.includes(':') ? cache.tripToLine[tripId.split(':').pop()!] : undefined);
    if (t) return t;
    if (/^\d{10,}$/.test(tripId)) {
      for (const len of [18, 16, 14, 12, 10, 8]) {
        if (tripId.length >= len) { t = cache.tripToLine[tripId.slice(-len)]; if (t) return t; }
      }
    }
  }
    if (routeId) {
    let r = cache.routeToLine[routeId] ?? (routeId.includes(':') ? cache.routeToLine[routeId.split(':').pop()!] : undefined);
    if (r) return r;
    if (/^\d{10,}$/.test(routeId)) {
      for (const len of [14, 12, 10, 8]) {
        if (routeId.length >= len) { r = cache.routeToLine[routeId.slice(-len)]; if (r) return r; }
      }
    }
  }
  return null;
}

/**
 * Synkron lookup om cachen redan finns i minnet (efter ensureLoaded).
 */
export function getLineFromGtfsSwedenStaticSync(tripId?: string | null, routeId?: string | null): string | null {
  if (!memoryCache) return null;
  return lookupLine(memoryCache, tripId, routeId);
}

/**
 * Starta bakgrundsladdning (sparar nyckel – bara 1 request per 23h).
 */
export function preload(): void {
  ensureLoaded().catch(() => {});
}

export const GtfsSwedenStaticService = {
  getLine: getLineFromGtfsSwedenStatic,
  getLineSync: getLineFromGtfsSwedenStaticSync,
  preload,
  ensureLoaded,
  onGtfsSwedenStaticLoaded,
};
