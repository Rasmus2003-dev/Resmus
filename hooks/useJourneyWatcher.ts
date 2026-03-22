/**
 * useJourneyWatcher – Spara bevakade resor i Supabase.
 * Faller tillbaka till localStorage om användaren inte är inloggad.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

export interface WatchedJourney {
    id: string;           // generated uuid
    from_name: string;
    to_name: string;
    departure_time: string; // ISO 8601
    arrival_time: string;
    line_summary: string;   // e.g. "17 → 3955 → X30"
    duration_min: number;
    created_at?: string;
    notified?: boolean;
}

const LOCAL_KEY = 'resmus_watched_journeys';

export function useJourneyWatcher() {
    const { user } = useAuth();
    const [watched, setWatched] = useState<WatchedJourney[]>([]);
    const [loading, setLoading] = useState(false);

    // ── Load ──────────────────────────────────────────────────────────────────
    const load = useCallback(async () => {
        if (user) {
            setLoading(true);
            const { data, error } = await supabase
                .from('watched_journeys')
                .select('*')
                .eq('user_id', user.id)
                .order('departure_time', { ascending: true });
            if (!error && data) setWatched(data as WatchedJourney[]);
            setLoading(false);
        } else {
            try {
                const raw = localStorage.getItem(LOCAL_KEY);
                if (raw) setWatched(JSON.parse(raw));
            } catch (_) { }
        }
    }, [user]);

    useEffect(() => { load(); }, [load]);

    // ── Add ───────────────────────────────────────────────────────────────────
    const watch = useCallback(async (journey: WatchedJourney) => {
        if (user) {
            const { data, error } = await supabase
                .from('watched_journeys')
                .insert({ ...journey, user_id: user.id })
                .select()
                .single();
            if (!error && data) {
                setWatched(prev => [data as WatchedJourney, ...prev]);
                return true;
            }
            return false;
        } else {
            const updated = [journey, ...watched.filter(w => w.id !== journey.id)];
            setWatched(updated);
            localStorage.setItem(LOCAL_KEY, JSON.stringify(updated));
            return true;
        }
    }, [user, watched]);

    // ── Remove ────────────────────────────────────────────────────────────────
    const unwatch = useCallback(async (id: string) => {
        if (user) {
            await supabase.from('watched_journeys').delete().eq('id', id).eq('user_id', user.id);
        }
        const updated = watched.filter(w => w.id !== id);
        setWatched(updated);
        if (!user) localStorage.setItem(LOCAL_KEY, JSON.stringify(updated));
    }, [user, watched]);

    const isWatched = useCallback((id: string) => watched.some(w => w.id === id), [watched]);

    return { watched, loading, watch, unwatch, isWatched, reload: load };
}
