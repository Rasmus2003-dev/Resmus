import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faClock, faBus, faExclamationTriangle, faRotate, faLocationArrow, faStar as faStarSolid, faBell, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { Departure, Provider } from '../types';
import { useTripDetails, useTripDetailsFromRef, SimplifiedStop, guessTrafikverketTrack } from '../hooks/useTripDetails';
import { ThemedSpinner } from './Loaders';
import { useAlarms } from '../hooks/useAlarms';
import { useToast } from './ToastProvider';
import { useJourneyWatcher } from '../hooks/useJourneyWatcher';

interface DepartureDetailsModalProps {
    departure: Departure;
    onClose: () => void;
    stationName?: string;
}

// ──────────────────────────────────────────────
//  Platform badge — high contrast circle
// ──────────────────────────────────────────────
const PlatformBadge = ({ track, small, predicted }: { track: string; small?: boolean; predicted?: boolean }) => {
    if (!track || track === 'X' || track === '') return null;
    const label = track.length > 2 ? track.slice(0, 2) : track;
    return (
        <div
            className={`rounded-full flex items-center justify-center font-black shrink-0
                ${predicted
                    ? 'border-2 border-dashed border-slate-400 dark:border-slate-500 text-slate-400 dark:text-slate-400 bg-transparent'
                    : 'bg-slate-900 dark:bg-black text-slate-400'}
                ${small ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-[10px]'}
            `}
            title={predicted ? `Gissat läge: ${track}` : `Läge ${track}`}
        >
            {label}
        </div>
    );
};

const JourneyProgressMarker = ({ progress }: { progress: number }) => {
    if (progress < 0 || progress > 100) return null;
    return (
        <div 
            className="absolute left-[3px] sm:left-[9px] w-4 h-4 z-20 transition-all duration-1000 ease-linear"
            style={{ top: `${progress}%`, transform: 'translateY(-50%)' }}
        >
            <div className="relative">
                <div className="absolute inset-0 bg-sky-500 rounded-full animate-ping opacity-25" />
                <div className="relative bg-sky-600 border-2 border-white dark:border-slate-900 w-full h-full rounded-full shadow-md flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
            </div>
        </div>
    );
};

// ──────────────────────────────────────────────
//  Interchange detection
// ──────────────────────────────────────────────
const isInterchange = (stop: SimplifiedStop) =>
    stop.arrivalTime !== '--:--' &&
    stop.departureTime !== '--:--' &&
    stop.arrivalTime !== stop.departureTime;

// ──────────────────────────────────────────────
//  Time cell — realtime bold amber, planned crossed out
// ──────────────────────────────────────────────
const TimeCell = ({ planned, realtime }: { planned: string; realtime?: string }) => {
    const hasRt = realtime && realtime !== planned && realtime !== '--:--';
    if (planned === '--:--' && !hasRt) return <div className="min-w-[3rem]" />;
    return (
        <div className="flex flex-col items-end min-w-[3rem] text-right">
            {hasRt ? (
                <>
                    <span className="text-[10px] font-mono line-through text-slate-400 dark:text-slate-600 leading-none">
                        {planned}
                    </span>
                    <span className="text-xs font-black font-mono text-amber-500 dark:text-amber-400 leading-none mt-0.5">
                        {realtime}
                    </span>
                </>
            ) : (
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-300">
                    {planned !== '--:--' ? planned : ''}
                </span>
            )}
        </div>
    );
};

