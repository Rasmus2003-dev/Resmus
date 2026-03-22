/**
 * NeTEx Regional Static Shape Service  (v3 – fast two-pass)
 * ─────────────────────────────────────────────────────────────────────────────
 * PASS 1  (fast, runs on preload):
 *   • Parses ONLY Line.id → PublicCode/Colour/Mode
 *         and ServiceJourney.id → LineRef
 *   • Result: trip_id → line number in ~5-15 s for SL (545 files)
 *   • Yields to browser every 30 files so UI never freezes
 *
 * PASS 2  (lazy, runs when vehicle is clicked):
 *   • Loads the specific line XML again (already in ZIP memory)
 *   • Extracts stops, coordinates, passing times → drawn route + next stop
 *
 * This means:
 *   – Line badges appear quickly after page load
 *   – Full route line draws on first click (< 1 s from cache)
 */

import { getNetexKeys } from './config';

// ── Public types (identical contract to the old gtfsShapeService) ─────────────

export interface RouteInfo {
    routeId: string;
    shortName: string;
    longName: string;
    color: string;
    textColor: string;
    routeType: number;
}

export interface ShapePolyline {
    shapeId: string;
    coordinates: [number, number][];
}

export interface JourneyStop {
    id: string;
    name: string;
    lat: number;
    lng: number;
    arrivalTime?: string;
    platformCode?: string;
    seq?: number;
}

export interface VehicleRoutePayload {
    routeInfo: RouteInfo | null;
    shape: ShapePolyline | null;
    tripHeadsign: string | null;
    directionId: number | null;
    resolutionNotes: string[];
    nextStopName: string | null;
    nextStopPlatform?: string | null;
    destination: string | null;
    line: string | null;
    journeyStops?: JourneyStop[];
}

// ── Internal types ────────────────────────────────────────────────────────────

interface LineRecord {
    lineId: string;          // full NeTEx id e.g. "SE:001:Line:9011001017000000"
    publicCode: string;      // "17"
    name: string;
    transportMode: string;   // "bus" | "tram" | "metro" | "rail" | "water"
    colour: string;          // "#ec619f"
    textColour: string;
}

interface JourneyMeta {
    numericId: string;       // last ':' segment of NeTEx ServiceJourney id
    lineId: string;          // full NeTEx line id
    headsign: string | null;
    directionId: number;
}

interface DetailedJourney extends JourneyMeta {
    stops: { spijpRef: string; arrivalTime: string; seq: number }[];
}

interface DetailedLine {
    line: LineRecord;
    journeys: Map<string, DetailedJourney>;   // numericId → DetailedJourney
    stops: Map<string, { name: string; lat: number; lng: number }>;
    spijpToStop: Map<string, string>;
    destDisplays: Map<string, string>;
}

// Per-operator fast index (built in Pass 1)
interface OperatorTables {
    // All lines
    lines: Map<string, LineRecord>;             // lineId → LineRecord
    // All journey → line mapping  (numericId → lineId)
    journeyToLine: Map<string, string>;
    // journey meta (headsign, direction)
    journeyMeta: Map<string, JourneyMeta>;
    // Global DestinationDisplay map (id → FrontText) – populated in pre-pass
    // so cross-file references resolve correctly
    destDisplays: Map<string, string>;
    // Detail cache (built lazily in Pass 2)
    detailCache: Map<string, DetailedLine>;     // lineId → DetailedLine
    // JSZip instance kept alive for Pass 2
    zip: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    // filename → lineId (for Pass 2 lookups)
    fileToLineId: Map<string, string>;
    // Fast route lookup index: routeId/routeTail/publicCode -> lineId
    routeToLine: Map<string, string>;
    // Cache for combined lookup keys (tripId+routeId), including misses.
    lookupCache: Map<string, string | null>;
    // Maps JourneyPattern id -> DestinationDisplay id
    jpToDd: Map<string, string>;
}

// ── Module state ──────────────────────────────────────────────────────────────

// operator → OperatorTables (fully indexed after Pass 1)
const cache = new Map<string, OperatorTables>();
// operator → Promise (loading)
const loading = new Map<string, Promise<void>>();
// Re-render callbacks registered by the UI
const onProgressCallbacks: ((op: string) => void)[] = [];

// ── NeTEx operator mapping ────────────────────────────────────────────────────

const toNetExId = (op: string) => op === 'vasttrafik' ? 'vt' : op;

// ── Color helpers ─────────────────────────────────────────────────────────────

function h(c: string) { return c ? (c.startsWith('#') ? c : `#${c}`) : ''; }
function modeToType(m: string): number {
    switch (m) { case 'tram': return 0; case 'metro': return 1; case 'rail': return 2; case 'bus': return 3; case 'water': return 4; default: return 3; }
}

function textForBg(hex: string): string {
    const v = h(hex).replace('#', '');
    if (!v || (v.length !== 3 && v.length !== 6)) return '#ffffff';
    const full = v.length === 3 ? `${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}` : v;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? '#111827' : '#ffffff';
}

