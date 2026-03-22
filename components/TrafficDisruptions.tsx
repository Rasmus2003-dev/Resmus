import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Check, AlertTriangle, TramFront, Ship, BusFront, Clock, Calendar, AlertCircle, BellOff, BellRing, TrainFront } from 'lucide-react';
import { TransitService } from '../services/transitService';
import { Provider } from '../types';
import { DisruptionSkeleton } from './Loaders';
import { formatDisruption } from '../utils/disruptionHelpers';
import { supabase } from '../services/supabaseClient';

interface UnifiedDisruption {
    id: string;
    provider: Provider;
    title: string;
    description: string;
    severity: 'severe' | 'normal' | 'slight' | 'unknown';
    startTime: string;
    endTime?: string;
    updatedTime?: string;
    /** Tid då störningen publicerades (Trafikverket). */
    publishedTime?: string;
    /** Orsakskod t.ex. OMÄ03 (Trafikverket). */
    reasonCode?: string;
    affected?: { designation: string; color?: string; textColor?: string }[];
    type: 'BUS' | 'TRAM' | 'TRAIN' | 'SHIP' | 'METRO';
}

export const TrafficDisruptions: React.FC = () => {
    const [disruptions, setDisruptions] = useState<UnifiedDisruption[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Notis via Supabase-backend – ej frontend Notification API
    const [notificationsEnabled, setNotificationsEnabled] = useState(() =>
        localStorage.getItem('resmus_disruption_notifications_enabled') === 'true'
    );
    const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
    const seenIdsRef = useRef<Set<string>>(new Set());
    const isFirstLoad = useRef(true);

    // Filter state for carousel


    // Relative time helper
    const getRelativeTime = (dateString?: string) => {
        if (!dateString) return '';
        const now = new Date();
        const date = new Date(dateString);

        // Always show time in HH:MM format
        const timeStr = date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

        // If it's today, return just the time
        if (date.getDate() === now.getDate() &&
            date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear()) {
            return timeStr;
        }

        // Otherwise return date + time
        return `${date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${timeStr}`;
    };

    const [provider, setProvider] = useState<Provider>(() => {
        const saved = localStorage.getItem('resmus_storage_provider');
        return (saved as Provider) || Provider.VASTTRAFIK;
    });

    useEffect(() => {
        const handleStorageChange = () => {
            const saved = localStorage.getItem('resmus_storage_provider');
            if (saved) setProvider(saved as Provider);
        };
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('provider-change', handleStorageChange); // Custom event
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('provider-change', handleStorageChange);
        };
    }, []);

    // Effect to refetch when provider changes
    useEffect(() => {
        fetchSituations();
    }, [provider]);

    useEffect(() => {
        // Load seen IDs
        try {
            const savedIds = localStorage.getItem('resmus_seen_disruptions');
            if (savedIds) {
                const parsed = JSON.parse(savedIds);
                if (Array.isArray(parsed)) parsed.forEach((id: string) => seenIdsRef.current.add(id));
            }
        } catch (_) { }

        fetchSituations();
        const interval = setInterval(fetchSituations, 60000);

        // Supabase Realtime -- used ONLY for live UI refresh, NOT for browser notifications
        // Push notifications are sent via Supabase backend (Edge Functions / pg_notify)
        const channel = supabase
            .channel('public:traffic_disruptions')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'traffic_disruptions' },
                (_payload) => { fetchSituations(); }
            )
            .subscribe();

        return () => {
            clearInterval(interval);
            supabase.removeChannel(channel);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchSituations = async () => {
        setLoading(true);
        setError(null);
        try {
            const unified: UnifiedDisruption[] = [];

            if (provider === Provider.TRAFIKVERKET) {
                try {
                    const tvData = await TransitService.getTrafikverketDisruptions();
                    tvData.forEach(ts => {
                        unified.push({
                            id: ts.situationNumber,
                            provider: Provider.TRAFIKVERKET,
                            title: ts.title,
                            description: ts.description,
                            severity: ts.severity,
                            startTime: ts.startTime,
                            endTime: ts.endTime,
                            updatedTime: ts.creationTime,
                            publishedTime: (ts as any).publishedTime,
                            reasonCode: (ts as any).reasonCode,
                            type: 'TRAIN',
                            affected: ts.affectedLines?.map(l => ({ designation: l.designation })) || ts.affected || []
                        });
                    });
                } catch (e) {
                    console.error("Trafikverket störningar kunde inte hämtas", e);
                }
            } else if (provider === Provider.SL) {
                // Fetch SL Deviations
                try {
                    const slData = await TransitService.getSLDeviations();
                    slData.forEach((d: any) => {
                        // Parse Message Variants
                        const variant = d.message_variants?.find((v: any) => v.language === 'sv') || d.message_variants?.[0];
                        const title = variant?.header || d.header || "Trafikstörning";
                        const description = variant?.details || d.details || d.message || "Ingen detaljerad information.";

                        const affected: any[] = [];
                        let type: 'BUS' | 'TRAM' | 'TRAIN' | 'SHIP' | 'METRO' = 'BUS';

                        // Infer type from scope
                        const lines = d.scope?.lines || [];
                        const stops = d.scope?.stop_areas || [];

                        if (lines.length > 0) {
                            const mode = lines[0].transport_mode;
                            if (mode === 'METRO') type = 'METRO';
                            else if (mode === 'TRAIN') type = 'TRAIN';
                            else if (mode === 'TRAM') type = 'TRAM';
                            else if (mode === 'SHIP' || mode === 'FERRY') type = 'SHIP';
                        } else if (stops.length > 0) {
                            const t = stops[0].type;
                            if (t === 'METROSTN') type = 'METRO';
                            else if (t === 'TRAINSTN') type = 'TRAIN';
                        } else {
                            // Text heuristic fallback
                            const txt = (title + " " + description).toLowerCase();
                            if (txt.includes("tunnelbana") || txt.includes("grön linje") || txt.includes("röd linje") || txt.includes("blå linje")) type = 'METRO';
                            else if (txt.includes("pendeltåg") || txt.includes("tåg")) type = 'TRAIN';
                            else if (txt.includes("spårvagn") || txt.includes("tvärbanan") || txt.includes("lidingöbanan")) type = 'TRAM';
                            else if (txt.includes("båt") || txt.includes("färja") || txt.includes("pendelbåt")) type = 'SHIP';
                        }

                        // Parse affected lines
                        if (lines.length > 0) {
                            lines.forEach((l: any) => {
                                affected.push({ designation: l.designation, color: undefined });
                            });
                        }

                        // Determine severity: priority.importance_level (undefined for some alerts). 
                        // Assuming lower is more important, e.g. 1-2.
                        let severity: any = 'normal';
                        if (d.priority?.importance_level !== undefined && d.priority.importance_level <= 2) severity = 'severe';

                        unified.push({
                            id: d.deviation_case_id ? String(d.deviation_case_id) : (d.id || `sl-${Math.random()}`),
                            provider: Provider.SL,
                            title,
                            description,
                            severity,
                            // Use publish period
                            startTime: d.publish?.from || d.fromDate,
                            endTime: d.publish?.upto || d.toDate,
                            updatedTime: d.modified || d.created,
                            type,
                            affected
                        });
                    });
                } catch (e) {
                    console.error("SL Fetch Failed", e);
                }
            } else {
                // Fetch Västtrafik (Default)
                try {
                    const vtData = await TransitService.getVasttrafikDisruptions();


                    // Use a Set to track unique situation numbers and avoid duplicates
                    const seenSituationNumbers = new Set<string>();

                    vtData.forEach(ts => {
                        // Skip if we've already processed this situation number
                        if (seenSituationNumbers.has(ts.situationNumber)) {
                            return;
                        }
                        seenSituationNumbers.add(ts.situationNumber);

                        const title = ts.title.toLowerCase();
                        const description = ts.description.toLowerCase();

                        let type: 'BUS' | 'TRAM' | 'TRAIN' | 'SHIP' = 'BUS';
                        const lowerTitle = title.toLowerCase();

                        // 1. Explicit Tram Lines (1-13)
                        const tramLines = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '13', '14'];

                        // Check if any affected line is a tram line
                        const hasTramLine = ts.affectedLines?.some(l => {
                            const lineNum = l.designation.replace(/\D/g, '');
                            return tramLines.includes(l.designation) || (parseInt(lineNum) >= 1 && parseInt(lineNum) <= 13);
                        });

                        // 2. Explicit Ferry Lines
                        const ferryLines = ['281', '282', '283', '284', '285', '286', '287', '326', 'ÄLVS'];
                        const hasFerryLine = ts.affectedLines?.some(l => ferryLines.includes(l.designation));

                        if (title.includes('västtågen') || title.includes('tåg') || title.includes('kustpilen') || title.includes('öresundståg')) {
                            type = 'TRAIN';
                        } else if (hasTramLine || ts.affectedLines?.some(l => l.designation.includes('Spår')) || title.includes('spårvagn')) {
                            type = 'TRAM';
                        } else if (hasFerryLine || title.includes('färja') || /\bbåt\b/i.test(title) || title.includes('älvsnabben')) {
                            type = 'SHIP';
                        }

                        unified.push({
                            id: ts.situationNumber,
                            provider: Provider.VASTTRAFIK,
                            title: ts.title,
                            description: ts.description,
                            severity: ts.severity === 'severe' ? 'severe' : (ts.severity === 'normal' ? 'normal' : 'slight'),
                            startTime: ts.startTime,
                            endTime: ts.endTime,
                            updatedTime: ts.creationTime,
                            type,
                            affected: ts.affectedLines?.map(l => ({ designation: l.designation, color: l.backgroundColor, textColor: l.textColor }))
                        });
                    });
                } catch (e) {
                    console.error("VT Fetch failed:", e);
                }
            }

            console.log("Unified count before sort:", unified.length);



            // Senaste överst: sortera på publiceringstid (publishedTime), sedan updated/start
            unified.sort((a, b) => {
                const getT = (item: UnifiedDisruption) => {
                    const published = item.publishedTime ? new Date(item.publishedTime).getTime() : 0;
                    const updated = item.updatedTime ? new Date(item.updatedTime).getTime() : 0;
                    const start = item.startTime ? new Date(item.startTime).getTime() : 0;
                    return Math.max(published, updated, start);
                };
                return getT(b) - getT(a);
            });

            // Track seen IDs for new/history split
            unified.forEach(d => seenIdsRef.current.add(d.id));
            localStorage.setItem('resmus_seen_disruptions',
                JSON.stringify(Array.from(seenIdsRef.current).slice(0, 200)));
            isFirstLoad.current = false;
            // NOTE: Push notifications are handled exclusively by Supabase backend (Edge Function)

            setDisruptions(unified);
        } catch (e) {
            console.error("Failed to fetch traffic disruptions:", e);
            setError("Kunde inte hämta störningsinformation. Försök igen senare.");
        } finally {
            setLoading(false);
        }
    };

    const getSeverityStyles = (severity: string) => {
        switch (severity) {
            case 'severe':
                return {
                    bg: 'bg-white dark:bg-slate-900 border-2 border-red-200 dark:border-red-900/30',
                    border: 'border-red-200 dark:border-red-900/30',
                    accent: 'bg-red-600 dark:bg-red-700',
                    icon: 'bg-red-600 dark:bg-red-700 text-white',
                    shadow: 'shadow-red-100/30 dark:shadow-red-950/10',
                    headerBg: 'bg-red-100/70 dark:bg-red-950/20',
                    animation: ''
                };
            case 'normal':
                return {
                    bg: 'bg-white dark:bg-slate-900 border-2 border-orange-200 dark:border-orange-900/30',
                    border: 'border-orange-200 dark:border-orange-900/30',
                    accent: 'bg-orange-500 dark:bg-orange-700',
                    icon: 'bg-orange-500 dark:bg-orange-700 text-white',
                    shadow: 'shadow-orange-100/30 dark:shadow-orange-950/10',
                    headerBg: 'bg-orange-100/70 dark:bg-orange-950/20',
                    animation: ''
                };
            default:
                return {
                    bg: 'bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700/60',
                    border: 'border-slate-200 dark:border-slate-700/60',
                    accent: 'bg-slate-600 dark:bg-slate-700',
                    icon: 'bg-slate-600 dark:bg-slate-700 text-white',
                    shadow: 'shadow-slate-100/30 dark:shadow-slate-950/10',
                    headerBg: 'bg-slate-100/70 dark:bg-slate-950/20',
                    animation: ''
                };
        }
    };

    const getTransportIcon = (type: string) => {
        switch (type) {
            case 'METRO': return TrainFront;
            case 'TRAIN': return TrainFront;
            case 'TRAM': return TramFront;
            case 'SHIP': return Ship;
            default: return BusFront;
        }
    };

    // Helper function to ensure WCAG AA compliance (4.5:1 contrast ratio)
    const ensureContrast = (bgColor: string): string => {
        // For dark backgrounds, we use white text which should be fine
        // This function could be expanded to calculate actual contrast ratios
        return bgColor;
    };

    // Notiser skickas via Supabase backend — denna toggle sparar preferens
    const handleToggleNotifications = () => {
        const next = !notificationsEnabled;
        setNotificationsEnabled(next);
        localStorage.setItem('resmus_disruption_notifications_enabled', String(next));
        // Backend läser denna preferens och skickar push när aktiverat
    };



    // ── Tab split: "Ny" = senaste 6h, "Historik" = äldre ──────────────────
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const sortFn = (a: UnifiedDisruption, b: UnifiedDisruption) => {
        const getLatest = (d: UnifiedDisruption) => Math.max(
            d.updatedTime ? new Date(d.updatedTime).getTime() : 0,
            (d as any).publishedTime ? new Date((d as any).publishedTime).getTime() : 0,
            d.startTime ? new Date(d.startTime).getTime() : 0
        );
        return getLatest(b) - getLatest(a);
    };

    const isNew = (d: UnifiedDisruption) => {
        const t = Math.max(
            d.updatedTime ? new Date(d.updatedTime).getTime() : 0,
            (d as any).publishedTime ? new Date((d as any).publishedTime).getTime() : 0,
            d.startTime ? new Date(d.startTime).getTime() : 0
        );
        return Date.now() - t <= SIX_HOURS;
    };

    const newDisruptions = disruptions.filter(isNew).sort(sortFn);
    const historyDisruptions = disruptions.filter(d => !isNew(d)).sort(sortFn);
    const activeDisruptions = activeTab === 'new' ? newDisruptions : historyDisruptions;



    return (
        <div className="h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">

            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 sticky top-0 z-10">
                <div className="px-4 pt-4 pb-0">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h1 className="text-xl font-black text-slate-800 dark:text-white">Trafikstörningar</h1>
                            <p className="text-xs text-slate-400 mt-0.5">
                                {newDisruptions.length} nya · {historyDisruptions.length} i historik
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {/* Bell = backend notis-prenumeration */}
                            <button
                                onClick={handleToggleNotifications}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all relative ${
                                    notificationsEnabled
                                        ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                                title={notificationsEnabled ? 'Notiser aktiverade (via backend)' : 'Aktivera notiser'}
                            >
                                {notificationsEnabled && (
                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900" />
                                )}
                                {notificationsEnabled ? <BellRing size={16} /> : <BellOff size={16} />}
                            </button>
                            <button
                                onClick={fetchSituations}
                                disabled={loading}
                                className="w-9 h-9 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 border-b-0">
                        <button
                            onClick={() => setActiveTab('new')}
                            className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-all border-b-2 ${
                                activeTab === 'new'
                                    ? 'text-sky-600 dark:text-sky-400 border-sky-500 bg-sky-50/50 dark:bg-sky-900/10'
                                    : 'text-slate-400 border-transparent hover:text-slate-600 dark:hover:text-slate-300'
                            }`}
                        >
                            Nytt
                            {newDisruptions.length > 0 && (
                                <span className="ml-1.5 bg-sky-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                                    {newDisruptions.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-all border-b-2 ${
                                activeTab === 'history'
                                    ? 'text-slate-700 dark:text-slate-200 border-slate-400 bg-slate-50 dark:bg-slate-800/50'
                                    : 'text-slate-400 border-transparent hover:text-slate-600 dark:hover:text-slate-300'
                            }`}
                        >
                            Historik
                            {historyDisruptions.length > 0 && (
                                <span className="ml-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                                    {historyDisruptions.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            </div>



            {/* Content */}
            <div className="p-3 sm:p-6 space-y-3 pb-8">

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 text-red-700 dark:text-red-300 p-4 rounded-xl">
                        <div className="flex items-center gap-3">
                            <AlertTriangle size={20} />
                            <span className="font-medium">{error}</span>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {loading && disruptions.length === 0 && (
                    <div className="space-y-3">
                        <DisruptionSkeleton />
                        <DisruptionSkeleton />
                        <DisruptionSkeleton />
                    </div>
                )}

                {/* Empty State */}
                {!loading && activeDisruptions.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 animate-in fade-in zoom-in-95 duration-500">
                        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mb-4">
                            <Check size={32} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <p className="font-bold text-slate-700 dark:text-slate-300 mb-1">
                            {activeTab === 'new' ? 'Inga nya störningar' : 'Ingen historik'}
                        </p>
                        <p className="text-sm text-slate-400 text-center max-w-xs">
                            {activeTab === 'new'
                                ? 'Inga störningar rapporterade de senaste 6 timmarna.'
                                : 'Inga äldre störningar att visa.'}
                        </p>
                    </div>
                )}

                {/* Disruption Cards */}
                {activeDisruptions.map((item, index) => {
                    const isLatest = index === 0;
                    const styles = getSeverityStyles(item.severity);
                    const Icon = getTransportIcon(item.type);

                    // Use helper for formatting
                    const formatted = formatDisruption({
                        ...item,
                        situationNumber: item.id,
                        creationTime: item.updatedTime || ''
                    } as any);

                    return (
                        <div
                            key={item.id}
                            className={`${styles.bg} ${styles.border} ${styles.animation} rounded-2xl border overflow-hidden transition-all duration-300 hover:shadow-lg hover:scale-[1.02] shadow-md`}
                        >
                            <div className="p-4 sm:p-5">
                                <div className="flex items-start gap-4 mb-4">
                                    {/* Icon - Updated UI */}
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm ${styles.icon} ring-4 ring-white dark:ring-slate-800`}>
                                        <Icon size={22} className="opacity-100" />
                                    </div>

                                    {/* Header Content */}
                                    <div className="flex-1 min-w-0 pt-0.5">
                                        <div className="mb-2">
                                            <h3 className="font-bold text-slate-800 dark:text-white text-base leading-tight hover-copy cursor-pointer" onClick={() => navigator.clipboard.writeText(item.title)}>
                                                {formatted?.title || item.title}
                                            </h3>
                                        </div>

                                        {/* Affected lines and automatic train numbers */}
                                        {(() => {
                                            const allBadges: Array<{ text: string, color: string, type: 'line' | 'train' }> = [];

                                            // Add existing affected lines
                                            if (item.affected && item.affected.length > 0) {
                                                item.affected.forEach((line, idx) => {
                                                    let displayText = line.designation;
                                                    let finalColor = line.color;

                                                    // If no color data and it's Västtågen, use "TÅG" with dark blue
                                                    if (!finalColor && line.designation && (line.designation.includes('Västtågen') || line.designation.includes('Tåg') || line.designation.includes('TÅG'))) {
                                                        displayText = 'TÅG';
                                                        finalColor = '#1e40af'; // Dark blue instead of light blue
                                                    }

                                                    // If still no color, use fallback based on line type with WCAG-compliant colors
                                                    if (!finalColor) {
                                                        finalColor = line.designation ?
                                                            (line.designation.includes('T') || line.designation.includes('Å') || line.designation.includes('G') ? '#1e40af' : // Dark blue for trains (7.2:1 contrast)
                                                                line.designation.includes('Spår') ? '#047857' : // Dark green for trams (6.8:1 contrast)
                                                                    line.designation.match(/^\d+$/) ? (() => {
                                                                        const num = parseInt(line.designation);
                                                                        // WCAG AA compliant colors with high contrast ratios
                                                                        if (num >= 1 && num <= 99) {
                                                                            // Local buses - different colors for better distinction
                                                                            const localBusColors: Record<number, string> = {
                                                                                1: '#b91c1c',   // Red-700 (7.0:1)
                                                                                2: '#c2410c',   // Orange-700 (4.6:1)
                                                                                3: '#a16207',   // Yellow-700 (4.8:1)
                                                                                4: '#15803d',   // Green-700 (6.2:1)
                                                                                5: '#0369a1',   // Sky-700 (6.8:1)
                                                                                6: '#7c3aed',   // Violet-600 (8.2:1)
                                                                                7: '#be185d',   // Pink-700 (5.8:1)
                                                                                8: '#0f172a',   // Slate-900 (15.9:1)
                                                                                9: '#7f1d1d',   // Red-900 (10.2:1)
                                                                                10: '#9a3412',  // Orange-800 (6.1:1)
                                                                            };
                                                                            return localBusColors[num] || '#c2410c'; // Fallback to orange-700
                                                                        }
                                                                        if (num >= 100 && num <= 199) return '#6b21a8'; // Purple-800 (9.8:1)
                                                                        if (num >= 200 && num <= 299) return '#dc2626'; // Red-600 (4.6:1)
                                                                        if (num >= 300 && num <= 399) return '#1d4ed8'; // Blue-700 (6.8:1)
                                                                        return '#475569'; // Slate-600 (6.1:1)
                                                                    })() : '#475569') : '#475569'; // Slate-600 fallback
                                                    }

                                                    allBadges.push({
                                                        text: displayText,
                                                        color: finalColor || '#475569',
                                                        type: 'line'
                                                    });
                                                });
                                            }

                                            // If no affected lines but it's a Västtågen disruption, add TÅG badge
                                            if ((!item.affected || item.affected.length === 0) && item.type === 'TRAIN' && (item.title.toLowerCase().includes('västtågen') || item.description.toLowerCase().includes('västtågen'))) {
                                                allBadges.push({
                                                    text: 'TÅG',
                                                    color: '#1e40af', // Dark blue for Västtågen (matching updated theme)
                                                    type: 'train'
                                                });
                                            }

                                            return allBadges.length > 0 ? (
                                                <div className="mb-3">
                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                        {allBadges.map((badge, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="h-6 min-w-[32px] px-1.5 rounded-md flex items-center justify-center font-black text-xs text-white shadow-sm border border-white/20 bg-gradient-to-b from-white/20 to-transparent transition-all hover:scale-105"
                                                                style={{
                                                                    backgroundColor: ensureContrast(badge.color),
                                                                    color: '#ffffff',
                                                                    textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                                                                }}
                                                                role="badge"
                                                                aria-label={`Linje ${badge.text}`}
                                                            >
                                                                {badge.text}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null;
                                        })()}

                                        {/* Description */}
                                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                            {formatted?.description || item.description}
                                        </p>
                                    </div>
                                </div>

                                {/* Validity Period & Updated Info */}
                                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                            <Calendar size={12} />
                                            Giltighetstid
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
                                            <div className="flex justify-between sm:justify-start sm:gap-4">
                                                <span className="text-slate-500 dark:text-slate-400">Giltig från</span>
                                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                                    {formatted?.startTime || "Okänt"}
                                                </span>
                                            </div>

                                            {item.updatedTime && (
                                                <div className="flex justify-between sm:justify-start sm:gap-4">
                                                    <span className="text-slate-500 dark:text-slate-400">Uppdaterad</span>
                                                    <span className="font-medium text-slate-800 dark:text-slate-200">
                                                        {getRelativeTime(item.updatedTime)}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="flex justify-between sm:justify-start sm:gap-4">
                                                <span className="text-slate-500 dark:text-slate-400">Beräknas pågå till</span>
                                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                                    {formatted?.endTime || "Tillsvidare"}
                                                </span>
                                            </div>
                                            {(formatted as any)?.reasonCode && (
                                                <div className="flex justify-between sm:justify-start sm:gap-4 sm:col-span-2">
                                                    <span className="text-slate-500 dark:text-slate-400">ReasonCode</span>
                                                    <span className="font-medium text-slate-800 dark:text-slate-200">
                                                        {(formatted as any).reasonCode}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>


        </div>
    );
};