const RefreshBadge = ({ lastRefresh, onRefresh, loading }: { lastRefresh: Date | null; onRefresh: () => void; loading: boolean }) => {
    const label = lastRefresh
        ? `Uppdaterad ${lastRefresh.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
        : 'Hämtar…';
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{label}</span>
            <button
                onClick={onRefresh}
                disabled={loading}
                className="p-1 rounded-full text-slate-400 hover:text-sky-500 transition-colors disabled:opacity-40"
                title="Uppdatera nu"
            >
                <FontAwesomeIcon icon={faRotate} className={loading ? 'animate-spin' : ''} size="xs" />
            </button>
        </div>
    );
};

export const DepartureDetailsModal: React.FC<DepartureDetailsModalProps> = ({ departure, onClose, stationName }) => {
    const fromUrl = useTripDetails(departure.journeyDetailRefUrl || null, 30_000);
    const fromRef = useTripDetailsFromRef(
        departure.journeyDetailRefUrl ? null : (departure.journeyRef || null),
        30_000
    );
    const useRefSource = !departure.journeyDetailRefUrl && !!departure.journeyRef;
    const { stops, loading, error, lastRefresh, refresh } = useRefSource ? fromRef : fromUrl;

    const isTrafikverket = departure.provider === Provider.TRAFIKVERKET;
    const guessedTrack = isTrafikverket && !departure.track
        ? guessTrafikverketTrack(departure.direction)
        : undefined;

    const { isWatched, watch, unwatch } = useJourneyWatcher();
    const watched = isWatched(departure.id);
    const toast = useToast();

    const displayStops = (() => {
        if (stops.length > 0) return stops;
        if (useRefSource && stationName && departure.direction) {
            return [
                { name: stationName, arrivalTime: '--:--', departureTime: departure.realtime || departure.time, track: departure.track || '' },
                { name: departure.direction, arrivalTime: '--:--', departureTime: '--:--', track: '' }
            ];
        }
        return stops;
    })();

    const [progress, setProgress] = useState<number>(-1);

    useEffect(() => {
        if (!displayStops || displayStops.length < 2) return;

        const updateProgress = () => {
            const first = displayStops[0];
            const last = displayStops[displayStops.length - 1];
            
            const startStr = first.realtimeDeparture || first.departureTime;
            const endStr = last.realtimeArrival || last.arrivalTime;
            
            if (!startStr || !endStr || startStr === '--:--' || endStr === '--:--') {
                setProgress(-1);
                return;
            }

            const now = new Date();
            const parseTime = (t: string) => {
                const d = new Date();
                const [h, m] = t.split(':').map(Number);
                d.setHours(h, m, 0, 0);
                return d.getTime();
            };

            const startTs = parseTime(startStr);
            const endTs = parseTime(endStr);
            const nowTs = now.getTime();

            if (nowTs < startTs) setProgress(0);
            else if (nowTs > endTs) setProgress(100);
            else {
                const p = ((nowTs - startTs) / (endTs - startTs)) * 100;
                setProgress(p);
            }
        };

        updateProgress();
        const interval = setInterval(updateProgress, 10000);
        return () => clearInterval(interval);
    }, [displayStops]);

    const handleWatchToggle = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (watched) {
        await unwatch(departure.id);
        toast.info('Bevakning borttagen');
      } else {
        const success = await watch({
            id: departure.id,
            from_name: stationName || 'Okänd',
            to_name: departure.direction,
            departure_time: departure.time,
            arrival_time: departure.realtime || departure.time,
            line_summary: departure.line,
            duration_min: 0,
            provider: departure.provider
          } as any);
          if (success) toast.info('Resan bevakas nu!');
      }
    };

    const { addAlarm } = useAlarms();

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300"
            >
                {/* Drag handle */}
                <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
                    <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
                </div>

                {/* Header */}
                <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-3 shrink-0 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                            className="h-10 min-w-[2.8rem] px-2 rounded-xl flex items-center justify-center font-black text-xl shadow-sm shrink-0"
                            style={{ backgroundColor: departure.bgColor || '#0ea5e9', color: departure.fgColor || '#ffffff' }}
                        >
                            {departure.line}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="font-black text-base leading-tight truncate text-slate-800 dark:text-white uppercase tracking-tight">Mot {departure.direction}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                                {departure.realtime && departure.realtime !== departure.time ? (
                                    <span className="flex items-center gap-1 text-xs">
                                        <span className="line-through text-slate-400 font-mono">{departure.time}</span>
                                        <span className="font-black text-amber-500 font-mono">{departure.realtime}</span>
                                    </span>
                                ) : (
                                    <span className="text-xs font-bold font-mono text-slate-800 dark:text-slate-200">{departure.time}</span>
                                )}
                                {(departure.track && departure.track !== 'X') && (
                                    <span className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-700">
                                        <span className="text-[9px] uppercase tracking-wider text-slate-400">Läge</span>
                                        <PlatformBadge track={departure.track} />
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleWatchToggle}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-black transition-all active:scale-95 ${
                                watched 
                                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30' 
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-700'
                            }`}
                        >
                            <FontAwesomeIcon icon={watched ? faStarSolid : faBell} />
                            <span className="hidden xs:inline">{watched ? 'Bevakar' : 'Bevaka'}</span>
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
                            <FontAwesomeIcon icon={faTimes} size="lg" />
                        </button>
                    </div>
                </div>

                {/* Timeline */}
                <div className="flex-1 overflow-y-auto px-4 py-2 bg-slate-50/30 dark:bg-slate-950/20">
                    {loading && stops.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <ThemedSpinner size={32} />
                            <p className="text-xs font-bold text-slate-400 animate-pulse">HÄMTAR RESPLAN...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                            <FontAwesomeIcon icon={faExclamationTriangle} className="text-3xl text-amber-500" />
                            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Kunde inte ladda detaljer</p>
                            <p className="text-xs opacity-70">{error}</p>
                            <button onClick={() => refresh()} className="mt-4 px-4 py-2 bg-sky-500 text-white rounded-full text-xs font-bold">Försök igen</button>
                        </div>
                    ) : displayStops.length > 0 ? (
                        <div className="relative pt-4 pb-8">
                            {/* Vertical timeline line */}
                            <div className="absolute left-[11px] sm:left-[17px] top-6 bottom-8 w-0.5 bg-slate-200 dark:bg-slate-700/50" />
                            
                            {/* Progress marker */}
                            {progress >= 0 && <JourneyProgressMarker progress={progress} />}

                            <div className="space-y-0 relative z-10">
                                {displayStops.map((stop, idx) => {
                                    const isFirst = idx === 0;
                                    const isLast = idx === displayStops.length - 1;
                                    const isCurrent = stop.name === stationName;
                                    const isXchange = isInterchange(stop) && !isFirst && !isLast;
                                    const effectiveTrack = stop.track || (isTrafikverket && !stop.track ? guessedTrack : undefined);

                                    return (
                                        <div key={idx} className="relative">
                                            {isXchange ? (
                                                <div className="flex gap-4 sm:gap-6">
                                                    <div className="flex flex-col items-center shrink-0 w-6 sm:w-8">
                                                        <div className={`w-2 h-2 rounded-full border-2 mt-4 z-10 ${isCurrent ? 'bg-sky-500 border-sky-500' : 'bg-white dark:bg-slate-900 border-slate-400'}`} />
                                                        <div className="w-0.5 bg-slate-200 dark:bg-slate-700 flex-1 my-1" />
                                                        <div className={`w-2 h-2 rounded-full border-2 mb-4 z-10 ${isCurrent ? 'bg-sky-400 border-sky-400' : 'bg-white dark:bg-slate-900 border-slate-300'}`} />
                                                    </div>
                                                    <div className="flex-1 min-w-0 border-b border-slate-100 dark:border-slate-800/40">
                                                        <div className={`flex items-center justify-between py-2 ${isCurrent ? 'bg-sky-500/5 px-2 rounded-t-lg' : ''}`}>
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="text-[8px] font-black font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded uppercase">Ank</span>
                                                                <h3 className={`text-sm font-bold truncate ${isCurrent ? 'text-sky-600 dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'}`}>{stop.name}</h3>
                                                            </div>
                                                            <TimeCell planned={stop.arrivalTime} realtime={stop.realtimeArrival} />
                                                        </div>
                                                        <div className={`flex items-center justify-between py-2 ${isCurrent ? 'bg-sky-500/5 px-2 rounded-b-lg' : ''}`}>
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="text-[8px] font-black font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded uppercase">Avg</span>
                                                                <h3 className={`text-sm font-bold truncate ${isCurrent ? 'text-sky-600 dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'}`}>{stop.name}</h3>
                                                                {effectiveTrack && <PlatformBadge track={effectiveTrack} small />}
                                                            </div>
                                                            <TimeCell planned={stop.departureTime} realtime={stop.realtimeDeparture} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex gap-4 sm:gap-6">
                                                    <div className="flex flex-col items-center shrink-0 w-6 sm:w-8">
                                                        <div className={`w-3 h-3 rounded-full border-2 mt-4 z-10 ${
                                                            isFirst || isLast 
                                                                ? 'bg-sky-600 border-sky-600 ring-4 ring-sky-500/20' 
                                                                : isCurrent 
                                                                ? 'bg-sky-400 border-sky-400' 
                                                                : 'bg-white dark:bg-slate-900 border-slate-300'
                                                        }`} />
                                                    </div>
                                                    <div className={`flex-1 flex items-center justify-between py-4 min-w-0 gap-3 border-b border-slate-100 dark:border-slate-800/40 ${isCurrent ? 'bg-sky-500/5 px-2 rounded-lg -mx-2' : ''}`}>
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <h3 className={`text-sm truncate ${
                                                                isFirst || isLast 
                                                                    ? 'font-black text-slate-900 dark:text-white uppercase' 
                                                                    : isCurrent 
                                                                    ? 'font-bold text-sky-700 dark:text-sky-300' 
                                                                    : 'font-semibold text-slate-600 dark:text-slate-300'
                                                            }`}>{stop.name}</h3>
                                                            {effectiveTrack && <PlatformBadge track={effectiveTrack} small />}
                                                            {isCurrent && <span className="px-1.5 py-0.5 rounded-md bg-sky-100 dark:bg-sky-900/40 text-[9px] font-black text-sky-600 dark:text-sky-400 uppercase">Här</span>}
                                                        </div>
                                                        <TimeCell planned={stop.departureTime !== '--:--' ? stop.departureTime : stop.arrivalTime} realtime={stop.realtimeDeparture || stop.realtimeArrival} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400 opacity-60">
                            <FontAwesomeIcon icon={faInfoCircle} className="text-4xl mb-3" />
                            <p className="text-sm font-bold">Inga hållplatser hittades</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-white dark:bg-slate-950/80 border-t border-slate-100 dark:border-slate-800 shrink-0 flex justify-between items-center">
                    <RefreshBadge lastRefresh={lastRefresh} onRefresh={refresh} loading={loading} />
                    <button
                        onClick={() => {
                            const dueTime = new Date(departure.timestamp);
                            dueTime.setMinutes(dueTime.getMinutes() - 5);
                            addAlarm({
                                id: `${departure.id}-${Date.now()}`,
                                departureTime: departure.timestamp,
                                dueTime: dueTime.getTime(),
                                stationName: stationName || 'Okänd',
                                line: departure.line,
                                direction: departure.direction,
                                journeyRef: departure.journeyRef
                            });
                            toast.success('Påminnelse satt', 'Vi meddelar dig 5 min innan avgång');
                        }}
                        className="bg-sky-500 hover:bg-sky-600 active:scale-95 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg shadow-sky-500/20 flex items-center gap-2 transition-all"
                    >
                        <FontAwesomeIcon icon={faClock} />
                        Bevaka avgång
                    </button>
                </div>
            </div>
        </div>
    );
};