function operatorBaseColor(op: string): string {
    const m: Record<string, string> = {
        sl: '#005AA9',
        jlt: '#7C3AED',
        skane: '#4D7C0F',
        ul: '#C5162E',
        otraf: '#0F766E',
        krono: '#EA580C',
        klt: '#DC2626',
        gotland: '#0284C7',
        varm: '#059669',
        orebro: '#2563EB',
        vastmanland: '#0EA5A4',
        dt: '#1D4ED8',
        xt: '#F59E0B',
        dintur: '#F97316',
        halland: '#6D28D9',
        blekinge: '#0EA5E9',
        sormland: '#16A34A',
        jamtland: '#0891B2',
        vasterbotten: '#0F766E',
        norrbotten: '#B45309',
        vasttrafik: '#0079C2',
    };
    return m[op] || '#0EA5E9';
}

function colorForLine(op: string, code: string, mode: string, rawColor: string, rawText: string): { colour: string; textColour: string } {
    const opNorm = (op || '').toLowerCase();
    const colour = h(rawColor);
    const textColour = h(rawText) || (colour ? textForBg(colour) : '#ffffff');

    // Prefer published line colors from NeTEx for every operator.
    if (colour) return { colour, textColour };

    // SL Fallbacks (if NeTEx color is missing)
    if (opNorm === 'sl') {
        if (mode === 'metro') {
            const n = parseInt(code);
            if (n >= 10 && n <= 11) return { colour: '#005AA9', textColour: '#ffffff' }; // Blue line
            if (n >= 13 && n <= 14) return { colour: '#D7162C', textColour: '#ffffff' }; // Red line
            if (n >= 17 && n <= 19) return { colour: '#009F4D', textColour: '#ffffff' }; // Green line
        }
        if (mode === 'rail') {
            // SL Pendeltåg is usually #ec619f or deep blue. NeTEx usually has it.
            // If missing, default to a recognizable dark blue
            return { colour: '#003F87', textColour: '#ffffff' };
        }
    }

    const base = operatorBaseColor(opNorm);
    const baseText = textForBg(base);

    if (opNorm === 'jlt') {
        if (code === '1') return { colour: '#E61C24', textColour: '#ffffff' };
        if (code === '2') return { colour: '#FBB040', textColour: '#000000' };
        if (code === '3') return { colour: '#00A651', textColour: '#ffffff' };
        if (code === '4') return { colour: '#00AEEF', textColour: '#ffffff' };
        const n = parseInt(code, 10); if (!isNaN(n) && n >= 11 && n <= 99) return { colour: '#662D91', textColour: '#ffffff' };
        return { colour: base, textColour: baseText };
    }
    if (opNorm === 'sl') {
        if (mode === 'metro') {
            if (['17', '18', '19'].includes(code)) return { colour: '#008b2b', textColour: '#ffffff' };
            if (['13', '14'].includes(code)) return { colour: '#d71d24', textColour: '#ffffff' };
            if (['10', '11'].includes(code)) return { colour: '#006ab3', textColour: '#ffffff' };
        }
        if (mode === 'rail') return { colour: '#ec619f', textColour: '#ffffff' };
        if (mode === 'tram') {
            if (['22', '30', '31'].includes(code)) return { colour: '#f39200', textColour: '#ffffff' };
            if (['25', '26', '27', '28', '29'].includes(code)) return { colour: '#00a5d5', textColour: '#ffffff' };
            return { colour: '#878a83', textColour: '#ffffff' };
        }
        if (mode === 'water') return { colour: '#46277a', textColour: '#ffffff' };
        if (['1', '2', '3', '4', '6'].includes(code)) return { colour: '#006ab3', textColour: '#ffffff' };
        return { colour: '#d71d24', textColour: '#ffffff' };
    }
    if (opNorm === 'skane') {
        if (mode === 'rail') return { colour: '#7e3089', textColour: '#ffffff' };
        if (mode === 'tram') return { colour: '#80b331', textColour: '#ffffff' };
        const n = parseInt(code, 10);
        return (!isNaN(n) && n >= 100) ? { colour: '#f6c321', textColour: '#000000' } : { colour: '#80b331', textColour: '#ffffff' };
    }

    // Generic mode-aware fallback for all other operators with vehicle positions.
    if (mode === 'rail') return { colour: '#7C3AED', textColour: '#ffffff' };
    if (mode === 'tram') return { colour: '#0D9488', textColour: '#ffffff' };
    if (mode === 'water') return { colour: '#1D4ED8', textColour: '#ffffff' };
    return { colour: base, textColour: baseText };
}

// ── Minimal XML helpers ────────────────────────────────────────────────────────

/** Fast tag attribute extract – no full DOM */
function attr(s: string, a: string): string {
    const i = s.indexOf(`${a}="`); if (i < 0) return '';
    const j = s.indexOf('"', i + a.length + 2); return j < 0 ? '' : s.slice(i + a.length + 2, j);
}

/** Fast inner text of first <tag>…</tag> occurrence */
function txt(s: string, tag: string): string {
    const open = `<${tag}`; const close = `</${tag}>`;
    const i = s.indexOf(open); if (i < 0) return '';
    const gt = s.indexOf('>', i); if (gt < 0) return '';
    const j = s.indexOf(close, gt); if (j < 0) return '';
    return s.slice(gt + 1, j).trim();
}

