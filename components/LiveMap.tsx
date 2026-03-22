import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, Polyline, CircleMarker } from 'react-leaflet';
import { AnimatedMarker } from './AnimatedMarker';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TrafiklabService } from '../services/trafiklabService';
import { GtfsShapeService, VehicleRoutePayload } from '../services/gtfsShapeService';
import { GtfsSwedenStaticService } from '../services/gtfsSwedenStaticService';
import { GtfsDestinationService, type GtfsIndexes } from '../services/gtfsDestinationService';
import { LiveLineResolver } from '../services/liveLineResolver';
import { resolveStopName, getCachedStopName, prefetchStopNames } from '../services/stopNameResolver';
import { TRAFIKLAB_OPERATORS, OPERATOR_REGIONS } from '../services/config';
import jltVehicles from '../src/jlt-vehicles.json';
import slVehicles from '../src/sl-vehicles.json';
import skaneVehicles from '../src/skane-vehicles.json';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBus, faTrain, faTram, faChevronDown, faLocationArrow, faXmark, faLayerGroup, faExpand, faCompress, faShip, faMoon, faSun, faSpinner, faSearch } from '@fortawesome/free-solid-svg-icons';

const REFRESH_INTERVAL = 2500; // 2.5s – som BKT busmap
const VEHICLE_CACHE_TTL_MS = 5000; // 5s – återanvänd fordonsdata vid pan/zoom (BKT-stil)

// ── Icon cache: keyed by "MODE|color|bearingBucket|line"
// ── Modern 2026 Icon System ──────────────────────────────────────────────────
// Vector-based, crisp, glass-morphic markers with distinct shapes per mode.

const iconCache = new Map<string, L.DivIcon>();
const truncateDest = (s: string, maxLen: number): string => {
    const t = s.replace(/^Mot\s+/i, '').trim();
    if (!t) return '';
    return t.length <= maxLen ? t : t.slice(0, maxLen - 1) + '…';
};
/** True om strängen ser ut som ett riktigt linjenummer (inte route_id eller intern kod). */
const looksLikeLineNumber = (s: string | null | undefined): boolean => {
    const v = String(s || '').trim();
    if (!v || v === '?') return false;
    if (/^\d{1,4}$/.test(v)) return true;
    if (/^\d{1,4}[A-Z]$/i.test(v)) return true;
    if (/^[A-Z]{1,3}\d{1,4}[A-Z]?$/i.test(v)) return true;
    if (/^[A-ZÅÄÖ]{1,6}$/i.test(v)) return true;
    return false;
};
/** Visa linjenummer utan ledande noll. Örebro stadsbuss: 1–9 som en siffra ("3" inte "03"). "03" → "3", "30" → "30", "103" → "103". */
const normalizeLineDisplay = (s: string | null | undefined): string => {
    const v = String(s ?? '').trim();
    if (!v || v === '?' || v === '-') return v;
    if (/^\d+$/.test(v)) return v.replace(/^0+/, '') || '0';
    if (/^\d+[A-Z]$/i.test(v)) return v.replace(/^\d+/, (m) => m.replace(/^0+/, '') || '0');
    return v;
};
/** Formatera försening för badge (BKT-stil): +1, -2, +5 min. */
const formatDelayBadge = (delaySeconds: number | null | undefined): string => {
    if (delaySeconds == null || delaySeconds === 0) return '';
    if (delaySeconds >= 60) return '+' + Math.round(delaySeconds / 60);
    if (delaySeconds > 0) return '+1';
    if (delaySeconds <= -60) return '-' + Math.round(Math.abs(delaySeconds) / 60);
    return '-1';
};
const buildIconHTML = (line: string, rotation: number, mode: string, color: string, operator?: string, destination?: string, delaySeconds?: number | null): string => {
    const bgColor = color || '#0ea5e9';
    const delayDisp = formatDelayBadge(delaySeconds);
    let vehicleShape = '';
    const op = (operator || '').toLowerCase();

    if (mode === 'FERRY') {
        vehicleShape = [
            `<path d="M 24 2 C 32 10 36 22 36 38 A 12 4 0 0 1 12 38 C 12 22 16 10 24 2 Z" fill="${bgColor}" stroke="#ffffff" stroke-width="1.5"/>`,
            `<rect x="20" y="16" width="8" height="12" rx="2" fill="#1e293b" opacity="0.8"/>`,
            `<path d="M 16 30 L 32 30 L 30 36 L 18 36 Z" fill="#1e293b" opacity="0.5"/>`,
        ].join('');
    } else if (mode === 'TRAIN') {
        vehicleShape = [
            `<rect x="10" y="8" width="28" height="32" rx="4" fill="${bgColor}" stroke="#ffffff" stroke-width="1.5"/>`,
            `<rect x="10" y="8" width="28" height="8" rx="3" fill="#1e293b" opacity="0.9"/>`,
            `<circle cx="16" cy="38" r="4" fill="#1e293b" opacity="0.85"/>`,
            `<circle cx="32" cy="38" r="4" fill="#1e293b" opacity="0.85"/>`,
            `<rect x="12" y="20" width="24" height="4" rx="1" fill="#ffffff" opacity="0.35"/>`,
        ].join('');
    } else if (mode === 'METRO') {
        vehicleShape = [
            `<polygon points="24,2 40,12 40,36 24,46 8,36 8,12" fill="${bgColor}" stroke="#ffffff" stroke-width="1.5"/>`,
            `<text x="24" y="28" text-anchor="middle" font-size="20" font-weight="900" fill="#ffffff" font-family="system-ui,sans-serif">T</text>`,
        ].join('');
    } else if (mode === 'TRAM') {
        vehicleShape = [
            `<rect x="8" y="12" width="32" height="28" rx="4" fill="${bgColor}" stroke="#ffffff" stroke-width="1.5"/>`,
            `<path d="M 22 4 L 26 4 L 26 12 L 22 12 Z" fill="#1e293b" opacity="0.9"/>`,
            `<rect x="14" y="22" width="20" height="4" rx="1" fill="#ffffff" opacity="0.3"/>`,
            `<circle cx="14" cy="42" r="3" fill="#1e293b" opacity="0.8"/>`,
            `<circle cx="34" cy="42" r="3" fill="#1e293b" opacity="0.8"/>`,
        ].join('');
    } else {
        // BUS – original stil som tidigare
        vehicleShape = [
            `<rect x="11" y="5" width="26" height="38" rx="5" fill="${bgColor}" stroke="#ffffff" stroke-width="1.5"/>`,
            `<path d="M 13 11 C 13 7 35 7 35 11 L 34 15 L 14 15 Z" fill="#1e293b" opacity="0.85"/>`,
            `<rect x="15" y="39" width="18" height="2" rx="1" fill="#1e293b" opacity="0.7"/>`,
            `<rect x="8" y="9" width="3" height="5" rx="1.5" fill="${bgColor}" stroke="#ffffff" stroke-width="1"/>`,
            `<rect x="37" y="9" width="3" height="5" rx="1.5" fill="${bgColor}" stroke="#ffffff" stroke-width="1"/>`,
        ].join('');
    }

    // Badge som förut: vit, ren, lätt skugga. Försening som enkel rad under (tydlig men inte pill).
    const delayHtml = delayDisp ? `<br/><span style="font-size:9px;font-weight:700;color:#475569;">${delayDisp}</span>` : '';
    return [
        `<div style="width:48px;height:48px;position:relative;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0px 3px 6px rgba(0,0,0,0.35));transform:translate3d(0,0,0);">`,
        `<div style="position:absolute;inset:0;transform:rotate(${rotation}deg);will-change:transform;display:flex;align-items:center;justify-content:center;">`,
        `<svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg">${vehicleShape}</svg>`,
        `</div>`,
        `<div style="position:absolute;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;pointer-events:none;gap:0;">`,
        `<span style="font-size:11px;font-weight:900;color:#1e293b;background-color:rgba(255,255,255,0.95);padding:2px 5px;border-radius:5px;font-family:system-ui,sans-serif;letter-spacing:-0.5px;box-shadow:0 1px 3px rgba(0,0,0,0.3);border:1px solid rgba(0,0,0,0.1);line-height:1.15;white-space:${destination ? 'normal' : 'nowrap'};text-align:center;display:inline-block;">${line}${delayHtml}${destination ? `<br/><span style="font-size:8px;font-weight:700;color:#475569;">${truncateDest(destination, 10)}</span>` : ''}</span>`,
        `</div>`,
        `</div>`,
    ].join('');
};


const getIcon = (line: string, bearing: number, mode: string, color: string, operator?: string, destination?: string, delaySeconds?: number | null): L.DivIcon => {
    const bucket = Math.round(bearing / 5) * 5;
    const destKey = destination ? truncateDest(destination, 12) : '';
    const delayKey = formatDelayBadge(delaySeconds);
    const key = `${mode}|${color}|${bucket}|${line}|${operator || ''}|${destKey}|${delayKey}`;
    if (iconCache.has(key)) return iconCache.get(key)!;
    const icon = L.divIcon({
        html: buildIconHTML(line, bucket, mode, color, operator, destination, delaySeconds),
        className: '',
        iconSize: [48, 48],
        iconAnchor: [24, 24],
    });
    iconCache.set(key, icon);
    return icon;
};


// ── Helper: Create Optimistic Route Stub (75m - short enough to look valid on curves)
const createRouteStub = (lat: number, lng: number, bearing: number): [number, number][] => {
    if (!bearing) return [];
    const R = 6378137; // Earth Radius
    const d = 75; // 75m stub (reduced from 300m)
    const brng = (bearing * Math.PI) / 180;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lng * Math.PI) / 180;

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) + Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1), Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));

    return [
        [lat, lng],
        [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI]
    ];
};

// ── Helper: Build instant route from sibling vehicles on the same routeId ──────
// Instead of waiting for NeTEx to download, we use ALL vehicles currently on the
// same route to reconstruct an approximate path. Sorted by stopSequence if available,
// otherwise by geographic proximity (greedy nearest-neighbor).
const buildSiblingRoute = (selected: any, allVehicles: any[]): [number, number][] => {
    if (!selected.routeId && !selected.line) return [];

    // If routeId is missing, matching just by line number creates crazy spiderwebs across the city.
    // We only match by actual GTFS routeId.
    const siblings = allVehicles.filter(v => {
        if (v.id === selected.id) return false;
        if (selected.routeId && v.routeId === selected.routeId) return true;
        return false;
    });

    if (siblings.length < 1) return [];

    // Include the selected vehicle itself
    const all = [selected, ...siblings];

    // Try sorting by stopSequence first
    const withSeq = all.filter(v => v.stopSequence != null);
    if (withSeq.length >= 2) {
        withSeq.sort((a, b) => (a.stopSequence || 0) - (b.stopSequence || 0));
        return withSeq.map(v => [v.lat, v.lng] as [number, number]);
    }

    // Fallback: greedy nearest-neighbor sort to create a path
    const coords = all.map(v => ({ lat: v.lat, lng: v.lng }));
    const ordered: { lat: number; lng: number }[] = [coords[0]];
    const remaining = new Set(coords.slice(1));

    while (remaining.size > 0) {
        const last = ordered[ordered.length - 1];
        let closest: { lat: number; lng: number } | null = null;
        let bestDist = Infinity;
        for (const c of remaining) {
            const d = (c.lat - last.lat) ** 2 + (c.lng - last.lng) ** 2;
            if (d < bestDist) { bestDist = d; closest = c; }
        }
        if (closest) { ordered.push(closest); remaining.delete(closest); }
        else break;
    }

    return ordered.map(c => [c.lat, c.lng] as [number, number]);
};

