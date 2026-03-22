/**
 * LiveLineResolver — Lightweight, instant line data resolution
 * ─────────────────────────────────────────────────────────────
 * Replaces the heavy NeTEx ZIP download approach with:
 *  1. SL Transport API (free, no key) for Stockholm line colors/modes
 *  2. Built-in Swedish transit color palette for known lines
 *  3. GTFS-RT vehicle positions to infer destinations in real-time
 *
 * Data sources:
 *  - SL Transport API: cached 1 hour in localStorage (~50KB response)
 *  - Hardcoded colors for metro/pendeltåg/spårvagn/known operators
 *  - Real-time vehicle stream for destination inference
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LineInfo {
    line: string;           // Public line code (e.g. "14", "T10")
    color: string;          // Background color hex
    textColor: string;      // Text color hex
    mode: string;           // Transport mode: BUS, TRAM, TRAIN, METRO, FERRY
    longName?: string;      // e.g. "Ropsten - Nockeby"
    groupOfLines?: string;  // e.g. "Blåbussarna", "Tvärbanan"
}

// ── SL Colors & Known Lines ────────────────────────────────────────────────────

const SL_METRO_COLORS: Record<string, { color: string; group: string }> = {
    '10': { color: '#0078bf', group: 'Blå linje' },
    '11': { color: '#0078bf', group: 'Blå linje' },
    '13': { color: '#d91f26', group: 'Röda linjen' },
    '14': { color: '#d91f26', group: 'Röda linjen' },
    '17': { color: '#17c15c', group: 'Gröna linjen' },
    '18': { color: '#17c15c', group: 'Gröna linjen' },
    '19': { color: '#17c15c', group: 'Gröna linjen' },
};

const SL_PENDEL_COLOR = '#ec619f';  // Rosa/Magenta
const SL_TRAM_COLORS: Record<string, string> = {
    '7': '#666666',      // Spårväg City
    '12': '#666666',     // Nockebybanan
    '21': '#666666',     // Lidingöbanan
    '22': '#ffa500',     // Tvärbanan
    '25': '#ffa500',     // Saltsjöbanan -> tvärbanan
    '26': '#ffa500',     // Lidingöbanan
    '27': '#ffa500',     // Saltsjöbanan
    '28': '#ffa500',     // Tvärbanan
    '29': '#ffa500',     // Tvärbanan
    '30': '#a8559a',     // Tvärbanan
};

// Linjefärger per län/trafikslag – enhetliga, igenkännliga färger
const OPERATOR_MODE_COLORS: Record<string, Record<string, string>> = {
    sl: { METRO: '#d91f26', TRAIN: '#ec619f', TRAM: '#ffa500', BUS: '#00639a', FERRY: '#01abdb' },
    skane: { BUS: '#ffd700', TRAIN: '#d4003c', TRAM: '#97c900', FERRY: '#0077be' },
    vasttrafik: { BUS: '#006ab5', TRAM: '#f26522', TRAIN: '#00a651', FERRY: '#6e6e6e' },
    ul: { BUS: '#e3000b', TRAIN: '#005fa5' },
    otraf: { BUS: '#003b6f', TRAIN: '#003b6f' },
    jlt: { BUS: '#009639', TRAIN: '#009639' },
    krono: { BUS: '#0072bc', TRAIN: '#0072bc' },
    klt: { BUS: '#e30613', TRAIN: '#e30613' },
    gotland: { BUS: '#00a3e0', FERRY: '#003d7a' },
    halland: { BUS: '#00a3e0', TRAIN: '#00a3e0' },
    varm: { BUS: '#e30613', TRAIN: '#e30613' },
    orebro: { BUS: '#0072bc', TRAIN: '#0072bc' },
    vastmanland: { BUS: '#00a651', TRAIN: '#00a651' },
    dt: { BUS: '#e30613', TRAIN: '#e30613' },
    xt: { BUS: '#ed1c24', TRAIN: '#ed1c24' },
    dintur: { BUS: '#0072bc', TRAIN: '#0072bc' },
    blekinge: { BUS: '#00a3e0' },
    sormland: { BUS: '#00639a', TRAIN: '#00639a' },
};

const DEFAULT_MODE_COLORS: Record<string, string> = {
    BUS: '#0ea5e9',
    TRAM: '#14b8a6',
    TRAIN: '#8b5cf6',
    METRO: '#dc2626',
    FERRY: '#4f46e5',
};

// ── SL Transport API Cache ─────────────────────────────────────────────────────

interface SLLineCacheEntry {
    id: number;
    designation: string;     // Line number
    transport_mode: string;
    group_of_lines?: string;
}

const SL_CACHE_KEY = 'live_line_sl_cache';
const SL_CACHE_TTL = 3600 * 1000; // 1 hour

let slLineCache: Map<string, SLLineCacheEntry> | null = null;
let slLineFetchPromise: Promise<void> | null = null;

async function fetchSLLines(): Promise<void> {
    if (slLineCache) return;
    if (slLineFetchPromise) { await slLineFetchPromise; return; }

    slLineFetchPromise = (async () => {
        // Check localStorage first
        try {
            const stored = localStorage.getItem(SL_CACHE_KEY);
            if (stored) {
                const { ts, data } = JSON.parse(stored);
                if (Date.now() - ts < SL_CACHE_TTL) {
                    slLineCache = new Map();
                    for (const entry of data) {
                        slLineCache.set(String(entry.designation), entry);
                    }
                    console.log(`[LiveLineResolver] SL lines loaded from cache: ${slLineCache.size} lines`);
                    return;
                }
            }
        } catch { /* ignore */ }

        // Fetch from API
        try {
            const res = await fetch('https://transport.integration.sl.se/v1/lines?transport_authority_id=1');
            if (!res.ok) { console.warn(`[LiveLineResolver] SL lines API: ${res.status}`); return; }
            const data = await res.json();

            slLineCache = new Map();
            const allEntries: SLLineCacheEntry[] = [];

            for (const [mode, lines] of Object.entries(data)) {
                if (!Array.isArray(lines)) continue;
                for (const line of lines) {
                    const entry: SLLineCacheEntry = {
                        id: line.id,
                        designation: String(line.designation || ''),
                        transport_mode: String(line.transport_mode || mode).toUpperCase(),
                        group_of_lines: line.group_of_lines,
                    };
                    if (entry.designation) {
                        slLineCache.set(entry.designation, entry);
                        allEntries.push(entry);
                    }
                }
            }

            console.log(`[LiveLineResolver] SL lines loaded from API: ${slLineCache.size} lines`);

            // Cache in localStorage
            try {
                localStorage.setItem(SL_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: allEntries }));
            } catch { /* ignore storage errors */ }
        } catch (e) {
            console.warn('[LiveLineResolver] Failed to fetch SL lines:', e);
        }
    })();

    await slLineFetchPromise;
    slLineFetchPromise = null;
}