/** Iterate over non-overlapping <TagName ...> </TagName> blocks */
function* iterBlocks(xml: string, tag: string): Generator<{ attrs: string; inner: string }> {
    const open = `<${tag} `; const close = `</${tag}>`;
    let pos = 0;
    while (true) {
        const i = xml.indexOf(open, pos); if (i < 0) break;
        const gt = xml.indexOf('>', i); if (gt < 0) break;
        const j = xml.indexOf(close, gt); if (j < 0) break;
        yield { attrs: xml.slice(i + open.length, gt), inner: xml.slice(gt + 1, j) };
        pos = j + close.length;
    }
}

function decodeXml(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// ── Yield helper (let browser breathe between batches) ────────────────────────

function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// ── PASS 1: Fast index build ───────────────────────────────────────────────────

/**
 * Scans every XML file in the ZIP and extracts:
 *  • Line id + PublicCode + Colour + TransportMode
 *  • ServiceJourney id → LineRef
 * Yields to main thread every 30 files.
 * Triggers onProgress callbacks after each batch so the map re-renders.
 */
async function pass1(xml: string, op: string, tables: OperatorTables, fileName: string): Promise<void> {
    // Use the GLOBAL destDisplays map so cross-file references work.
    // (Pre-pass in loadOperator already populated all DD entries across all files.)
    const destDisplays = tables.destDisplays;

    // Also collect any DDs in THIS file that weren't caught in pre-pass
    for (const { attrs, inner } of iterBlocks(xml, 'DestinationDisplay')) {
        const id = attr(attrs, 'id');
        const ft = txt(inner, 'FrontText');
        if (id && ft && !destDisplays.has(id)) destDisplays.set(id, decodeXml(ft));
    }

    // ── Lines ──────────────────────────────────────────────────────────────────
    for (const { attrs, inner } of iterBlocks(xml, 'Line')) {
        const lineId = attr(attrs, 'id') || attr(attrs, 'id'); // full NeTEx id
        if (!lineId) continue;
        const pc = decodeXml(txt(inner, 'PublicCode') || txt(inner, 'Name') || '?');
        const name = decodeXml(txt(inner, 'Name') || pc);
        const mode = txt(inner, 'TransportMode') || 'bus';
        const rawC = txt(inner, 'Colour'); const rawT = txt(inner, 'TextColour');
        const { colour, textColour } = colorForLine(op, pc, mode, rawC, rawT);
        tables.lines.set(lineId, { lineId, publicCode: pc, name, transportMode: mode, colour, textColour });
        tables.fileToLineId.set(fileName, lineId);
        const tail = lineId.split(':').pop() || lineId;
        tables.routeToLine.set(lineId, lineId);
        tables.routeToLine.set(tail, lineId);
        if (pc) tables.routeToLine.set(pc, lineId);
    }

    // ── JourneyPatterns (JLT and some others define Destination here) ───────────
    for (const { attrs, inner } of iterBlocks(xml, 'JourneyPattern')) {
        const jpId = attr(attrs, 'id');
        if (!jpId) continue;
        const ddRef = inner.match(/<DestinationDisplayRef[^>]*ref="([^"]+)"/)?.[1] || null;
        if (ddRef) tables.jpToDd.set(jpId, ddRef);
    }

    // ── ServiceJourneys ────────────────────────────────────────────────────────
    for (const { attrs, inner } of iterBlocks(xml, 'ServiceJourney')) {
        const fullId = attr(attrs, 'id'); if (!fullId) continue;
        const parts = fullId.split(':');
        const numId = parts[parts.length - 1];

        // Find which line this journey is on
        const lineRefMatch = inner.match(/<LineRef[^>]*ref="([^"]+)"/);
        let lineId = lineRefMatch ? lineRefMatch[1] : '';
        if (!lineId) lineId = tables.fileToLineId.get(fileName) || '';

        const jpRef = inner.match(/<JourneyPatternRef[^>]*ref="([^"]+)"/)?.[1] || null;
        let ddRef = inner.match(/<DestinationDisplayRef[^>]*ref="([^"]+)"/)?.[1] || null;

        // JLT fallback: DestinationDisplayRef inside JourneyPattern
        if (!ddRef && jpRef) {
            ddRef = tables.jpToDd.get(jpRef) || null;
        }

        // Use GLOBAL destDisplays so cross-file references resolve
        const headsign = ddRef ? (destDisplays.get(ddRef) || null) : null;

        const dirMatch = inner.match(/<DirectionType[^>]*>([^<]+)<\/DirectionType>/);
        const dir = dirMatch ? (dirMatch[1].trim() === 'inbound' ? 1 : 0) : 0;

        tables.journeyToLine.set(fullId, lineId);
        tables.journeyToLine.set(numId, lineId);
        tables.journeyMeta.set(fullId, { numericId: numId, lineId, headsign, directionId: dir });
        tables.journeyMeta.set(numId, { numericId: numId, lineId, headsign, directionId: dir });

        // Suffix indexing for GTFS-RT tripId format compatibility (e.g. Örebro 181180000029025505)
        if (/^\d+$/.test(numId) && numId.length >= 6) {
            for (let cut = 6; cut <= numId.length; cut++) {
                const suffix = numId.slice(numId.length - cut);
                if (!tables.journeyToLine.has(suffix)) {
                    tables.journeyToLine.set(suffix, lineId);
                    tables.journeyMeta.set(suffix, { numericId: numId, lineId, headsign, directionId: dir });
                }
            }
        }
    }
}

// ── PASS 2: Detail extraction (called on vehicle click) ───────────────────────