const SUPPORTED_STATIC_OPERATORS = new Set([
    'sl', 'ul', 'skane', 'vasttrafik', 'otraf', 'jlt', 'krono', 'klt', 'gotland',
    'varm', 'orebro', 'vastmanland', 'dt', 'xt', 'dintur', 'halland', 'blekinge',
    'sormland', 'jamtland', 'vasterbotten', 'norrbotten'
]);

const inferOperatorFromRtId = (id?: string | null): string | null => {
    const v = String(id || '');
    if (!v) return null;

    // 1. National GID/NetEx prefixes (9011XXX or 9031XXX)
    // Authority codes: 001=SL, 012=Skåne, 005=Otraf, 006=JLT, 018=Örebro, 014=Vt, 003=UL...
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

    // 2. Specific Authority Prefixes
    if (v.startsWith('1082') || v.startsWith('1065')) return 'sl';
    if (v.startsWith('9024')) return 'skane';
    if (v.startsWith('9025')) return 'vasttrafik';
    if (v.startsWith('9027')) return 'orebro';
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
};

const getOperatorCandidates = (v: any, selectedOperator: string): string[] => {
    const out = new Set<string>();
    // 1. Vehicle's own operator field (most authoritative)
    const raw = String(v?.operator || '').toLowerCase();
    if (SUPPORTED_STATIC_OPERATORS.has(raw)) out.add(raw);
    // 2. Inferred from trip/route/vehicle IDs
    const inferred = inferOperatorFromRtId(v?.tripId) || inferOperatorFromRtId(v?.routeId) || inferOperatorFromRtId(v?.id);
    if (inferred && SUPPORTED_STATIC_OPERATORS.has(inferred)) out.add(inferred);
    // 3. Selected operator (if not sweden)
    if (selectedOperator && selectedOperator !== 'sweden' && SUPPORTED_STATIC_OPERATORS.has(selectedOperator)) out.add(selectedOperator);
    // 4. Fallback: use the raw operator even if not in SUPPORTED list (instead of hardcoding 'sl')
    if (out.size === 0 && raw) out.add(raw);
    return Array.from(out);
};

const getRawVehicleId = (v: any): string => {
    return String(v?.vehicleLabel || String(v?.id || '').replace(/^(tl-|vt-|veh-)/, '') || '').trim();
};

type ExternalVehicleDetails = {
    plate?: string;
    model?: string;
    operator?: string;
    alternativeId?: string;
};

const getVehicleLookupCandidates = (v: any): string[] => {
    const out = new Set<string>();
    const add = (value: any) => {
        const raw = String(value ?? '').trim();
        if (!raw) return;
        out.add(raw);
        const cleaned = raw.replace(/^(tl-|vt-|veh-)/, '');
        if (cleaned) out.add(cleaned);
    };

    add(v?.vehicleLabel);
    add(v?.id);
    add(v?.vehicleId);
    add(getRawVehicleId(v));
    return Array.from(out);
};

const normalizeExternalVehicleData = (src: any): ExternalVehicleDetails | null => {
    if (!src || typeof src !== 'object') return null;
    return {
        plate: String(src.plate ?? src.licensePlate ?? src.licencePlate ?? '').trim() || undefined,
        model: String(src.model ?? src.vehicleModel ?? '').trim() || undefined,
        operator: String(src.operator ?? src.agency ?? '').trim() || undefined,
        alternativeId: String(src.alternativeId ?? src.altId ?? src.alternative_id ?? '').trim() || undefined,
    };
};

const findExternalVehicleData = (v: any): ExternalVehicleDetails | null => {
    const sources = [jltVehicles as any, slVehicles as any, skaneVehicles as any];
    for (const candidate of getVehicleLookupCandidates(v)) {
        for (const source of sources) {
            const normalized = normalizeExternalVehicleData(source?.[candidate]);
            if (normalized && (normalized.plate || normalized.model || normalized.operator || normalized.alternativeId)) {
                return normalized;
            }
        }
    }
    return null;
};

const getTrainNumberFromVehicleId = (v: any): string | null => {
    const digits = getRawVehicleId(v).replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
};

const isLikelyTrainVehicle = (v: any, routeType?: number): boolean => {
    // Only classify as train based on GTFS static route_type (resolved by GtfsShapeService)
    // or explicit transportMode field. NO speed checks, NO operator/id prefix heuristics.
    // These heuristics cause misclassification (buses as trains, wrong icons, vehicle IDs as line labels).
    // Värmlandstrafik specific hardcoded train IDs
    const rawId = getRawVehicleId(v);
    const varmTrains = ['1414', '1415', '1416', '1420', '1421', '9048', '9049', '9050', '9066', '9067', '9081', '9082', '9083'];
    if (varmTrains.includes(rawId)) return true;

    if (routeType === 2 || routeType === 109) return true;  // Rail / Suburban Rail
    if (String(v?.transportMode || '').toUpperCase() === 'TRAIN') return true;
    return false;
};

const extractActualDestination = (value?: string | null): string | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const clean = raw
        .replace(/^mot\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const parts = clean
        .split(/\s*(?:->|=>|--|[-–—]|\/|\||•|>|»)\s*/g)
        .map(p => p.trim())
        .filter(Boolean);

    if (parts.length >= 2) return parts[parts.length - 1];
    return clean;
};

const isUselessDestination = (dest?: string | null, line?: string | null): boolean => {
    if (!dest) return true;
    const d = dest.trim().toLowerCase();
    if (d === '?' || d === 'null' || d === 'undefined' || d === 'okänd destination' || d === 'omnibuslinjen' || d === 'region' || d === 'ej linjesatt' || d === 'linjesatt') return true;
    // Trip IDs often look like long numbers or have many segments with colons
    if (d.length >= 7 && (/^\d+$/.test(d) || (d.match(/:/g) || []).length >= 2)) return true;
    if (line && d === line.trim().toLowerCase()) return true;
    return false;
};

// ── Compact Glass Panel Model
interface Chip { label: string; value: string; color?: string; }
interface CompactPanel {
    title: string;         // "Mot DESTINATION"
    subtitle: string;      // "Nästa: ..."
    lineNumber: string;
    lineColor: string;
    chips: Chip[];
}