// ── Real-time destination tracker ──────────────────────────────────────────────
// Tracks destinations seen per line from GTFS-RT vehicle positions

const destinationTracker = new Map<string, Map<string, number>>(); // operator:line → { dest → count }

function trackDestination(operator: string, line: string, dest: string): void {
    if (!dest || dest === '?' || !line || line === '?') return;
    const key = `${operator}:${line}`;
    if (!destinationTracker.has(key)) destinationTracker.set(key, new Map());
    const m = destinationTracker.get(key)!;
    m.set(dest, (m.get(dest) || 0) + 1);
}

function getCommonDestinations(operator: string, line: string): string[] {
    const key = `${operator}:${line}`;
    const m = destinationTracker.get(key);
    if (!m) return [];
    return Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([dest]) => dest);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const LiveLineResolver = {
    /**
     * Initialize – call once early. Fetches SL line data in background.
     */
    init: (): void => {
        fetchSLLines();
    },

    /**
     * Feed real-time vehicle data to build destination knowledge.
     * Call this after every GTFS-RT fetch with the parsed vehicles.
     */
    feedVehicles: (vehicles: { operator?: string; line?: string; dest?: string }[]): void => {
        for (const v of vehicles) {
            if (v.operator && v.line && v.dest) {
                trackDestination(v.operator, v.line, v.dest);
            }
        }
    },

    /**
     * Feed a single resolved destination (e.g. from NeTEx or TripUpdates) so other
     * vehicles on the same line can use it when they lack destination in the feed.
     */
    feedDestination: (operator: string, line: string, dest: string): void => {
        if (operator && line && line !== '?' && dest) {
            trackDestination(operator, line, dest);
        }
    },

    /**
     * Resolve line info instantly (sync). Returns null if no data available.
     */
    resolve: (operator: string, lineCode: string, tripHeadsign?: string | null): LineInfo | null => {
        const op = (operator || '').toLowerCase();

        // ── SL-specific resolution ──
        if (op === 'sl') {
            const code = lineCode || '?';
            // Metro
            const metroInfo = SL_METRO_COLORS[code];
            if (metroInfo) {
                return {
                    line: code,
                    color: metroInfo.color,
                    textColor: '#ffffff',
                    mode: 'METRO',
                    groupOfLines: metroInfo.group,
                };
            }

            // Check SL Transport API cache
            const slEntry = slLineCache?.get(code);
            if (slEntry) {
                const mode = slEntry.transport_mode;
                let color = DEFAULT_MODE_COLORS[mode] || '#00639a';
                if (mode === 'TRAIN') color = SL_PENDEL_COLOR;
                if (mode === 'TRAM') color = SL_TRAM_COLORS[code] || '#ffa500';
                if (mode === 'METRO') {
                    const mc = SL_METRO_COLORS[code];
                    if (mc) color = mc.color;
                }
                if (mode === 'BUS') {
                    const num = parseInt(code);
                    if (num >= 1 && num <= 6) color = '#00639a';
                    else color = '#d71921';
                }
                return {
                    line: code,
                    color,
                    textColor: '#ffffff',
                    mode,
                    groupOfLines: slEntry.group_of_lines,
                };
            }

            // SL fallback
            return {
                line: code,
                color: '#d71921',
                textColor: '#ffffff',
                mode: 'BUS',
            };
        }

        // ── JLT (Jönköping) – linjespecifika färger (fallback när NeTEx inte är laddad)
        if (op === 'jlt') {
            const code = lineCode || '?';
            const n = parseInt(code, 10);
            if (code === '1') return { line: code, color: '#E61C24', textColor: '#ffffff', mode: 'BUS' };
            if (code === '2') return { line: code, color: '#FBB040', textColor: '#000000', mode: 'BUS' };
            if (code === '3') return { line: code, color: '#00A651', textColor: '#ffffff', mode: 'BUS' };
            if (code === '4') return { line: code, color: '#00AEEF', textColor: '#ffffff', mode: 'BUS' };
            if (!isNaN(n) && n >= 11 && n <= 99) return { line: code, color: '#662D91', textColor: '#ffffff', mode: 'BUS' };
            return { line: code, color: '#7C3AED', textColor: '#ffffff', mode: 'BUS' };
        }

        // ── Generic operator resolution – använd operatörens färg per trafikslag ──
        const code = lineCode || '?';
        const opColors = OPERATOR_MODE_COLORS[op];
        const fallbackColor = opColors?.BUS ?? DEFAULT_MODE_COLORS.BUS;
        const textColor = '#ffffff';

        return {
            line: code,
            color: fallbackColor,
            textColor,
            mode: 'BUS',
        };
    },

    /**
     * Get destination for a line from real-time tracking.
     */
    getDestinations: (operator: string, line: string): string[] => {
        return getCommonDestinations(operator, line);
    },

    /**
     * Check if SL line data is loaded.
     */
    isReady: (): boolean => slLineCache !== null && slLineCache.size > 0,

    /**
     * Force reload SL data.
     */
    reload: async (): Promise<void> => {
        slLineCache = null;
        try { localStorage.removeItem(SL_CACHE_KEY); } catch { /* ignore */ }
        await fetchSLLines();
    },
};

// Auto-initialize on import
LiveLineResolver.init();