async function pass2(xml: string, lineId: string): Promise<DetailedLine | null> {
    const line = { lineId, publicCode: '?', name: '', transportMode: 'bus', colour: '#0ea5e9', textColour: '#ffffff' } as LineRecord;
    const journeys = new Map<string, DetailedJourney>();
    const stops = new Map<string, { name: string; lat: number; lng: number }>();
    const spijpToStop = new Map<string, string>();
    const destDisplays = new Map<string, string>();

    // DestinationDisplay
    for (const { attrs, inner } of iterBlocks(xml, 'DestinationDisplay')) {
        const id = attr(attrs, 'id'); const ft = txt(inner, 'FrontText');
        if (id && ft) destDisplays.set(id, decodeXml(ft));
    }

    // ScheduledStopPoint
    for (const { attrs, inner } of iterBlocks(xml, 'ScheduledStopPoint')) {
        const id = attr(attrs, 'id');
        const name = txt(inner, 'Name');
        const lat = parseFloat(txt(inner, 'Latitude'));
        const lng = parseFloat(txt(inner, 'Longitude'));
        if (id && name && !isNaN(lat)) stops.set(id, { name: decodeXml(name), lat, lng });
    }

    // StopPointInJourneyPattern → ScheduledStopPointRef
    const spRe = /<StopPointInJourneyPattern[^>]*id="([^"]+)"[^>]*>[\s\S]{0,800}?<ScheduledStopPointRef[^>]*ref="([^"]+)"/g;
    let sm: RegExpExecArray | null;
    while ((sm = spRe.exec(xml)) !== null) spijpToStop.set(sm[1], sm[2]);

    // ServiceJourney with full passing times
    for (const { attrs, inner } of iterBlocks(xml, 'ServiceJourney')) {
        const fullId = attr(attrs, 'id'); if (!fullId) continue;
        const parts = fullId.split(':'); const numId = parts[parts.length - 1];
        const ddRef = inner.match(/<DestinationDisplayRef[^>]*ref="([^"]+)"/)?.[1] || null;
        const hs = ddRef ? (destDisplays.get(ddRef) || null) : null;
        const dirM = inner.match(/<DirectionType[^>]*>([^<]+)<\/DirectionType>/);
        const dir = dirM ? (dirM[1].trim() === 'inbound' ? 1 : 0) : 0;

        const passStops: { spijpRef: string; arrivalTime: string; seq: number }[] = [];
        let seq = 0;
        for (const { inner: pt } of iterBlocks(inner, 'TimetabledPassingTime')) {
            seq++;
            const spRef = pt.match(/<StopPointInJourneyPatternRef[^>]*ref="([^"]+)"/)?.[1] || '';
            const arr = txt(pt, 'ArrivalTime') || txt(pt, 'DepartureTime') || '';
            passStops.push({ spijpRef: spRef, arrivalTime: arr, seq });
        }
        journeys.set(numId, { numericId: numId, lineId, headsign: hs, directionId: dir, stops: passStops });
    }

    return { line, journeys, stops, spijpToStop, destDisplays };
}

// ── IndexedDB ZIP Cache ────────────────────────────────────────────────────────
// Caches the raw ZIP ArrayBuffer per operator with a 24-hour TTL.
// This avoids re-downloading large files on every page load,
// and prevents hitting Trafiklab rate-limit (HTTP 429).

const IDB_NAME = 'netex-zip-cache-v1';
const IDB_STORE = 'zips';
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