const formatCompactPanel = (
    v: any,
    displayLine: string | null,
    displayDest: string | null,
    nextStopName: string | null,
    gtfsLoading: boolean,
    hasRoute: boolean,
    defaultColor: string,
    lineColor?: string,
    delaySeconds?: number | null
): CompactPanel => {
    const lineFinal = normalizeLineDisplay(gtfsLoading ? (displayLine || v.line || '?') : (displayLine || v.line || '?'));

    let dest = extractActualDestination(displayDest || v.dest || '') || '';
    // Förbjudet att visa "—" eller "Ej angiven hållplats" – räkna som saknad destination
    if (GtfsDestinationService.isForbiddenDestination(dest)) dest = '';
    // API kan skicka "Ej linjesatt" / "Linjesatt" som placeholder – räkna som saknad destination så vi visar "Linje X" eller "Mot X"
    if (dest && /Ej i trafik|Depå|Inställd|Ej linjesatt|Linjesatt|Tomkörning/i.test(dest)) dest = '';

    // Prevent showing duplicated line as destination (e.g. "Mot 28", "Mot Linje 28").
    const normalizeLineToken = (value: string | null | undefined): string => {
        return String(value || '')
            .toLowerCase()
            .replace(/^linje\s+/i, '')
            .replace(/^line\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim();
    };
    const normDest = normalizeLineToken(dest);
    const normLineFinal = normalizeLineToken(lineFinal);
    const normVehicleLine = normalizeLineToken(v.line);
    if (
        !normDest ||
        normDest === '?' ||
        normDest === normLineFinal ||
        normDest === normVehicleLine
    ) {
        dest = '';
    }

    let title = '';

    // "EJ I TRAFIK" endast när destinationstexten uttryckligen säger det – inte när vi bara saknar rad/dest (t.ex. efter att "Ej linjesatt" rensats).
    const isExplicitlyNotInService = dest && /Ej i trafik|Depå|Inställd|Ej linjesatt|Linjesatt|Tomkörning/i.test(dest);

    if (isExplicitlyNotInService) {
        title = 'EJ I TRAFIK';
    } else if (!dest || dest === '?') {
        // Better fallback hierarchy när destination saknas:
        // 1) Nästa hållplats, 2) Linje, 3) Generisk titel.
        if (nextStopName) {
            title = `Mot ${nextStopName}`;
        } else if (lineFinal && lineFinal !== '?') {
            title = `Linje ${lineFinal}`;
        } else if (v.line && v.line !== '?') {
            title = `Linje ${v.line}`;
        } else {
            title = 'Fordonsinformation';
        }
    } else {
        title = `Mot ${dest}`;
    }

    // Next stop: visa bara läsbart namn. Förbjudet att visa "—" – använd "I tid" eller nästa hållplats.
    let next: string;
    if (nextStopName) {
        next = `Nästa: ${nextStopName}`;
    } else {
        next = 'I tid'; // Statusrad: grön prick + "I tid" när nästa hållplats saknas (aldrig "—")
    }

    const chips: Chip[] = [];

    // Speed
    if (v.speed !== undefined && v.speed !== null) {
        chips.push({ label: 'hastighet', value: `${Math.round(v.speed)} km/h` });
    } else {
        chips.push({ label: 'hastighet', value: `0 km/h` });
    }

    let rawId = getRawVehicleId(v);
    let operatorName = v.operator;
    const externalVehicleData = findExternalVehicleData(v);

    if (rawId && rawId !== 'unknown') {
        chips.push({ label: 'fordons-id', value: String(rawId) });
        if (isLikelyTrainVehicle(v)) {
            const trainNo = getTrainNumberFromVehicleId(v);
            if (trainNo) chips.push({ label: 'TÅGNR', value: trainNo });
        }
    }

    if (externalVehicleData) {
        if (externalVehicleData.plate) chips.push({ label: 'REG', value: externalVehicleData.plate });
        if (externalVehicleData.model) chips.push({ label: 'FORDON', value: externalVehicleData.model });
        if (externalVehicleData.alternativeId) chips.push({ label: 'ALT-ID', value: externalVehicleData.alternativeId });
        if (externalVehicleData.operator) operatorName = externalVehicleData.operator;
    }

    // Fallback known names for common codes
    const nameMap: Record<string, string> = {
        'sl': 'SL', 'vasttrafik': 'Västtrafik', 'skane': 'Skånetrafiken',
        'ul': 'UL', 'otraf': 'Östgötatrafiken', 'jlt': 'JLT',
        'klt': 'KLT', 'varm': 'Värmlandstrafik', 'orebro': 'Länstrafiken Örebro',
        'xt': 'X-trafik', 'dt': 'Dalatrafik', 'halland': 'Hallandstrafiken'
    };

    if (operatorName && operatorName !== 'sweden') {
        const operatorKey = String(operatorName).toLowerCase().trim();
        const niceOp = nameMap[operatorKey] || String(operatorName).trim();
        chips.push({ label: 'OPERATÖR', value: niceOp });
    }

    // Track stationary / stale vehicles (> 30 minutes without a position update)
    if (v.timestamp) {
        const timeDiffSeconds = (Date.now() / 1000) - v.timestamp;
        if (timeDiffSeconds > 1800) { // 30 mins
            const date = new Date(v.timestamp * 1000);
            chips.push({
                label: 'senast uppdaterad',
                value: date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
            });
        }
    }

    // Delay status from TripUpdates
    if (delaySeconds != null) {
        if (delaySeconds > 60) {
            const mins = Math.round(delaySeconds / 60);
            chips.push({ label: 'TURSTATUS', value: `⚠️ ${mins} min sen` });
        } else if (delaySeconds < -60) {
            const mins = Math.abs(Math.round(delaySeconds / 60));
            chips.push({ label: 'TURSTATUS', value: `⏩ ${mins} min tidig` });
        } else {
            chips.push({ label: 'TURSTATUS', value: '✅ I tid' });
        }
    }

    return {
        title: title,
        subtitle: title === 'EJ I TRAFIK' ? 'Ej linjesatt' : next,
        lineNumber: lineFinal,
        lineColor: lineColor || defaultColor,
        chips
    };
};

// ── Vehicle Info Popup – renders above vehicle icon on the map ──────────────
const VehicleInfoPopup = ({ vehicle, panel, numColor, nextStopDisplay, nextPlatform, destinationText, gtfsLoading, onClose, mapRef }: {
    vehicle: any;
    panel: CompactPanel;
    numColor: string;
    nextStopDisplay: string | null;
    nextPlatform: string | null;
    destinationText: string | null;
    gtfsLoading: boolean;
    onClose: () => void;
    mapRef: L.Map | null;
}) => {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (!mapRef || !vehicle) return;

        const updatePosition = () => {
            const point = mapRef.latLngToContainerPoint([vehicle.lat, vehicle.lng]);
            setPos({ x: point.x, y: point.y });
        };

        updatePosition();
        mapRef.on('move zoom moveend zoomend', updatePosition);
        return () => {
            mapRef.off('move zoom moveend zoomend', updatePosition);
        };
    }, [mapRef, vehicle?.lat, vehicle?.lng]);

    if (!pos) return null;

    const panelWidth = 248;
    const left = pos.x - panelWidth / 2;
    const top = pos.y - 38;

    return (
        <div
            className="absolute z-[500] pointer-events-none"
            style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${panelWidth}px`,
                transform: 'translateY(-100%)',
                transition: 'left 0.15s ease-out, top 0.15s ease-out',
            }}
        >
            <div className="pointer-events-auto relative overflow-hidden rounded-xl shadow-md dark:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)] border border-slate-200/50 dark:border-white/10 backdrop-blur-xl bg-white/95 dark:bg-[#0f172a]/95 ring-1 ring-black/5 p-2.5">
                <div className="flex flex-col relative z-10 w-full gap-1.5">
                    <div className="flex items-center gap-2 w-full relative pr-6">
                        <div
                            className="h-8 min-w-[40px] px-1.5 rounded-md flex items-center justify-center font-bold text-sm leading-none shadow-sm shrink-0 border border-white/20"
                            style={{ backgroundColor: panel.lineColor, color: numColor }}
                        >
                            {panel.lineNumber}
                        </div>
                        <div className="font-bold text-slate-800 dark:text-white text-[13px] leading-tight flex-1 min-w-0 pr-2 break-words whitespace-normal">
                            {panel.title}
                        </div>
                        <button
                            onClick={onClose}
                            className="absolute top-1/2 -translate-y-1/2 -right-0.5 w-5 h-5 shrink-0 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition-all active:scale-90"
                        >
                            <FontAwesomeIcon icon={faXmark} className="text-xs" />
                        </button>
                    </div>
                    {destinationText && (
                        <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300 text-[11px] font-medium w-full pr-2">
                            <span className="text-slate-400 dark:text-slate-500 shrink-0">Destination</span>
                            <span className="truncate">{destinationText.startsWith('Mot ') ? destinationText : `Mot ${destinationText}`}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 text-[11px] font-medium w-full pr-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="I tid" />
                        <span className="truncate">{panel.subtitle}</span>
                    </div>
                    {nextStopDisplay && !nextStopDisplay.startsWith('Hållplats ') && (
                        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-[10px] pl-0.5">
                            <span>📍</span>
                            <span className="truncate">
                                {nextStopDisplay}
                                {nextPlatform ? ` · ${nextPlatform}` : ''}
                            </span>
                        </div>
                    )}
                    <div className="w-full h-px bg-slate-200 dark:bg-slate-700 my-1" />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {gtfsLoading ? (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0">
                                <FontAwesomeIcon icon={faSpinner} className="animate-spin text-sky-500 text-[10px]" />
                                <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300">Hämtar</span>
                            </div>
                        ) : (
                            panel.chips.map((chip, i) => (
                                <div key={i} className="flex flex-col shrink-0">
                                    <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{chip.label}</span>
                                    <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-0.5 mt-0.5">
                                        {chip.label.toLowerCase() === 'operatör' && <span className="text-[9px] opacity-80">🏢</span>}
                                        {chip.label === 'TURSTATUS' && chip.value === '✅ I tid' ? (
                                            <span className="text-emerald-600 dark:text-emerald-400">{chip.value}</span>
                                        ) : (
                                            chip.value
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            <div className="flex justify-center -mt-px">
                <div className="w-2.5 h-2.5 bg-white/95 dark:bg-[#0f172a]/95 border-r border-b border-slate-200/50 dark:border-white/10 rotate-45 -translate-y-1" />
            </div>
        </div>
    );
};

// ── Memoized Vehicle Marker
const VehicleMarker = React.memo(({ v, onSelect, simpleMode, showLabels, lineOverride, titleOverride, colorOverride, typeOverride, nextStop, delayOverride }:
    { v: any, onSelect: (v: any) => void, simpleMode: boolean, showLabels: boolean, lineOverride?: string, titleOverride?: string, colorOverride?: string, typeOverride?: number, nextStop?: { name: string, time?: string }, delayOverride?: number | null }) => {
    // Determine label: either line number (resolved) or just '?'
    let lineLabel = lineOverride || v.line || '?';

    const rawDest = titleOverride || v.dest || '';
    const isExplicitlyNotInService = /Ej i trafik|Depå|Inställd|Ej linjesatt|Tomkörning/i.test(rawDest);

    // Hide line numbers if standing still/not in service
    if (isExplicitlyNotInService || lineLabel === '?') {
        lineLabel = '-';
    }
    // Visa inte linjenummer som påtvingade 2-siffror (01, 03) – normalisera till 1, 3, 30, 103 osv.
    lineLabel = normalizeLineDisplay(lineLabel);

    // Resolve mode based on typeOverride (GTFS route_type) or fallback
    let mode = v.transportMode ?? 'BUS'; // 1 = Metro, handled below via mapService transportMode map or direct typeOverride
    if (typeOverride !== undefined) {
        switch (typeOverride) {
            case 0: mode = 'TRAM'; break;
            case 1: mode = 'METRO'; break;
            case 2:
            case 109: mode = 'TRAIN'; break;
            case 3:
            case 700: mode = 'BUS'; break;
            case 4:
            case 1000: mode = 'FERRY'; break;
        }
    }

    const color = colorOverride || v.bgColor || (mode === 'TRAM' || mode === 'METRO' ? '#14b8a6' : mode === 'TRAIN' ? '#d946ef' : '#0ea5e9');

    const hasDestination = titleOverride && titleOverride.startsWith('Mot ');
    const tooltipText = hasDestination ? `Linje ${lineLabel} · ${titleOverride}` : (titleOverride || `Linje ${lineLabel}`);
    const destForIcon = hasDestination ? titleOverride : (titleOverride && !titleOverride.startsWith('Linje ') && !titleOverride.startsWith('Tåg ') ? titleOverride : undefined);

    if (simpleMode) {
        return (
            <CircleMarker
                center={[v.lat, v.lng]}
                radius={3}
                pathOptions={{ fillColor: color, color: '#fff', weight: 1, opacity: 0.8, fillOpacity: 1 }}
                eventHandlers={{ click: () => onSelect(v) }}
            >
                <Tooltip permanent={false} direction="top">{tooltipText}</Tooltip>
                {titleOverride && <Popup>{titleOverride}</Popup>}
            </CircleMarker>
        );
    }

    return (
        <AnimatedMarker
            position={[v.lat, v.lng]}
            icon={getIcon(lineLabel, v.bearing ?? 0, mode, color, v.operator, destForIcon, delayOverride)}
            eventHandlers={{ click: () => onSelect(v) }}
            title={tooltipText}
            speed={v.speed}
            bearing={v.bearing ?? 0}
        >
            <Tooltip permanent={false} direction="top">{tooltipText}</Tooltip>
        </AnimatedMarker>
    );
}, (prev, next) =>
    prev.v.id === next.v.id &&
    prev.v.lat === next.v.lat &&
    prev.v.lng === next.v.lng &&
    prev.v.bearing === next.v.bearing &&
    prev.simpleMode === next.simpleMode &&
    prev.lineOverride === next.lineOverride &&
    prev.delayOverride === next.delayOverride &&
    prev.titleOverride === next.titleOverride &&
    prev.colorOverride === next.colorOverride &&
    prev.nextStop?.name === next.nextStop?.name
);

// ── Map Events Controller
import { MapService } from '../services/mapService';

// ── Map Events Controller
const MapEvents = ({ setVehicles, setStops, setParkings, setDisruptions, selectedOperator, setZoom, setIsLoading, setFollowUser, refreshVehiclesTrigger, onGtfsStaticLoaded }: {
    setVehicles: (v: any[]) => void,
    setStops: (s: any[]) => void,
    setParkings: (p: any[]) => void,
    setDisruptions: (d: any[]) => void,
    selectedOperator?: string,
    setZoom: (z: number) => void,
    setIsLoading: (l: boolean) => void,
    setFollowUser?: (v: boolean) => void,
    refreshVehiclesTrigger?: number,
    onGtfsStaticLoaded?: () => void
}) => {
    const map = useMap();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchCountRef = useRef(0);
    const vehicleCacheRef = useRef<{ data: any[]; timestamp: number }>({ data: [], timestamp: 0 });

    useEffect(() => {
        if (selectedOperator) {
            setVehicles([]);
            vehicleCacheRef.current = { data: [], timestamp: 0 };
            const op = TRAFIKLAB_OPERATORS.find(o => o.id === selectedOperator);
            if (op && op.lat && op.lng) map.setView([op.lat, op.lng], 9);
        }
    }, [selectedOperator, map]);

    // GTFS Sweden 3 Static – en request per 23h, linjedata för alla län; refetch vehicles when loaded so lines resolve
    useEffect(() => {
        GtfsSwedenStaticService.preload();
        if (onGtfsStaticLoaded) GtfsSwedenStaticService.onGtfsSwedenStaticLoaded(onGtfsStaticLoaded);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Smart Regional Preloading ──────────────────────────────────────────────
    // Automatically load NeTEx static data for the region in view so line badges + destinations appear.
    useEffect(() => {
        const checkRegion = () => {
            const center = map.getCenter();
            const lat = center.lat;
            const lng = center.lng;

            // Trigger preload for operator whose region covers the map center
            if (lat > 58.7 && lat < 60.3 && lng > 17.0 && lng < 19.5) GtfsShapeService.preload('sl');
            if (lat > 59.2 && lat < 60.7 && lng > 16.9 && lng < 18.2) GtfsShapeService.preload('ul');
            if (lat > 55.2 && lat < 56.5 && lng > 12.4 && lng < 14.6) GtfsShapeService.preload('skane');
            if (lat > 57.0 && lat < 59.0 && lng > 11.0 && lng < 13.5) GtfsShapeService.preload('vasttrafik');
            if (lat > 57.1 && lat < 58.2 && lng > 13.5 && lng < 15.6) GtfsShapeService.preload('jlt');       // Jönköping ← SAKNADES!
            if (lat > 57.7 && lat < 58.9 && lng > 14.5 && lng < 16.9) GtfsShapeService.preload('otraf');     // Östergötland
            if (lat > 58.6 && lat < 60.2 && lng > 14.1 && lng < 15.9) GtfsShapeService.preload('orebro');
            if (lat > 59.1 && lat < 60.3 && lng > 15.4 && lng < 17.5) GtfsShapeService.preload('vastmanland');
            if (lat > 59.0 && lat < 61.0 && lng > 12.0 && lng < 14.3) GtfsShapeService.preload('varm');
            if (lat > 60.0 && lat < 62.3 && lng > 13.0 && lng < 16.8) GtfsShapeService.preload('dt');
            if (lat > 60.2 && lat < 62.3 && lng > 16.0 && lng < 17.8) GtfsShapeService.preload('xt');
            if (lat > 56.3 && lat < 57.6 && lng > 11.8 && lng < 13.5) GtfsShapeService.preload('halland');
            if (lat > 56.4 && lat < 57.2 && lng > 13.5 && lng < 15.6) GtfsShapeService.preload('krono');     // Kronoberg
            if (lat > 56.2 && lat < 58.0 && lng > 15.5 && lng < 17.2) GtfsShapeService.preload('klt');       // Kalmar
            if (lat > 58.6 && lat < 59.6 && lng > 15.8 && lng < 17.6) GtfsShapeService.preload('sormland');
            if (lat > 56.0 && lat < 56.5 && lng > 14.5 && lng < 16.0) GtfsShapeService.preload('blekinge');
            if (lat > 62.0 && lat < 64.0 && lng > 16.0 && lng < 19.5) GtfsShapeService.preload('dintur');
        };

        map.on('moveend', checkRegion);
        checkRegion(); // Initial check on mount

        return () => {
            map.off('moveend', checkRegion);
        };
    }, [map]);

    // ── Preload NeTEx when operator is explicitly selected from dropdown ─────────
    useEffect(() => {
        if (selectedOperator && selectedOperator !== 'sweden') {
            GtfsShapeService.preload(selectedOperator);
        }
    }, [selectedOperator]);

    const fetchMapData = async () => {
        setIsLoading(true);
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        setZoom(zoom);
        fetchCountRef.current++;

        try {
            if (zoom > 8) {
                const now = Date.now();
                const cacheFresh = vehicleCacheRef.current.timestamp > 0 && (now - vehicleCacheRef.current.timestamp) < VEHICLE_CACHE_TTL_MS;
                let vehicleData: any[];
                if (cacheFresh && vehicleCacheRef.current.data.length >= 0) {
                    vehicleData = vehicleCacheRef.current.data;
                    setVehicles(vehicleData);
                } else {
                    vehicleData = await MapService.getVehiclePositions(
                        bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast(), selectedOperator
                    );
                    vehicleCacheRef.current = { data: vehicleData || [], timestamp: now };
                    setVehicles(vehicleData || []);

                    // Feed LiveLineResolver for real-time destination tracking
                    if (vehicleData) LiveLineResolver.feedVehicles(vehicleData);
                }

                // Fetch stops (no zoom limit, "gör de ändå!")
                if (zoom > 12) {
                    const opArray = ['sl', 'skane', 'vasttrafik', 'ul', 'otraf', 'jlt', 'krono', 'klt', 'gotland', 'varm', 'orebro', 'vastmanland', 'dt', 'xt', 'dintur', 'halland'];
                    let allStops: any[] = [];
                    for (const op of opArray) {
                        if (GtfsShapeService.isLoaded(op)) {
                            const opStops = GtfsShapeService.getAllStops(op, bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast());
                            allStops = allStops.concat(opStops);
                        }
                    }

                    if (allStops.length > 0) {
                        setStops(allStops);
                    } else if (zoom > 14) {
                        // Fallback to Västtrafik API only if GTFS isn't preloaded yet and we are tightly zoomed
                        const stopData = await MapService.getMapStopAreas(
                            bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()
                        );
                        setStops(stopData || []);
                    } else {
                        setStops([]);
                    }
                } else {
                    setStops([]);
                }

                // Parkings (Västtrafik SPP – aktiverad)
                if (zoom > 13) {
                    const parkingData = await MapService.getParkings(
                        bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()
                    );
                    setParkings(parkingData || []);
                }
            }
            // Disruptions only every ~60s (every 6th call)
            if (fetchCountRef.current % 6 === 1) {
                const disruptions = await MapService.getDisruptions();
                setDisruptions(disruptions || []);
            }
        } catch (e) {
            console.error('Map Data Fetch Error', e);
        } finally {
            setIsLoading(false);
        }
    };

    const debouncedFetch = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(fetchMapData, 150);
    };

    const onMoveEnd = () => {
        debouncedFetch();
        setFollowUser?.(false);
    };

    useEffect(() => {
        fetchMapData();
        const interval = setInterval(fetchMapData, REFRESH_INTERVAL);
        map.on('moveend', onMoveEnd);
        return () => {
            clearInterval(interval);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            map.off('moveend', onMoveEnd);
        };
    }, [map, selectedOperator, refreshVehiclesTrigger]);

    return null;
};

// ── Map Ref Capture – stores the Leaflet map instance for use outside MapContainer ──
const MapRefCapture = ({ setMapRef }: { setMapRef: (map: L.Map) => void }) => {
    const map = useMap();
    useEffect(() => { setMapRef(map); }, [map, setMapRef]);
    return null;
};

// ── Main LiveMap Component
export const LiveMap = () => {
    const { regionId } = useParams<{ regionId?: string }>();
    const [vehicles, setVehicles] = useState<any[]>([]);
    const [stops, setStops] = useState<any[]>([]);
    const [parkings, setParkings] = useState<any[]>([]);
    const [disruptions, setDisruptions] = useState<any[]>([]);
    const [selectedParking, setSelectedParking] = useState<any | null>(null);
    const [parkingImage, setParkingImage] = useState<string | null>(null);
    const [selectedOperator, setSelectedOperator] = useState<string>(regionId || 'sweden');

    useEffect(() => {
        if (regionId && TRAFIKLAB_OPERATORS.some(o => o.id === regionId)) {
            setSelectedOperator(regionId);
        }
    }, [regionId]);

    const [zoom, setZoom] = useState<number>(13);
    const [activeFilters, setActiveFilters] = useState<string[]>(['BUS', 'TRAM', 'METRO', 'TRAIN', 'FERRY']);
    const [hideDepot, setHideDepot] = useState(false); // Default: visa alla fordon (inkl. depå)
    const [showLabels, setShowLabels] = useState(false); // Toggle for showing vehicle IDs
    const [showLayers, setShowLayers] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
    const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
    const [journeyPath, setJourneyPath] = useState<[number, number][]>([]);
    const [journeyColorState, setJourneyColorState] = useState<string>('#0ea5e9');
    const [journeyStops, setJourneyStops] = useState<{ coords: { lat: number, lng: number }, name: string, time?: string, platformCode?: string }[]>([]);
    const [networkShapes, setNetworkShapes] = useState<Record<string, { points: [number, number][][], color: string, mode: string, publicCode: string }>>({});
    const [isNetworkLoading, setIsNetworkLoading] = useState(false);
    const [gtfsPayload, setGtfsPayload] = useState<VehicleRoutePayload | null>(null);
    const [gtfsLoading, setGtfsLoading] = useState(false);
    const [nextStopCache, setNextStopCache] = useState<Record<string, { name: string, time?: string }>>({});
    const [destinationCache, setDestinationCache] = useState<Record<string, string>>({});
    const [mapMode, setMapMode] = useState<'light' | 'dark' | 'satellite' | 'hybrid'>('light'); // Kartläge
    const [searchQuery, setSearchQuery] = useState<string>(''); // Sökning på internummer
    const [mapRef, setMapRef] = useState<L.Map | null>(null);
    const [tripDelay, setTripDelay] = useState<number | null>(null);
    const [resolvedNextStop, setResolvedNextStop] = useState<string | null>(null);
    const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
    const [userPositionError, setUserPositionError] = useState<string | null>(null);
    const [followUser, setFollowUser] = useState(false);
    const [refreshVehiclesTrigger, setRefreshVehiclesTrigger] = useState(0);
    const [gtfsDestinationIndexes, setGtfsDestinationIndexes] = useState<GtfsIndexes | null>(null);

    const [gtfsCounter, setGtfsCounter] = useState(0);

    // Ladda static GTFS-index för destination (trips, stop_times, stops) – används av resolveDestination
    useEffect(() => {
        GtfsDestinationService.loadGtfsIndexes().then(setGtfsDestinationIndexes);
    }, []);

    // Uppdatera popupens position och koppling till rätt fordon vid varje fordonsrefresh (popup följer fordonet)
    const updateVehiclePopup = React.useCallback(
        (vehicleId: string, newLatLng: { lat: number; lng: number }, _resolvedDestination: string) => {
            setSelectedVehicle((prev: any) => {
                if (!prev || prev.id !== vehicleId) return prev;
                return { ...prev, lat: newLatLng.lat, lng: newLatLng.lng };
            });
        },
        []
    );

    useEffect(() => {
        if (!selectedVehicle || vehicles.length === 0) return;
        const live = vehicles.find((v) => v.id === selectedVehicle.id);
        if (live && (live.lat !== selectedVehicle.lat || live.lng !== selectedVehicle.lng)) {
            updateVehiclePopup(selectedVehicle.id, { lat: live.lat, lng: live.lng }, '');
        }
    }, [vehicles, selectedVehicle?.id, updateVehiclePopup]);

    // Fyll TripUpdates-cache när popup öppnas så resolveDestination får realtime headsign/lastStopId
    useEffect(() => {
        if (!selectedVehicle?.tripId) return;
        const op = selectedVehicle.operator || selectedOperator;
        TrafiklabService.getTripUpdate(op, selectedVehicle.tripId).catch(() => {});
    }, [selectedVehicle?.id, selectedVehicle?.tripId, selectedVehicle?.operator, selectedOperator]);

    // Register progress callback to re-render when static data finishes indexing
    useEffect(() => {
        const handleProgress = () => {
            setGtfsCounter(c => c + 1);
        };
        GtfsShapeService.onProgress(handleProgress);
    }, []);

    // ── Användarposition (geolokalisering) ──
    useEffect(() => {
        if (!navigator.geolocation) {
            setUserPositionError('Geolokalisering stöds inte');
            return;
        }
        setUserPositionError(null);

        const onSuccess = (pos: GeolocationPosition) => {
            setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setUserPositionError(null);
        };
        const onError = (err: GeolocationPositionError) => {
            setUserPositionError(err.code === 1 ? 'Tillåt plats i webbläsaren' : 'Kunde inte hämta position');
        };

        const watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
            enableHighAccuracy: true,
            maximumAge: 15000,
            timeout: 10000
        });
        return () => navigator.geolocation.clearWatch(watchId);
    }, []);

    // Följ användaren när followUser är på
    useEffect(() => {
        if (!followUser || !mapRef || !userPosition) return;
        mapRef.setView([userPosition.lat, userPosition.lng], mapRef.getZoom());
    }, [followUser, mapRef, userPosition?.lat, userPosition?.lng]);

    // ── Load Full Network Shapes ────────────────────────────────────────────────
    useEffect(() => {
        let active = true;
        const loadNetwork = async () => {
            if (!selectedOperator || selectedOperator === 'sweden') {
                setNetworkShapes({});
                return;
            }

            // Wait for static data to be indexed
            let attempts = 0;
            while (!GtfsShapeService.isLoaded(selectedOperator) && attempts < 20) {
                await new Promise(r => setTimeout(r, 2000));
                attempts++;
                if (!active) return;
            }

            if (GtfsShapeService.isLoaded(selectedOperator)) {
                setIsNetworkLoading(true);
                try {
                    const shapes = await GtfsShapeService.getAllNetworkShapes(selectedOperator);
                    if (active) setNetworkShapes(shapes);
                } catch (e) {
                    console.error('[Network] Load failed', e);
                } finally {
                    if (active) setIsNetworkLoading(false);
                }
            }
        };

        loadNetwork();
        return () => { active = false; };
    }, [selectedOperator]);

    // Sync dark mode with html class
    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDark(document.documentElement.classList.contains('dark'));
        });
        observer.observe(document.documentElement, { attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const [gtfsRouteMaps, setGtfsRouteMaps] = useState<Record<string, Map<string, string>>>({});

    // ── Aggressive GTFS Preloading & Route Map Fetching ────────────────────────
    useEffect(() => {
        if (vehicles.length === 0) return;

        const operators = Array.from(new Set(
            vehicles.flatMap(v => getOperatorCandidates(v, selectedOperator))
        ));

        // 1. Trigger preload for all relevant operators on screen.
        // For a specific region: preload that operator.
        // For 'sweden' mode: preload each unique operator actually present in the vehicle list (max 4 at a time).
        if (selectedOperator && selectedOperator !== 'sweden' && SUPPORTED_STATIC_OPERATORS.has(selectedOperator)) {
            GtfsShapeService.preload(selectedOperator);
        } else if (selectedOperator === 'sweden') {
            // Preload the operators present in the current vehicle set (capped to avoid rate limits)
            const uniqueOps = Array.from(new Set(
                vehicles
                    .map(v => String(v?.operator || '').toLowerCase())
                    .filter(op => op && SUPPORTED_STATIC_OPERATORS.has(op))
            )).slice(0, 4); // Max 4 at a time to avoid API rate limits
            uniqueOps.forEach(op => GtfsShapeService.preload(op));
        }

        // 2. Poll for route maps (so line numbers appear ASAP)
        const checkMaps = () => {
            setGtfsRouteMaps(prev => {
                const next = { ...prev };
                let changed = false;
                operators.forEach(op => {
                    if (!next[op]) {
                        const m = GtfsShapeService.getRouteMap(op);
                        if (m && m.size > 0) {
                            next[op] = m;
                            changed = true;
                        }
                    }
                });
                return changed ? next : prev;
            });
        };

        const poller = setInterval(checkMaps, 1000); // Check every second until loaded
        checkMaps(); // Check immediately

        return () => clearInterval(poller);
    }, [vehicles, selectedOperator]); // Re-run when vehicle list or selected operator updates

    // ── Fetch Next Stop for Vehicles (especially JLT) ────────────────────────────
    useEffect(() => {
        if (vehicles.length === 0) return;

        // Prioritize JLT vehicles for next stop fetching
        const jltVehicles = vehicles.filter(v => v.operator === 'jlt' && v.tripId);
        const otherVehicles = vehicles.filter(v => v.operator !== 'jlt' && v.tripId && !v.nextStopName);

        const vehiclesToFetch = [...jltVehicles, ...otherVehicles].slice(0, 15); // Limit to avoid too many requests

        vehiclesToFetch.forEach(v => {
            if (nextStopCache[v.tripId]) return; // Already cached

            try {
                // Get destination info from GTFS using tripId
                const ops = getOperatorCandidates(v, selectedOperator);
                const lineInfo = ops.map(op => GtfsShapeService.getLineInfo(op, v.tripId, v.routeId)).find(Boolean);

                if (lineInfo && lineInfo.headsign) {
                    setNextStopCache(prev => ({
                        ...prev,
                        [v.tripId]: {
                            name: `Mot ${lineInfo.headsign}`,
                            time: undefined
                        }
                    }));
                }
            } catch (err) {
                console.warn(`[NextStop] Failed to fetch for ${v.tripId}`, err);
            }
        });
    }, [vehicles, selectedOperator]); // Re-run when vehicles/operator changes

    // ── Destination från TripUpdates (lastStopId → namn) + cache ──
    // Först ladda TripUpdates per operatör (ett anrop per op fyller cachen med alla resor), sedan lös lastStopId → namn.
    useEffect(() => {
        const operatorsNeedingTu = Array.from(new Set(vehicles.filter(v => v.tripId && v.operator).map(v => v.operator as string)));

        (async () => {
            for (const op of operatorsNeedingTu) {
                if (!op || op === 'sweden' || op === 'entur') continue;
                const one = vehicles.find(v => v.operator === op && v.tripId);
                if (one) await TrafiklabService.getTripUpdate(op, one.tripId!).catch(() => {});
            }

            const needDest = vehicles.filter(v => v.tripId && (!v.dest || isUselessDestination(v.dest, v.line)));
            const stopIdsToPrefetch: string[] = [];
            const toResolve: { tripId: string; lastStopId: string; op: string }[] = [];

            for (const v of needDest) {
                const op = v.operator || selectedOperator;
                const lastStopId = TrafiklabService.getTripLastStopIdFromCache(op, v.tripId);
                if (!lastStopId) continue;
                const cached = getCachedStopName(lastStopId);
                if (cached && !GtfsDestinationService.isForbiddenDestination(cached)) {
                    setDestinationCache(prev => (prev[v.tripId] === cached ? prev : { ...prev, [v.tripId]: cached }));
                } else if (!cached) {
                    stopIdsToPrefetch.push(lastStopId);
                    toResolve.push({ tripId: v.tripId, lastStopId, op });
                }
            }
            prefetchStopNames(stopIdsToPrefetch);

            toResolve.slice(0, 30).forEach(({ tripId, lastStopId }) => {
                resolveStopName(lastStopId).then(name => {
                    if (name && !GtfsDestinationService.isForbiddenDestination(name)) {
                        setDestinationCache(prev => (prev[tripId] === name ? prev : { ...prev, [tripId]: name }));
                    }
                });
            });
        })();
    }, [vehicles, selectedOperator]);

    const toggleDark = () => {

        const next = !document.documentElement.classList.contains('dark');
        if (next) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', next ? 'dark' : 'light');
    };

    const toggleFilter = (mode: string) => {
        setActiveFilters(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]);
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => setIsFullscreen(true));
        } else {
            document.exitFullscreen().then(() => setIsFullscreen(false));
        }
    };

    const handleSelectVehicle = async (v: any) => {
        setSelectedVehicle(v);
        setJourneyStops([]);
        setGtfsPayload(null);
        setGtfsLoading(false);
        setTripDelay(null);
        setResolvedNextStop(null);

        // ── Fetch TripUpdates for delay info + next stop + destination (last stop) ──
        if (v.tripId && v.operator) {
            TrafiklabService.getTripUpdate(v.operator, v.tripId).then(async tu => {
                if (tu) {
                    if (tu.delay != null) setTripDelay(tu.delay);
                    // Resolve next stop name
                    if (tu.nextStopId) {
                        const name = await resolveStopName(tu.nextStopId);
                        if (name) setResolvedNextStop(name);
                    }
                    // Resolve destination (last stop) so popup can show it – skriv aldrig "—" eller "Ej angiven hållplats"
                    if (tu.lastStopId) {
                        const destName = await resolveStopName(tu.lastStopId);
                        if (destName && !GtfsDestinationService.isForbiddenDestination(destName)) {
                            setDestinationCache(prev => (prev[v.tripId] === destName ? prev : { ...prev, [v.tripId]: destName }));
                        }
                    }
                }
            }).catch(() => { });
        }

        // Also resolve from vehicle's own stopId
        if (v.stopId) {
            resolveStopName(v.stopId).then(name => {
                if (name) setResolvedNextStop(prev => prev || name);
            }).catch(() => { });
        }

        // ── Instant full route from network shapes ──
        // Try to find the full network shape for this line (already pre-loaded)
        const lineCode = v.line || '?';
        let foundNetworkRoute = false;
        if (lineCode !== '?' && Object.keys(networkShapes).length > 0) {
            // Find matching shape by publicCode
            const matchingShape = Object.values(networkShapes).find(
                s => s.publicCode === lineCode
            );
            if (matchingShape && matchingShape.points.length > 0) {
                // Concatenate ALL segments for the full route
                const allCoords = matchingShape.points.flatMap(seg => seg);
                if (allCoords.length >= 2) {
                    setJourneyPath(allCoords);
                    foundNetworkRoute = true;
                }
            }
        }

        if (!foundNetworkRoute) {
            // Fallback: reconstruct from sibling vehicles
            const siblingPath = buildSiblingRoute(v, vehicles);
            if (siblingPath.length >= 2) {
                setJourneyPath(siblingPath);
            } else {
                setJourneyPath(createRouteStub(v.lat, v.lng, v.bearing ?? 0));
            }
        }

        // ── Path A: Västtrafik V4 logic removed ──
        // Users requested total decoupling from Västtrafik API for the map service.
        // We now rely 100% on GTFS-RT + GTFS Static for shape and route info.


        // ── Path B: GTFS-RT (tripId / routeId) → static GTFS shape + route info ─
        if (v.tripId || v.routeId) {
            setGtfsLoading(true);
            try {
                const ops = getOperatorCandidates(v, selectedOperator);
                let bestPayload: VehicleRoutePayload | null = null;
                let bestScore = -1;

                for (const op of ops) {
                    const payload = await GtfsShapeService.resolve(
                        v.tripId,
                        v.routeId,
                        op,
                        v.stopId,
                        v.dest,
                        v.stopSequence,
                        v.lat,
                        v.lng
                    );
                    const score =
                        ((payload.shape?.coordinates?.length || 0) >= 2 ? 3 : 0) +
                        (payload.destination ? 2 : 0) +
                        (payload.line ? 1 : 0);
                    if (score > bestScore) {
                        bestScore = score;
                        bestPayload = payload;
                    }
                    if (score >= 6) break;
                }

                if (!bestPayload) return;
                setGtfsPayload(bestPayload);

                const stopCoords = (bestPayload.journeyStops || [])
                    .filter((s: any) => typeof s.lat === 'number' && typeof s.lng === 'number')
                    .map((s: any) => [s.lat, s.lng] as [number, number]);

                if (bestPayload.shape && bestPayload.shape.coordinates.length >= 2) {
                    setJourneyPath(bestPayload.shape.coordinates);
                } else if (stopCoords.length >= 2) {
                    setJourneyPath(stopCoords);
                }

                if (bestPayload.journeyStops) {
                    setJourneyStops(bestPayload.journeyStops.map((s: any) => ({
                        coords: { lat: s.lat, lng: s.lng },
                        name: s.name,
                        time: s.arrivalTime,
                        platformCode: s.platformCode
                    })));
                }
                if (bestPayload.resolutionNotes.length > 0) {
                    console.log('[GtfsShape] Notes:', bestPayload.resolutionNotes);
                }
            } catch (e) {
                console.error('Failed to load GTFS shape', e);
            } finally {
                setGtfsLoading(false);
            }
        }
    };

    // När användaren klickar på ett fordon: ladda nätverkslinjer för operatören om vi inte redan har rutten (t.ex. vid "Sverige"-vy)
    useEffect(() => {
        const v = selectedVehicle;
        if (!v?.operator || !v?.line || v.line === '?') return;
        const lineCode = String(v.line).trim();
        const hasMatchingShape = Object.values(networkShapes).some(s => s.publicCode === lineCode);
        if (hasMatchingShape) return; // redan ritad från networkShapes

        let cancelled = false;
        (async () => {
            if (!GtfsShapeService.isLoaded(v.operator)) GtfsShapeService.preload(v.operator);
            let attempts = 0;
            while (!GtfsShapeService.isLoaded(v.operator) && attempts < 25 && !cancelled) {
                await new Promise(r => setTimeout(r, 400));
                attempts++;
            }
            if (cancelled) return;
            try {
                const shapes = await GtfsShapeService.getAllNetworkShapes(v.operator);
                if (cancelled) return;
                const matching = Object.values(shapes).find(s => s.publicCode === lineCode);
                if (matching?.points?.length) {
                    const coords = matching.points.flatMap(seg => seg);
                    if (coords.length >= 2) setJourneyPath(coords);
                }
            } catch (_) { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, [selectedVehicle?.id, selectedVehicle?.operator, selectedVehicle?.line, networkShapes]);

    useEffect(() => {
        if (selectedParking) {
            setParkingImage(null);
            MapService.getParkingImage(selectedParking.id, 1).then(url => {
                if (url) setParkingImage(url);
            });
        }
    }, [selectedParking]);

    const position: [number, number] = [57.70887, 11.97456];
    // Prefer GTFS route_color if available, else fall back to mode color
    const journeyColor = gtfsPayload?.routeInfo?.color
        || (selectedVehicle?.transportMode === 'TRAM' ? '#14b8a6'
            : selectedVehicle?.transportMode === 'TRAIN' ? '#d946ef'
                : selectedVehicle?.transportMode === 'FERRY' ? '#6366f1'
                    : '#0ea5e9');

    return (
        <div className="w-full h-[100dvh] md:h-full relative z-0 bg-slate-100 dark:bg-slate-900">
            <MapContainer
                center={position}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
                preferCanvas={true}
            >
                <TileLayer
                    key={`${mapMode}-${isDark ? 'dark' : 'light'}`}
                    url={
                        mapMode === 'satellite'
                            ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                            : mapMode === 'hybrid'
                                ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                                : isDark
                                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                                    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
                    }
                    attribution={
                        mapMode === 'satellite' || mapMode === 'hybrid'
                            ? '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                            : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    }
                    maxZoom={mapMode === 'satellite' || mapMode === 'hybrid' ? 18 : 20}
                />

                <MapRefCapture setMapRef={setMapRef} />

                {/* Användarposition (blå prick) */}
                {userPosition && (
                    <CircleMarker
                        center={[userPosition.lat, userPosition.lng]}
                        radius={8}
                        pathOptions={{
                            fillColor: '#3b82f6',
                            color: '#ffffff',
                            weight: 2,
                            opacity: 1,
                            fillOpacity: 1
                        }}
                    >
                        <Popup closeButton={false}>
                            <div className="font-sans text-xs font-bold text-slate-700">Din position</div>
                        </Popup>
                    </CircleMarker>
                )}

                <MapEvents
                    setVehicles={setVehicles}
                    setStops={setStops}
                    setParkings={setParkings}
                    setDisruptions={setDisruptions}
                    selectedOperator={selectedOperator}
                    setZoom={setZoom}
                    setIsLoading={setIsLoading}
                    setFollowUser={setFollowUser}
                    refreshVehiclesTrigger={refreshVehiclesTrigger}
                    onGtfsStaticLoaded={() => setRefreshVehiclesTrigger(v => v + 1)}
                />

                {/* Journey Path */}
                {journeyPath.length > 0 && (
                    <>
                        <Polyline
                            positions={journeyPath}
                            pathOptions={{ color: journeyColor, weight: 5, opacity: 0.65, lineCap: 'round' }}
                        />
                        {journeyStops.map((stop: any, idx: number) => (
                            <CircleMarker
                                key={`js-${idx}`}
                                center={[stop.coords.lat, stop.coords.lng]}
                                radius={4}
                                pathOptions={{ fillColor: '#fff', color: journeyColor, weight: 2, fillOpacity: 1 }}
                            >
                                <Popup closeButton={false}>
                                    <div className="text-center font-sans">
                                        <div className="font-bold text-xs">
                                            {stop.name} {stop.platformCode ? `(Läge ${stop.platformCode})` : ''}
                                        </div>
                                        <div className="text-[10px] text-slate-500">{stop.time}</div>
                                    </div>
                                </Popup>
                            </CircleMarker>
                        ))}
                    </>
                )}


                {/* Stops - Improved with platform information */}
                {stops.map(s => {
                    // Extract platform info from stop name (e.g., "Station A", "Stop - C", "Hub 1")
                    const platformMatch = (s.name || '').match(/\s+([A-E]|[1-9]\d*)(?:\s|$)|[-–—]\s*([A-E]|[1-9]\d*)(?:\s|$)/i);
                    const platform = platformMatch ? (platformMatch[1] || platformMatch[2]) : null;

                    // Platform colors
                    const platformColors: Record<string, string> = {
                        'A': '#3b82f6', // blue
                        'B': '#ef4444', // red
                        'C': '#10b981', // green
                        'D': '#f59e0b', // amber
                        'E': '#8b5cf6', // purple
                    };

                    const platformColor = platform && platformColors[platform.toUpperCase()]
                        ? platformColors[platform.toUpperCase()]
                        : platform ? '#6366f1' : '#94a3b8'; // indigo for numbers, slate for no platform

                    // Show larger icons at higher zoom levels
                    const size = zoom > 15 ? 28 : zoom > 14 ? 24 : 16;
                    const fontSize = zoom > 15 ? '11px' : zoom > 14 ? '9px' : '7px';

                    const icon = L.divIcon({
                        className: 'bg-transparent',
                        html: platform && zoom > 13
                            ? `<div style="width:${size}px; height:${size}px; background:${platformColor}; border:2px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:${fontSize}; font-weight:900; color:white; box-shadow:0 2px 4px rgba(0,0,0,0.3);">${platform}</div>`
                            : `<div class="w-3 h-3 bg-white border-2 transition-all" style="border-color:${platformColor};box-shadow:0 2px 4px rgba(0,0,0,0.2);border-radius:50%;"></div>`,
                        iconSize: [size, size],
                        iconAnchor: [size / 2, size / 2]
                    });

                    return (
                        <Marker
                            key={s.id}
                            position={[s.lat, s.lng]}
                            icon={icon}
                        >
                            <Popup>
                                <div className="font-sans text-xs font-bold text-slate-700">
                                    <div>{s.name}</div>
                                    {platform && <div className="text-[10px] text-slate-500 mt-1">Plattform: <span style={{ color: platformColor }} className="font-bold">{platform}</span></div>}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Parkings */}
                {parkings.map(p => (
                    <Marker
                        key={`p-${p.id}`}
                        position={[p.lat, p.lng]}
                        eventHandlers={{ click: () => setSelectedParking(p) }}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div class="w-8 h-8 bg-blue-600 rounded-lg shadow-md border-2 border-white flex items-center justify-center text-white font-bold text-sm">P</div>`,
                            iconSize: [32, 32],
                            iconAnchor: [16, 32]
                        })}
                    >
                        <Popup>
                            <div className="font-sans w-48">
                                <h3 className="font-bold text-sm mb-1">{p.name}</h3>
                                {selectedParking?.id === p.id && parkingImage && (
                                    <div className="rounded overflow-hidden mb-2 relative aspect-video bg-slate-100">
                                        <img src={parkingImage} alt="Kamera" className="w-full h-full object-cover" />
                                        <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[9px] px-1 rounded">LIVE</div>
                                    </div>
                                )}
                                <div className="text-xs text-slate-500"><span className="font-semibold">Platser:</span> {p.capacity || '?'}</div>
                            </div>
                        </Popup>
                    </Marker>
                ))}

                {/* Vehicles */}
                {vehicles
                    .filter(v => {
                        // Security check: Validate GPS coordinates to prevent off-map vehicles
                        // Valid Swedish coordinates are roughly: lat 54-70, lng 10-25
                        const isValidCoord = v.lat >= 54 && v.lat <= 71 && v.lng >= 9 && v.lng <= 25;
                        return isValidCoord;
                    })
                    .filter(v => {
                        const mode = v.transportMode || 'BUS';
                        if (activeFilters.includes(mode)) return true;
                        // Visa okända fordonsslag – filtrera inte bort dem
                        const known = ['BUS', 'TRAM', 'METRO', 'TRAIN', 'FERRY'];
                        if (!known.includes(mode)) return true;
                        return false;
                    })
                    .filter(v => {
                        // Depot filter - improved logic
                        if (!hideDepot) return true;

                        // Ett förnuftigt och säkert depåfilter som inte döljer alla fordon:
                        // Har fordonet ett 'tripId' vet vi att det är ute och kör i schemalagd trafik.
                        if (v.tripId) return true;

                        // Har den en definierad linje som inte bara är "?" eller tom, visar vi den också.
                        if (v.line && v.line !== '?') return true;

                        // I övriga fall antar vi att det är ett fordon "ur trafik" (depå).
                        return false;
                    })
                    .filter(v => {
                        // Search filter by internal number (internummer)
                        if (!searchQuery.trim()) return true;

                        const query = searchQuery.toLowerCase().trim();
                        let rawId = v.vehicleLabel || String(v.id || '').replace(/^(tl-|vt-|veh-)/, '');

                        // Search in: vehicle ID, line number, operator
                        return (
                            rawId.toLowerCase().includes(query) ||
                            (v.line && v.line.toLowerCase().includes(query)) ||
                            (v.operator && v.operator.toLowerCase().includes(query)) ||
                            (v.dest && v.dest.toLowerCase().includes(query))
                        );
                    })
                    .map(v => {
                        const opCandidates = getOperatorCandidates(v, selectedOperator);
                        // Resolve line info synchronously (fast) using cached routes/trips
                        const netexInfo = opCandidates.map(op => GtfsShapeService.getLineInfo(op, v.tripId, v.routeId)).find(Boolean);

                        // Instant fallback: LiveLineResolver (hardcoded colors + SL API)
                        const liveInfo = !netexInfo ? LiveLineResolver.resolve(v.operator || selectedOperator || 'sl', v.line || '?') : null;
                        const info = netexInfo || (liveInfo ? {
                            line: liveInfo.line,
                            longName: liveInfo.longName,
                            headsign: undefined as string | undefined,
                            color: liveInfo.color,
                            textColor: liveInfo.textColor,
                            routeType: liveInfo.mode === 'METRO' ? 1 : liveInfo.mode === 'TRAM' ? 0 : liveInfo.mode === 'TRAIN' ? 2 : liveInfo.mode === 'FERRY' ? 4 : 3,
                        } : null);

                        const likelyTrain = isLikelyTrainVehicle(v, info?.routeType);

                        // Prioritera fordonets eget linjenummer (från feed/pickLineDisplay). Örebro: använd endast v.line, ignorera NeTEx/GTFS (ger ofta fel 34).
                        const isOrebro = (v.operator || selectedOperator || '').toLowerCase() === 'orebro';
                        let resolvedLine: string | null = (v.line && looksLikeLineNumber(v.line)) ? v.line : null;
                        if (!resolvedLine && !isOrebro && info?.line && looksLikeLineNumber(info.line)) resolvedLine = info.line;
                        if (!resolvedLine || resolvedLine.trim() === '') resolvedLine = '?';
                        if (!showLabels && likelyTrain) {
                            const trainNo = getTrainNumberFromVehicleId(v);
                            if (trainNo && (!resolvedLine || resolvedLine === '?' || /^[0-9]{8,}$/.test(String(resolvedLine)))) {
                                resolvedLine = trainNo;
                            }
                        }

                        // User toggle: display last 4 digits of hardware ID instead of line number
                        if (showLabels) {
                            let rawId = getRawVehicleId(v);
                            if (rawId && rawId !== 'unknown') {
                                resolvedLine = rawId.slice(-4);
                            } else {
                                resolvedLine = 'ID?';
                            }
                        } else if (resolvedLine && resolvedLine !== '?') {
                            // Inga 2-siffriga linjesiffror: "03" → "3", "09" → "9". "34" och "103" oförändrade.
                            resolvedLine = normalizeLineDisplay(resolvedLine);
                        }

                        // Destination: GTFS Sweden 3 Static först (korrekta destinationer). Inga gamla filter ska överskugga static.
                        const sameLineAsInfo = info?.line && resolvedLine && String(info.line).trim() === String(resolvedLine).trim();
                        const infoHeadsign = sameLineAsInfo ? (info?.headsign ?? null) : null;
                        const infoLongName = sameLineAsInfo ? (info?.longName ?? null) : null;
                        const trackedDests = (resolvedLine && resolvedLine !== '?' && (v.operator || selectedOperator))
                            ? LiveLineResolver.getDestinations(v.operator || selectedOperator || 'sl', resolvedLine)
                            : [];
                        const opForTrip = getOperatorCandidates(v, selectedOperator)[0] ?? v.operator ?? selectedOperator;
                        const tuCache = TrafiklabService.getTripUpdatesCache(opForTrip);
                        const tuForDest = tuCache.length ? tuCache : null;
                        let rawDest: string | null = null;
                        if (gtfsDestinationIndexes && (v.tripId || v.routeId)) {
                            const strictDest = GtfsDestinationService.resolveDestinationStrict(v, tuForDest, gtfsDestinationIndexes, resolvedLine ?? null);
                            if (strictDest && !GtfsDestinationService.isForbiddenDestination(strictDest)) rawDest = strictDest;
                        }
                        if (rawDest == null || GtfsDestinationService.isForbiddenDestination(rawDest)) {
                            rawDest =
                                (!isUselessDestination(v.dest, v.line) ? v.dest : null) ||
                                infoHeadsign ||
                                destinationCache[v.tripId] ||
                                (trackedDests.length > 0 ? trackedDests[0] : null) ||
                                infoLongName ||
                                (gtfsDestinationIndexes && (v.tripId || v.routeId)
                                    ? GtfsDestinationService.resolveDestinationStrict(v, tuForDest, gtfsDestinationIndexes, resolvedLine ?? null)
                                    : null) ||
                                null;
                        }
                        // Visa aldrig "Okänd destination" på kartikonerna – använd "Linje X" / "Tåg X" istället
                        if (rawDest && /okänd\s+destination/i.test(rawDest)) rawDest = '';
                        const resolvedHeadsign = rawDest
                            ? (rawDest.startsWith('Mot ') ? rawDest : `Mot ${rawDest}`)
                            : (resolvedLine && resolvedLine !== '?' ? `${likelyTrain ? 'Tåg' : 'Linje'} ${resolvedLine}` : null);

                        // Mata in lösta destinationer så andra fordon på samma linje kan använda dem
                        const destForTracking = rawDest ? rawDest.replace(/^Mot\s+/i, '').trim() : '';
                        if (destForTracking && resolvedLine && resolvedLine !== '?' && (v.operator || selectedOperator)) {
                            LiveLineResolver.feedDestination(v.operator || selectedOperator || 'sl', resolvedLine, destForTracking);
                        }

                        const tuMatch = v.tripId ? tuCache.find((e: { tripId: string }) => e.tripId === v.tripId) : null;
                        const delayOverride = tuMatch?.delay ?? undefined;

                        return (
                            <VehicleMarker
                                key={v.id}
                                v={v}
                                onSelect={handleSelectVehicle}
                                simpleMode={vehicles.length > 200 || zoom < 13}
                                showLabels={showLabels}
                                lineOverride={resolvedLine}
                                titleOverride={resolvedHeadsign ?? undefined}
                                colorOverride={info?.color}
                                typeOverride={info?.routeType ?? (likelyTrain ? 2 : undefined)}
                                nextStop={v.tripId ? nextStopCache[v.tripId] : undefined}
                                delayOverride={delayOverride}
                            />
                        );
                    })}

                {/* Network Shapes Layer (Base network) */}
                {Object.entries(networkShapes)
                    .sort(([, a], [, b]) => {
                        const aRail = ['metro', 'tram', 'rail'].includes(a.mode) ? 1 : 0;
                        const bRail = ['metro', 'tram', 'rail'].includes(b.mode) ? 1 : 0;
                        return aRail - bRail;
                    })
                    .map(([lineId, data]) => {
                        const isRail = ['metro', 'tram', 'rail'].includes(data.mode);
                        const drawOutline = isRail && zoom > 12;

                        return data.points.map((coords, idx) => (
                            <React.Fragment key={`net-${lineId}-${idx}`}>
                                {drawOutline && (
                                    <Polyline
                                        positions={coords}
                                        pathOptions={{
                                            color: isDark ? '#1e293b' : '#ffffff', // better outline color matching user's image style
                                            weight: zoom > 14 ? 8 : 5,
                                            opacity: 1.0,
                                            lineJoin: 'round',
                                            interactive: false
                                        }}
                                    />
                                )}
                                <Polyline
                                    positions={coords}
                                    pathOptions={{
                                        color: data.color,
                                        weight: isRail ? (zoom > 14 ? 5 : 3) : (zoom > 14 ? 3 : 2),
                                        opacity: isRail ? 1.0 : (zoom > 13 ? 0.35 : 0.2),
                                        lineJoin: 'round',
                                        interactive: false
                                    }}
                                />
                            </React.Fragment>
                        ));
                    })}

                {/* Disruptions */}
                {disruptions.map(d =>
                    d.coordinates?.length > 0 && d.coordinates.map((coord: any, idx: number) => (
                        <Marker
                            key={`dis-${d.id}-${idx}`}
                            position={[coord.lat, coord.lng]}
                            icon={L.divIcon({
                                className: 'bg-transparent',
                                html: `<div class="w-8 h-8 bg-amber-500 rounded-full shadow-lg border-2 border-white flex items-center justify-center text-white animate-pulse"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg></div>`,
                                iconSize: [32, 32],
                                iconAnchor: [16, 32]
                            })}
                        >
                            <Popup>
                                <div className="max-w-xs">
                                    <h3 className="font-bold text-sm mb-1">{d.title}</h3>
                                    <p className="text-xs text-slate-600 mb-2">{d.description}</p>
                                    <div className="text-[10px] text-slate-400 font-mono">
                                        Start: {d.startTime ? new Date(d.startTime).toLocaleString() : '-'}
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    ))
                )}
            </MapContainer>

            {/* ── Selected Vehicle Popup (map-anchored above marker) ── */}
            {/* This renders as an overlay on the map container, positioned above the vehicle */}
            {selectedVehicle && (() => {
                const opCandidates = getOperatorCandidates(selectedVehicle, selectedOperator);
                const routeInfo = gtfsPayload?.routeInfo;
                const syncInfo = opCandidates.map(op => GtfsShapeService.getLineInfo(op, selectedVehicle.tripId, selectedVehicle.routeId)).find(Boolean);
                const routeType = routeInfo?.routeType ?? syncInfo?.routeType;
                const likelyTrain = isLikelyTrainVehicle(selectedVehicle, routeType);

                const trainNo = getTrainNumberFromVehicleId(selectedVehicle);
                const staticLine = GtfsSwedenStaticService.getLineSync(selectedVehicle.tripId, selectedVehicle.routeId);
                const displayLine =
                    gtfsPayload?.line ||
                    routeInfo?.shortName ||
                    ((likelyTrain && trainNo) ? trainNo : null) ||
                    syncInfo?.line ||
                    staticLine ||
                    selectedVehicle.line ||
                    null;

                const cachedNextStopRaw = selectedVehicle.tripId ? (nextStopCache[selectedVehicle.tripId]?.name || null) : null;
                const cachedHeadsign = cachedNextStopRaw?.match(/^Mot\s+(.+)$/i)?.[1] || null;
                const cachedNextStopName = cachedHeadsign ? null : cachedNextStopRaw;

                // Samma källor som på kartikonen: GTFS payload, cache, LiveLineResolver, NeTEx. Ignorera "Ej linjesatt" från API.
                // Obligatorisk destination från Trafiklab-kedjan (realtime.headsign → trips.trip_headsign → stop_times_last_stop → route_fallback)
                const operatorForTrip = opCandidates[0] ?? selectedVehicle.operator ?? selectedOperator;
                const tripUpdates = TrafiklabService.getTripUpdatesCache(operatorForTrip);
                const resolved = GtfsDestinationService.resolveDestination(
                    selectedVehicle,
                    tripUpdates.length ? tripUpdates : null,
                    gtfsDestinationIndexes,
                    displayLine
                );
                // Tvingande destination: aldrig "—" eller "Ej angiven hållplats". Vid sådant kör resolveDestinationStrict.
                let finalDest = (resolved.destination || '').trim() || 'Hämtar destination...';
                if (GtfsDestinationService.isForbiddenDestination(finalDest)) {
                    finalDest = GtfsDestinationService.resolveDestinationStrict(selectedVehicle, tripUpdates.length ? tripUpdates : null, gtfsDestinationIndexes, displayLine);
                }

                const displayColor = routeInfo?.color || syncInfo?.color || journeyColor;

                // ── Next stop resolution (multiple sources) ──
                let nextStopDisplay: string | null = null;
                let nextPlatform: string | null = null;

                // Priority 1: GTFS payload (from NeTEx resolve)
                if (gtfsPayload?.nextStopName) {
                    nextStopDisplay = gtfsPayload.nextStopName;
                    nextPlatform = gtfsPayload.nextStopPlatform || null;
                }
                // Priority 2: Cached next stop
                if (!nextStopDisplay && cachedNextStopName) {
                    nextStopDisplay = cachedNextStopName;
                }
                // Priority 2.5: Resolved from stopId via ResRobot API
                if (!nextStopDisplay && resolvedNextStop) {
                    nextStopDisplay = resolvedNextStop;
                }
                // Priority 3: Journey stops + vehicle position → find nearest upcoming stop
                if (!nextStopDisplay && journeyStops.length > 0 && selectedVehicle.lat) {
                    let bestDist = Infinity;
                    let bestIdx = -1;
                    for (let i = 0; i < journeyStops.length; i++) {
                        const s = journeyStops[i];
                        const d = (s.coords.lat - selectedVehicle.lat) ** 2 + (s.coords.lng - selectedVehicle.lng) ** 2;
                        if (d < bestDist) { bestDist = d; bestIdx = i; }
                    }
                    const nextIdx = Math.min(bestIdx + 1, journeyStops.length - 1);
                    if (nextIdx >= 0) {
                        nextStopDisplay = journeyStops[nextIdx].name;
                        nextPlatform = journeyStops[nextIdx].platformCode || null;
                    }
                }
                // Priority 4: stopId as fallback (show raw ID)
                if (!nextStopDisplay && selectedVehicle.stopId) {
                    nextStopDisplay = `Hållplats ${selectedVehicle.stopId}`;
                }

                // Find the live version of selected vehicle (updated lat/lng from latest fetch)
                const liveVehicle = vehicles.find(vv => vv.id === selectedVehicle.id) || selectedVehicle;

                const panel = formatCompactPanel(
                    liveVehicle,
                    displayLine,
                    finalDest,
                    nextStopDisplay,
                    gtfsLoading,
                    journeyPath.length > 2,
                    journeyColor,
                    displayColor,
                    tripDelay // delaySeconds from TripUpdates
                );

                const hex = panel.lineColor;
                let numColor = '#ffffff';
                if (hex && hex.startsWith('#') && hex.length === 7) {
                    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
                    numColor = ((r * 299 + g * 587 + b * 114) / 1000 >= 128) ? '#1e293b' : '#ffffff';
                }

                return (
                    <VehicleInfoPopup
                        vehicle={liveVehicle}
                        panel={panel}
                        numColor={numColor}
                        nextStopDisplay={nextStopDisplay}
                        nextPlatform={nextPlatform}
                        destinationText={finalDest}
                        gtfsLoading={gtfsLoading}
                        onClose={() => { setSelectedVehicle(null); setJourneyPath([]); }}
                        mapRef={mapRef}
                    />
                );
            })()}


            {/* ── Compact Top Control Bar ── */}
            <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2 pointer-events-none">

                {/* Centrera på mig */}
                <div className="pointer-events-auto flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => {
                            if (userPosition && mapRef) {
                                mapRef.setView([userPosition.lat, userPosition.lng], 15);
                                setFollowUser(true);
                            }
                        }}
                        disabled={!userPosition || !!userPositionError}
                        title={userPositionError || (userPosition ? 'Centrera kartan på min position' : 'Hämtar position...')}
                        className="h-9 w-9 rounded-full shadow-lg border border-white/20 backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 hover:text-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-90"
                    >
                        <FontAwesomeIcon icon={faLocationArrow} className="text-sm" />
                    </button>
                    {userPositionError && (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 max-w-[100px] truncate" title={userPositionError}>
                            {userPositionError}
                        </span>
                    )}
                </div>

                {/* Search box */}
                <div className="pointer-events-auto flex items-center gap-1.5 h-9 px-3 rounded-full shadow-lg border border-white/20 backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 max-w-[200px]">
                    <FontAwesomeIcon icon={faSearch} className="text-slate-400 text-xs shrink-0" />
                    <input
                        type="text"
                        placeholder="Sök linje, fordonsnr, operatör..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent font-semibold text-slate-800 dark:text-white text-xs outline-none placeholder-slate-400 dark:placeholder-slate-500 min-w-0 flex-1"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="w-4 h-4 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                        >
                            <FontAwesomeIcon icon={faXmark} className="text-xs" />
                        </button>
                    )}
                </div>

                {/* Län / Region väljare (grupperad) */}
                <div className="pointer-events-auto flex items-center gap-1.5 h-9 pl-2 pr-1.5 rounded-full shadow-lg border border-white/20 backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 min-w-[140px]">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shrink-0" title="Välj län">
                        <FontAwesomeIcon icon={faLocationArrow} className={`text-white text-[8px] ${isLoading ? 'animate-spin' : ''}`} />
                    </div>
                    <select
                        value={selectedOperator}
                        onChange={(e) => setSelectedOperator(e.target.value)}
                        className="bg-transparent font-bold text-slate-800 dark:text-white text-xs outline-none appearance-none cursor-pointer flex-1 min-w-0"
                        title="Välj region / län"
                    >
                        {OPERATOR_REGIONS.map(reg => {
                            const ops = TRAFIKLAB_OPERATORS.filter((o: { region?: string }) => o.region === reg.key);
                            if (ops.length === 0) return null;
                            return (
                                <optgroup key={reg.key} label={reg.label}>
                                    {ops.map((op: { id: string; name: string }) => (
                                        <option key={op.id} value={op.id} className="text-slate-800 dark:text-slate-200">{op.name}</option>
                                    ))}
                                </optgroup>
                            );
                        })}
                    </select>
                    <FontAwesomeIcon icon={faChevronDown} className="text-slate-400 text-[9px] pointer-events-none shrink-0" />
                </div>

                {/* Vehicle count pill */}
                <div className="pointer-events-none hidden md:flex items-center h-9 px-3 rounded-full shadow-lg border border-white/20 backdrop-blur-xl bg-gradient-to-r from-sky-500 to-blue-600">
                    <span className="font-black text-white text-sm leading-none tabular-nums">{vehicles.length}</span>
                    <span className="text-white/70 text-[9px] font-bold ml-1 uppercase tracking-wide">fordon</span>
                </div>

                {/* Icon button group */}
                <div className="pointer-events-auto flex items-center h-9 rounded-full shadow-lg border border-white/20 backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 px-1 gap-0.5">

                    {/* Layers */}
                    <div className="relative">
                        <button
                            onClick={() => setShowLayers(!showLayers)}
                            title="Lager"
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 text-sm ${showLayers
                                ? 'bg-sky-500 text-white shadow-md'
                                : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                                }`}
                        >
                            <FontAwesomeIcon icon={faLayerGroup} className="text-xs" />
                        </button>

                        {showLayers && (
                            <div className="absolute top-full right-0 mt-2 w-56 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden z-[2000] animate-in slide-in-from-top-2 fade-in duration-150">
                                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                                    <span className="font-black text-xs text-slate-700 dark:text-white uppercase tracking-wider">Lager</span>
                                    <button onClick={() => setShowLayers(false)} className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
                                        <FontAwesomeIcon icon={faXmark} className="text-[9px]" />
                                    </button>
                                </div>
                                <div className="p-1.5 space-y-0.5">
                                    {[
                                        { id: 'BUS', icon: faBus, bg: 'bg-sky-500', label: 'Bussar' },
                                        { id: 'TRAM', icon: faTram, bg: 'bg-teal-500', label: 'Spårvagnar' },
                                        { id: 'TRAIN', icon: faTrain, bg: 'bg-fuchsia-500', label: 'Tåg & Pendel' },
                                        { id: 'FERRY', icon: faShip, bg: 'bg-indigo-500', label: 'Båtar' }
                                    ].map(m => {
                                        const isActive = activeFilters.includes(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                onClick={() => toggleFilter(m.id)}
                                                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] ${m.bg} ${isActive ? 'opacity-100' : 'opacity-30 grayscale'} transition-all`}>
                                                        <FontAwesomeIcon icon={m.icon} />
                                                    </div>
                                                    <span className={`font-bold text-xs ${isActive ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>{m.label}</span>
                                                </div>
                                                <div className={`w-8 h-4 rounded-full relative transition-colors duration-200 ${isActive ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-200 ${isActive ? 'left-[18px]' : 'left-0.5'}`} />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Depot filter & Labels Toggle */}
                                <div className="mx-2 my-1 border-t border-slate-100 dark:border-white/5" />

                                {/* Depot Toggle */}
                                <button
                                    onClick={() => setHideDepot(h => !h)}
                                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${hideDepot ? 'bg-green-500' : 'bg-slate-400 opacity-30 grayscale'} transition-all`}>
                                            ✅
                                        </div>
                                        <div className="text-left">
                                            <span className={`font-bold text-xs block ${hideDepot ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>Visa i trafik</span>
                                            <span className="text-[9px] text-slate-400">Dölj fordon utan aktiv linje</span>
                                        </div>
                                    </div>
                                    <div className={`w-8 h-4 rounded-full relative transition-colors duration-200 ${hideDepot ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-200 ${hideDepot ? 'left-[18px]' : 'left-0.5'}`} />
                                    </div>
                                </button>

                                {/* Show Labels Toggle */}
                                <button
                                    onClick={() => setShowLabels(s => !s)}
                                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] bg-slate-400 ${showLabels ? 'opacity-100' : 'opacity-30 grayscale'} transition-all`}>
                                            🏷️
                                        </div>
                                        <div className="text-left">
                                            <span className={`font-bold text-xs block ${showLabels ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>Visa ID-etiketter</span>
                                            <span className="text-[9px] text-slate-400">Sista 4 siffrorna i ikonen</span>
                                        </div>
                                    </div>
                                    <div className={`w-8 h-4 rounded-full relative transition-colors duration-200 ${showLabels ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-200 ${showLabels ? 'left-[18px]' : 'left-0.5'}`} />
                                    </div>
                                </button>

                                {/* Kartlägen */}
                                <div className="mx-2 my-1 border-t border-slate-100 dark:border-white/5" />
                                <div className="px-2.5 py-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Kartläge</span>
                                    <div className="flex gap-1">
                                        {[
                                            { value: 'light', label: '🗺️ Ljust' },
                                            { value: 'satellite', label: '🛰️ Satellit' },
                                            { value: 'hybrid', label: '🔗 Hybrid' }
                                        ].map(mode => (
                                            <button
                                                key={mode.value}
                                                onClick={() => setMapMode(mode.value as 'light' | 'dark' | 'satellite' | 'hybrid')}
                                                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all ${mapMode === mode.value
                                                    ? 'bg-sky-500 text-white shadow-md'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                                    }`}
                                            >
                                                {mode.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5" />

                    {/* Dark mode */}
                    <button
                        onClick={toggleDark}
                        title={isDark ? 'Ljust läge' : 'Mörkt läge'}
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${isDark ? 'text-amber-400 hover:bg-amber-400/10' : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                    >
                        <FontAwesomeIcon icon={isDark ? faSun : faMoon} className="text-xs" />
                    </button>

                    {/* Fullscreen */}
                    <button
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Avsluta helskärm' : 'Helskärm'}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-all active:scale-90"
                    >
                        <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} className="text-xs" />
                    </button>
                </div>
            </div>
        </div>
    );
};
