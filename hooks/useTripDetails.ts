import { useState, useEffect, useCallback, useRef } from 'react';
import { API_KEYS } from '../services/config';
import { TransitService } from '../services/transitService';

export interface SimplifiedStop {
    name: string;
    arrivalTime: string;
    departureTime: string;
    realtimeArrival?: string;
    realtimeDeparture?: string;
    track: string;
    /** Estimated arrival track (from Trafikverket guess logic) */
    predictedTrack?: string;
}

/** Gissar ankomstspår baserat på linjens riktning för Trafikverket-avgångar.
 *  Returnerar en sträng som "2" eller "3A" om det kan gissas, annars undefined.
 *  Logiken: Jämför koordinater/slutstation mot kända mönster (söder/norr).
 */
export function guessTrafikverketTrack(direction: string): string | undefined {
    const d = direction.toLowerCase();
    // Swedish main stations crude direction → track mapping heuristics
    // These are approximate but useful for common corridors
    if (d.includes('göteborg') || d.includes('gbg') || d.includes('kungsbacka') || d.includes('varberg') || d.includes('falkenberg') || d.includes('halmstad')) return '1'; // Västkustbanan söder
    if (d.includes('malmö') || d.includes('lund') || d.includes('helsingborg') || d.includes('ystad')) return '1';
    if (d.includes('stockholm') || d.includes('sthlm') || d.includes('arlanda')) return '2'; // Mainline norr
    if (d.includes('sundsvall') || d.includes('östersund') || d.includes('umeå') || d.includes('luleå') || d.includes('boden')) return '2';
    if (d.includes('karlstad') || d.includes('örebro') || d.includes('hallsberg')) return '3'; // Värmlandsbanan/Bergslagsbanan
    if (d.includes('eskilstuna') || d.includes('västerås') || d.includes('köping')) return '3';
    if (d.includes('borås') || d.includes('jönköping') || d.includes('nässjö') || d.includes('alvesta')) return '4';
    if (d.includes('trollhättan') || d.includes('vänersborg') || d.includes('åmål')) return '4';
    return undefined;
}

/** Hämtar resedetaljer via journeyRef (t.ex. Trafikverket tv-xxx) med auto-refresh. */
export const useTripDetailsFromRef = (journeyRef: string | null, refreshIntervalMs = 30_000) => {
    const [stops, setStops] = useState<SimplifiedStop[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const fetchStops = useCallback(async (isBackground = false) => {
        if (!journeyRef) return;
        if (!isBackground) setLoading(true);
        setError(null);

        try {
            const details = await TransitService.getJourneyDetails(journeyRef);
            const simplified: SimplifiedStop[] = details.map((s) => ({
                name: s.name,
                arrivalTime: s.arrivalTime?.substring(0, 5) || s.time?.substring(0, 5) || '--:--',
                departureTime: s.departureTime?.substring(0, 5) || s.time?.substring(0, 5) || '--:--',
                realtimeArrival: s.realtimeArrival?.substring(0, 5),
                realtimeDeparture: s.realtimeDeparture?.substring(0, 5),
                track: s.track || ''
            }));
            setStops(simplified);
            setLastRefresh(new Date());
        } catch (e: any) {
            if (!isBackground) setError(e?.message || 'Kunde inte ladda resan');
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [journeyRef]);

    useEffect(() => {
        if (!journeyRef) {
            setStops([]);
            setLoading(false);
            return;
        }
        fetchStops(false);
        const interval = setInterval(() => fetchStops(true), refreshIntervalMs);
        return () => clearInterval(interval);
    }, [journeyRef, fetchStops, refreshIntervalMs]);

    return { stops, loading, error, lastRefresh, refresh: () => fetchStops(false) };
};

export const useTripDetails = (journeyDetailRefUrl: string | null, refreshIntervalMs = 30_000) => {
    const [stops, setStops] = useState<SimplifiedStop[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const fetchDetails = useCallback(async (isBackground = false) => {
        if (!journeyDetailRefUrl) return;
        if (!isBackground) setLoading(true);
        setError(null);

        // 1. Prepare URL (Inject Key if missing)
        let url = journeyDetailRefUrl;
        const hasKey = url.includes('key=') || url.includes('accessId=');

        if (!hasKey) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}accessId=${API_KEYS.RESROBOT_API_KEY}&format=json`;
        }

        if (!url.includes('format=json')) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}format=json`;
        }

        try {
            let fetchUrl = url;
            if (import.meta.env.DEV && !url.startsWith('/')) {
                fetchUrl = "https://corsproxy.io/?" + encodeURIComponent(url);
            }

            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`Failed to fetch details. Status: ${res.status}`);

            const data = await res.json();

            let rawStops: any[] = [];
            const jd = data.JourneyDetail || data.JourneyLocation;
            if (jd && jd.Stops && jd.Stops.Stop) {
                rawStops = Array.isArray(jd.Stops.Stop) ? jd.Stops.Stop : [jd.Stops.Stop];
            }

            const simplified: SimplifiedStop[] = rawStops.map((s: any) => ({
                name: s.name,
                arrivalTime: s.arrTime ? s.arrTime.substring(0, 5) : (s.depTime ? s.depTime.substring(0, 5) : '--:--'),
                departureTime: s.depTime ? s.depTime.substring(0, 5) : (s.arrTime ? s.arrTime.substring(0, 5) : '--:--'),
                realtimeArrival: s.rtArrTime ? s.rtArrTime.substring(0, 5) : undefined,
                realtimeDeparture: s.rtDepTime ? s.rtDepTime.substring(0, 5) : undefined,
                track: s.rtTrack || s.track || ''
            }));

            setStops(simplified);
            setLastRefresh(new Date());
        } catch (e: any) {
            if (!isBackground) setError(e?.message || 'Ett fel uppstod');
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [journeyDetailRefUrl]);

    useEffect(() => {
        if (!journeyDetailRefUrl) {
            setStops([]);
            return;
        }
        fetchDetails(false);
        const interval = setInterval(() => fetchDetails(true), refreshIntervalMs);
        return () => clearInterval(interval);
    }, [journeyDetailRefUrl, fetchDetails, refreshIntervalMs]);

    return { stops, loading, error, lastRefresh, refresh: () => fetchDetails(false) };
};