function openIdb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key: string): Promise<{ buf: ArrayBuffer; ts: number } | null> {
    try {
        const db = await openIdb();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

async function idbSet(key: string, buf: ArrayBuffer): Promise<void> {
    try {
        const db = await openIdb();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put({ buf, ts: Date.now() }, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch { /* ignore write errors */ }
}

// ── Main load function ────────────────────────────────────────────────────────

async function loadOperator(operatorId: string): Promise<void> {
    if (cache.has(operatorId)) return;

    const netexOpId = toNetExId(operatorId);
    const keys = getNetexKeys();
    const idbKey = keys.length ? `${netexOpId}-${keys[0].slice(0, 8)}` : netexOpId;

    console.log(`[NeTEx] Loading ${operatorId}...`);

    // Try IndexedDB cache first
    let buf: ArrayBuffer | null = null;
    const cached = await idbGet(idbKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        console.log(`[NeTEx] Using cached ZIP for ${operatorId} (${(cached.buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
        buf = cached.buf;
    }

    // Download if not in cache or stale – prova flera nycklar vid 403/429
    if (!buf && keys.length > 0) {
        let lastStatus = 0;
        for (const key of keys) {
            const proxyUrl = import.meta.env.DEV
                ? `/netex-static-proxy/${netexOpId}/${netexOpId}.zip?key=${key}`
                : `https://corsproxy.io/?${encodeURIComponent(`https://opendata.samtrafiken.se/netex/${netexOpId}/${netexOpId}.zip?key=${key}`)}`;
            console.log(`[NeTEx] Downloading from network: ${operatorId}`);
            try {
                const res = await fetch(proxyUrl);
                lastStatus = res.status;
                if (res.ok) {
                    buf = await res.arrayBuffer();
                    console.log(`[NeTEx] Downloaded ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB for ${operatorId}`);
                    idbSet(idbKey, buf);
                    break;
                }
                if (res.status === 403 || res.status === 429) {
                    console.warn('[NeTEx] Key quota exceeded (' + res.status + '), trying next key');
                    continue;
                }
                console.error(`[NeTEx] HTTP ${res.status} for ${operatorId}`);
                return;
            } catch (e) {
                console.error('[NeTEx] Network error:', e);
                return;
            }
        }
        if (!buf) {
            console.error('[NeTEx] All keys failed (last status ' + lastStatus + ') for ' + operatorId);
            return;
        }
    } else if (!buf) {
        console.warn('[NeTEx] No API key configured');
        return;
    }

    try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buf);

        const tables: OperatorTables = {
            lines: new Map(), journeyToLine: new Map(), journeyMeta: new Map(),
            destDisplays: new Map(), // Global DD map – populated in pre-pass
            detailCache: new Map(), fileToLineId: new Map(), routeToLine: new Map(), lookupCache: new Map(), zip,
            jpToDd: new Map(),
        };

        const fileNames = Object.keys(zip.files).filter(f => f.endsWith('.xml') && !zip.files[f].dir);
        console.log(`[NeTEx] Pass 1: ${fileNames.length} files for ${operatorId}`);

        // ── Pre-pass: collect ALL DestinationDisplays across every file ──────────
        // This ensures cross-file references (SJ in file A → DD in file B) resolve.
        console.log(`[NeTEx] Pre-pass: collecting DestinationDisplays for ${operatorId}...`);
        for (const fileName of fileNames) {
            try {
                const xml = await zip.files[fileName].async('text');
                for (const { attrs, inner } of iterBlocks(xml, 'DestinationDisplay')) {
                    const id = attr(attrs, 'id');
                    const ft = txt(inner, 'FrontText');
                    if (id && ft) tables.destDisplays.set(id, decodeXml(ft));
                }
            } catch { /* skip */ }
        }
        console.log(`[NeTEx] Pre-pass done: ${tables.destDisplays.size} destination displays collected`);
        const BATCH = 30;
        for (let i = 0; i < fileNames.length; i += BATCH) {
            const batch = fileNames.slice(i, i + BATCH);
            for (const fileName of batch) {
                try {
                    const xml = await zip.files[fileName].async('text');
                    await pass1(xml, operatorId, tables, fileName);
                } catch { /* skip bad files */ }
            }
            cache.set(operatorId, tables);
            onProgressCallbacks.forEach(cb => cb(operatorId));
            await yieldToMain();
        }

        cache.set(operatorId, tables);
        onProgressCallbacks.forEach(cb => cb(operatorId));
        console.log(`[NeTEx] Done: ${tables.lines.size} lines, ${tables.journeyToLine.size} journeys for ${operatorId}`);
    } catch (e) {
        console.error('[NeTEx] Parse error:', e);
    }
} // end loadOperator

// ── Trip lookup helpers ────────────────────────────────────────────────────────

function findJourneyLineId(tables: OperatorTables, tripId?: string | null, routeId?: string | null): string | null {
    const cacheKey = `${tripId || ''}|${routeId || ''}`;
    if (tables.lookupCache.has(cacheKey)) return tables.lookupCache.get(cacheKey) || null;

    if (tripId) {
        const direct = tables.journeyToLine.get(tripId);
        if (direct) { tables.lookupCache.set(cacheKey, direct); return direct; }
        // Try extracting trailing numeric segment from compound ids.
        const tail = tripId.split(':').pop() || tripId;
        const tailDirect = tables.journeyToLine.get(tail);
        if (tailDirect) {
            tables.journeyToLine.set(tripId, tailDirect);
            tables.lookupCache.set(cacheKey, tailDirect);
            return tailDirect;
        }
        // Suffix-based lookup (O(1) instead of loops)
        // Örebro: tripId = "181180000029045685" (18 digits), NeTEx numId often = last 8 or full 18
        // Include 18, 16 so we match full GTFS trip_id when NeTEx uses it as ServiceJourney id
        if (tripId.length > 7) {
            const lengths = [18, 16, 12, 10, 8, 7];
            for (const len of lengths) {
                if (tripId.length >= len) {
                    const tail = tripId.slice(-len);
                    const lineIdCandidate = tables.journeyToLine.get(tail);
                    if (lineIdCandidate) {
                        tables.lookupCache.set(cacheKey, lineIdCandidate);
                        return lineIdCandidate;
                    }
                }
            }
        }
    }
    if (routeId) {
        const routeTail = routeId.split(':').pop() || routeId;
        const directRoute = tables.routeToLine.get(routeId) || tables.routeToLine.get(routeTail);
        if (directRoute) {
            tables.lookupCache.set(cacheKey, directRoute);
            return directRoute;
        }

        // Fuzzy match for long numeric route IDs (e.g. 9027170010100000 -> Line 101)
        if (/^\d{10,22}$/.test(routeId)) {
            // Swedish national format: digits 8-11 (index 7 to 11) are the zero-padded line code
            const slices: string[] = [
                routeId.substring(7, 11),
                routeId.length >= 10 ? routeId.substring(6, 10) : '',
                routeId.length >= 8 ? routeId.substring(4, 8) : ''
            ].filter(Boolean);
            for (const raw of slices) {
                const cleaned = raw.replace(/^0+/, '');
                const candidate = tables.routeToLine.get(raw) || tables.routeToLine.get(cleaned);
                if (candidate) {
                    tables.lookupCache.set(cacheKey, candidate);
                    return candidate;
                }
            }
        }

        if (/^\d{10,}$/.test(routeId)) {
            for (const [key, lineId] of tables.routeToLine) {
                if (key.length >= 1 && key.length <= 5) {
                    const padded5 = key.padStart(5, '0');
                    const padded4 = key.padStart(4, '0');
                    if (routeId.includes(padded5) || routeId.includes(padded4) || routeId.includes(key)) {
                        // High confidence match for JLT/Örebro or long train numbers
                        tables.lookupCache.set(cacheKey, lineId);
                        return lineId;
                    }
                }
            }
        }
    }

    tables.lookupCache.set(cacheKey, null);
    if (tripId && tripId.startsWith("661")) {
        console.log("JLT MISMATCH:", tripId, "Available tails:", Array.from(tables.journeyToLine.keys()).slice(0, 10));
    }
    return null;
}

function normalizeTripKey(v?: string | null): string {
    return String(v || '')
        .toLowerCase()
        .replace(/^se:\d+:/, '')
        .replace(/[^a-z0-9]/g, '');
}

function findJourneyMeta(tables: OperatorTables, tripId?: string | null): JourneyMeta | null {
    if (!tripId) return null;
    const direct = tables.journeyMeta.get(tripId);
    if (direct) return direct;

    const tail = tripId.split(':').pop() || tripId;
    const tailDirect = tables.journeyMeta.get(tail);
    if (tailDirect) {
        tables.journeyMeta.set(tripId, tailDirect);
        return tailDirect;
    }

    // Suffix-baserad lookup (samma som findJourneyLineId) för långa numeriska tripId (t.ex. Örebro)
    if (tripId.length > 7 && /^\d+$/.test(tripId)) {
        const lengths = [18, 16, 12, 10, 8, 7];
        for (const len of lengths) {
            if (tripId.length >= len) {
                const suffix = tripId.slice(-len);
                const meta = tables.journeyMeta.get(suffix);
                if (meta) {
                    tables.journeyMeta.set(tripId, meta);
                    return meta;
                }
            }
        }
    }

    const normTrip = normalizeTripKey(tripId);
    if (!normTrip) return null;
    for (const [k, m] of tables.journeyMeta) {
        const nk = normalizeTripKey(k);
        if (!nk) continue;
        if (nk === normTrip || nk.endsWith(normTrip) || normTrip.endsWith(nk)) {
            tables.journeyMeta.set(tripId, m);
            return m;
        }
    }
    return null;
}

function findDetailedJourney(detail: DetailedLine, tripId?: string | null): DetailedJourney | null {
    if (!tripId) return null;
    const direct = detail.journeys.get(tripId);
    if (direct) return direct;

    const tail = tripId.split(':').pop() || tripId;
    const tailDirect = detail.journeys.get(tail);
    if (tailDirect) return tailDirect;

    const normTrip = normalizeTripKey(tripId);
    if (!normTrip) return null;
    for (const [k, j] of detail.journeys) {
        const nk = normalizeTripKey(k);
        if (!nk) continue;
        if (nk === normTrip || nk.endsWith(normTrip) || normTrip.endsWith(nk)) return j;
    }
    return null;
}

async function ensurePass2(lineId: string, tables: OperatorTables): Promise<DetailedLine | null> {
    let detail = tables.detailCache.get(lineId) || null;
    if (!detail) {
        const fileName = Array.from(tables.fileToLineId.entries()).find(([, lid]) => lid === lineId)?.[0];
        if (fileName && tables.zip?.files[fileName]) {
            const xml = await tables.zip.files[fileName].async('text');
            detail = await pass2(xml, lineId);
            if (detail) tables.detailCache.set(lineId, detail);
        }
    }
    return detail;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const NeTExShapeService = {

    /** Call once with an operator id. Begins async ZIP download + Pass-1 index.
     *  Re-renders happen progressively via the onProgress callback. */
    preload: (operatorId: string): void => {
        if (cache.has(operatorId) || loading.has(operatorId)) return;
        const p = loadOperator(operatorId).finally(() => loading.delete(operatorId));
        loading.set(operatorId, p);
    },

    /** Register a callback that fires after each batch of files is parsed.
     *  Use this to trigger a React state update → re-render with new line data. */
    onProgress: (cb: (op: string) => void): void => {
        if (!onProgressCallbacks.includes(cb)) onProgressCallbacks.push(cb);
    },

    /** Async resolve – triggers Pass 2 (detailed stop/shape data) if needed. */
    resolve: async (
        tripId?: string | null, routeId?: string | null, operatorId?: string,
        stopId?: string | null, realtimeHeadsign?: string | null,
        stopSequence?: number | null, vehicleLat?: number | null, vehicleLng?: number | null
    ): Promise<VehicleRoutePayload> => {
        const op = operatorId || 'sl';
        const empty: VehicleRoutePayload = {
            line: '?', destination: null, nextStopName: null, nextStopPlatform: null,
            routeInfo: null, tripHeadsign: null, shape: null,
            directionId: null, resolutionNotes: []
        };

        // Ensure operator is loaded
        if (!cache.has(op)) {
            const p = loading.get(op) || loadOperator(op).finally(() => loading.delete(op));
            loading.set(op, p); await p;
        }

        const tables = cache.get(op); if (!tables) return empty;
        const lineId = findJourneyLineId(tables, tripId, routeId);
        const lineRec = lineId ? tables.lines.get(lineId) : null;

        // Lazy load detailed stops/shapes (Pass 2)
        let detail: DetailedLine | null = null;
        if (lineId) {
            detail = await ensurePass2(lineId, tables);
        }
        // Route info from Pass 1
        const routeInfo: RouteInfo | null = lineRec ? {
            routeId: lineRec.lineId, shortName: lineRec.publicCode,
            longName: lineRec.name !== lineRec.publicCode ? lineRec.name : '',
            color: lineRec.colour, textColor: lineRec.textColour,
            routeType: modeToType(lineRec.transportMode),
        } : null;

        // Resolve journey stops and headsign
        let journeyStops: JourneyStop[] | undefined;
        let headsign: string | null = null;
        let lastStop: string | null = null;

        if (detail) {
            let j = tripId ? findDetailedJourney(detail, tripId) : null;
            if (!j && detail.journeys.size > 0) {
                // Fallback: pick the longest journey pattern of the line to at least draw the route
                let longest: DetailedJourney | null = null;
                for (const cand of detail.journeys.values()) {
                    if (!longest || cand.stops.length > longest.stops.length) longest = cand;
                }
                j = longest;
            }

            if (j) {
                headsign = j.headsign;
                const resolved: JourneyStop[] = [];
                for (const pt of j.stops) {
                    const stopRef = detail.spijpToStop.get(pt.spijpRef) || pt.spijpRef;
                    const s = detail.stops.get(stopRef);
                    if (s) resolved.push({ id: stopRef, name: s.name, lat: s.lat, lng: s.lng, arrivalTime: pt.arrivalTime, seq: pt.seq });
                }
                if (resolved.length > 0) {
                    journeyStops = resolved;
                    lastStop = resolved[resolved.length - 1].name;
                }
            }
        }

        const meta = findJourneyMeta(tables, tripId);
        headsign = headsign || meta?.headsign || null;

        // Shape from stops
        let shape: ShapePolyline | null = null;
        if (journeyStops && journeyStops.length >= 2) {
            const coords = journeyStops.filter(s => !isNaN(s.lat)).map(s => [s.lat, s.lng] as [number, number]);
            if (coords.length >= 2) shape = { shapeId: tripId || 'x', coordinates: coords };
        }

        // Destination
        const destination = realtimeHeadsign || headsign || lastStop || lineRec?.name || lineRec?.publicCode || null;

        // Next stop
        let nextStopName: string | null = null, nextStopPlatform: string | null = null;
        if (stopId && detail?.stops.has(stopId)) { nextStopName = detail.stops.get(stopId)!.name; }
        if (!nextStopName && journeyStops) {
            if (stopSequence != null) {
                const r = journeyStops.filter(s => (s.seq || 0) >= stopSequence);
                if (r.length) { nextStopName = r[0].name; nextStopPlatform = r[0].platformCode || null; }
            }
            if (!nextStopName && vehicleLat != null && vehicleLng != null) {
                let best = Infinity, bs: JourneyStop | null = null;
                for (const s of journeyStops) {
                    const d = (s.lat - vehicleLat!) ** 2 + (s.lng - vehicleLng!) ** 2;
                    if (d < best) { best = d; bs = s; }
                }
                if (bs) { nextStopName = bs.name; nextStopPlatform = bs.platformCode || null; }
            }
        }

        return {
            routeInfo, shape, tripHeadsign: headsign,
            directionId: meta?.directionId ?? null,
            resolutionNotes: [], nextStopName, nextStopPlatform,
            destination, line: lineRec?.publicCode || null, journeyStops,
        };
    },

    /** Sync resolve – returns null if Pass 1 not finished for this operator. */
    resolveSync: (
        tripId?: string | null, routeId?: string | null, operatorId?: string,
        stopId?: string | null, realtimeHeadsign?: string | null,
        stopSequence?: number | null, vehicleLat?: number | null, vehicleLng?: number | null
    ): VehicleRoutePayload | null => {
        const op = operatorId || 'sl';
        const tables = cache.get(op); if (!tables) return null;
        const lineId = findJourneyLineId(tables, tripId, routeId);
        const lineRec = lineId ? tables.lines.get(lineId) : null;
        if (!lineRec) return null;

        const routeInfo: RouteInfo = {
            routeId: lineRec.lineId, shortName: lineRec.publicCode,
            longName: lineRec.name !== lineRec.publicCode ? lineRec.name : '',
            color: lineRec.colour, textColor: lineRec.textColour,
            routeType: modeToType(lineRec.transportMode),
        };

        // Use detail cache if available
        const detail = lineId ? tables.detailCache.get(lineId) : undefined;
        let journeyStops: JourneyStop[] | undefined;
        let headsign: string | null = null, lastStop: string | null = null;

        if (detail && tripId) {
            const j = findDetailedJourney(detail, tripId);
            if (j) {
                headsign = j.headsign;
                const r: JourneyStop[] = [];
                for (const pt of j.stops) {
                    const sRef = detail.spijpToStop.get(pt.spijpRef) || pt.spijpRef;
                    const s = detail.stops.get(sRef);
                    if (s) r.push({ id: sRef, name: s.name, lat: s.lat, lng: s.lng, arrivalTime: pt.arrivalTime, seq: pt.seq });
                }
                if (r.length) { journeyStops = r; lastStop = r[r.length - 1].name; }
            }
        }

        const meta = findJourneyMeta(tables, tripId);
        headsign = headsign || meta?.headsign || null;

        let shape: ShapePolyline | null = null;
        if (journeyStops && journeyStops.length >= 2) {
            const coords = journeyStops.filter(s => !isNaN(s.lat)).map(s => [s.lat, s.lng] as [number, number]);
            if (coords.length >= 2) shape = { shapeId: tripId || 'x', coordinates: coords };
        }

        return {
            routeInfo, shape, tripHeadsign: headsign,
            directionId: meta?.directionId ?? null,
            resolutionNotes: [], nextStopName: null, nextStopPlatform: null,
            destination: realtimeHeadsign || headsign || lastStop || lineRec.publicCode,
            line: lineRec.publicCode, journeyStops,
        };
    },

    /** Sync line info for marker badge rendering. Triggers async load if needed. */
    getLineInfo: (operatorId: string, tripId?: string, routeId?: string): {
        line: string; longName?: string; headsign?: string; color: string; textColor: string; routeType?: number;
    } | null => {
        const tables = cache.get(operatorId); if (!tables) return null;
        const lineId = findJourneyLineId(tables, tripId, routeId); if (!lineId) return null;
        const r = tables.lines.get(lineId); if (!r) return null;
        const j = findJourneyMeta(tables, tripId);
        return { line: r.publicCode, longName: r.name !== r.publicCode ? r.name : undefined, headsign: j?.headsign || undefined, color: r.colour, textColor: r.textColour, routeType: modeToType(r.transportMode) };
    },

    isLoaded: (op: string): boolean => cache.has(op) && (cache.get(op)!.lines.size > 0),

    getRouteMap: (op: string): Map<string, string> | null => {
        const t = cache.get(op); if (!t) return null;
        const m = new Map<string, string>();
        for (const [id, l] of t.lines) m.set(id, l.publicCode);
        return m.size > 0 ? m : null;
    },

    getAllStops: (op: string, minLat?: number, minLng?: number, maxLat?: number, maxLng?: number) => {
        const t = cache.get(op); if (!t) return [];
        const out: { id: string; name: string; lat: number; lng: number }[] = [];
        for (const [, d] of t.detailCache) {
            for (const [id, s] of d.stops) {
                if (minLat && (s.lat < minLat || s.lat > (maxLat || 90))) continue;
                if (minLng && (s.lng < minLng || s.lng > (maxLng || 180))) continue;
                out.push({ id, name: s.name, lat: s.lat, lng: s.lng });
            }
        }
        return out;
    },

    stats: (op: string) => {
        const t = cache.get(op); if (!t) return null;
        return { lines: t.lines.size, journeys: t.journeyToLine.size, detailsCached: t.detailCache.size };
    },

    /** Fetches and returns all simplified route shapes for an operator, grouped by color.
     * Useful for drawing the background transport network. */
    getAllNetworkShapes: async (op: string): Promise<Record<string, { points: [number, number][][], color: string; mode: string; publicCode: string }>> => {
        const t = cache.get(op); if (!t) return {};
        const network: Record<string, { points: [number, number][][], color: string; mode: string; publicCode: string }> = {};

        // Extract shapes for all lines (batch by 5 to avoid blocking UI)
        const lineIds = Array.from(t.lines.keys());
        console.log(`[NeTEx] Calculating network shapes for ${op} (${lineIds.length} lines)...`);

        const BATCH = 15;
        for (let i = 0; i < lineIds.length; i += BATCH) {
            const batch = lineIds.slice(i, i + BATCH);
            await Promise.all(batch.map(async (lineId) => {
                const line = t.lines.get(lineId);
                if (!line) return;

                // Ensure detailed data (shapes) is available
                const d = await ensurePass2(lineId, t);
                if (!d || !d.journeys.size) return;

                // Collect unique shapes for this line (take the longest journey pattern as representative)
                let bestShape: [number, number][] = [];
                for (const j of d.journeys.values()) {
                    // DetailedJourney has stops: { spijpRef: string; ... }[]
                    // We need to look up the actual lat/lng from d.stops
                    const coords: [number, number][] = j.stops
                        .map(st => {
                            const stopRef = d.spijpToStop.get(st.spijpRef) || st.spijpRef;
                            const s = d.stops.get(stopRef);
                            return s ? [s.lat, s.lng] as [number, number] : null;
                        })
                        .filter((c): c is [number, number] => c !== null);

                    if (coords.length > bestShape.length) bestShape = coords;
                    if (bestShape.length > 50) break; // Good enough for network overview
                }

                if (bestShape.length > 1) {
                    const c = line.colour || '#cccccc';
                    if (!network[lineId]) network[lineId] = { points: [], color: c, mode: line.transportMode, publicCode: line.publicCode };
                    network[lineId].points.push(bestShape);
                }
            }));
            if (i % 60 === 0) await yieldToMain();
        }

        console.log(`[NeTEx] Network shapes ready for ${op}`);
        return network;
    },

    clearCache: () => { cache.clear(); loading.clear(); },
};
