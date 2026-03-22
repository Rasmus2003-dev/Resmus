import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch, faClock, faMapPin, faSpinner, faExclamationCircle,
  faBus, faTram, faShip, faWalking, faArrowRightArrowLeft,
  faTimes, faCalendarAlt, faChevronRight, faFlag,
  faExclamationTriangle, faLocationArrow, faBell, faBellSlash,
  faCheckCircle, faTrainSubway, faStar
} from '@fortawesome/free-solid-svg-icons';
import { TransitService } from '../services/transitService';
import { Station, Journey, TripLeg, Provider } from '../types';
import { JourneySkeleton, ThemedSpinner } from './Loaders';
import { useJourneyWatcher, WatchedJourney } from '../hooks/useJourneyWatcher';
import { useToast } from './ToastProvider';

// ─── Transport Icon ──────────────────────────────────────────────────────────
const TransportIcon = ({ type, size = 14 }: { type: string; size?: number }) => {
  const t = type.toUpperCase();
  let icon = faBus;
  if (t === 'TRAM') icon = faTram;
  else if (t === 'TRAIN') icon = faTrainSubway;
  else if (t === 'FERRY') icon = faShip;
  else if (t === 'WALK') icon = faWalking;
  return <FontAwesomeIcon icon={icon} style={{ fontSize: size }} />;
};

// ─── Duration ────────────────────────────────────────────────────────────────
const calcDuration = (start: string, end: string) => {
  try {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let d = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (d < 0) d += 1440;
    if (d >= 60) return `${Math.floor(d / 60)} h ${d % 60} min`;
    return `${d} min`;
  } catch { return '–'; }
};

const countTransfers = (legs: TripLeg[]) => Math.max(0, legs.filter(l => l.type !== 'WALK').length - 1);

const getLocalDate = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

// ─── Station Search Input ────────────────────────────────────────────────────
interface StationInputProps {
  label: string;
  placeholder: string;
  value: Station | null;
  query: string;
  results: Station[];
  onQueryChange: (q: string) => void;
  onSelect: (s: Station) => void;
  onClear: () => void;
  onUseLocation?: () => void;
  locating?: boolean;
  dot?: 'origin' | 'dest';
}
const StationInput: React.FC<StationInputProps> = ({
  label, placeholder, value, query, results, onQueryChange, onSelect, onClear, onUseLocation, locating, dot
}) => (
  <div className="relative">
    <div className={`flex items-center bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border-2 transition-all gap-3 ${value ? 'border-sky-400/40 dark:border-sky-500/30' : 'border-slate-200 dark:border-slate-700 focus-within:border-sky-400 dark:focus-within:border-sky-500'}`}>
      {/* Dot indicator */}
      <div className="flex-shrink-0">
        {dot === 'origin' ? (
          <div className="w-3 h-3 rounded-full border-[3px] border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-800" />
        ) : (
          <FontAwesomeIcon icon={faMapPin} className="text-sky-500 text-base" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{label}</div>
        <input
          type="text"
          placeholder={placeholder}
          className="w-full bg-transparent outline-none text-slate-800 dark:text-white font-semibold text-[15px] placeholder:text-slate-300 dark:placeholder:text-slate-600 leading-tight"
          value={value ? value.name : query}
          onChange={e => { onQueryChange(e.target.value); }}
        />
      </div>
      {value || query ? (
        <button onClick={onClear} className="p-1.5 text-slate-300 hover:text-slate-500 dark:hover:text-slate-300 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-700">
          <FontAwesomeIcon icon={faTimes} className="text-sm" />
        </button>
      ) : onUseLocation ? (
        <button onClick={onUseLocation} disabled={locating} className="p-1.5 text-sky-400 hover:text-sky-600 transition-colors rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20" title="Min plats">
          {locating ? <FontAwesomeIcon icon={faSpinner} spin className="text-sm" /> : <FontAwesomeIcon icon={faLocationArrow} className="text-sm" />}
        </button>
      ) : null}
    </div>
    {/* Dropdown */}
    {results.length > 0 && !value && (
      <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl shadow-slate-200/50 dark:shadow-black/30 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {results.slice(0, 6).map((s, i) => (
          <button key={i} onClick={() => { onSelect(s); }}
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors border-b last:border-0 border-slate-100 dark:border-slate-700/50">
            <div className="w-7 h-7 rounded-full bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0">
              <FontAwesomeIcon icon={faMapPin} className="text-sky-500 text-xs" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{s.name}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                {s.provider === Provider.SL ? 'Stockholm' : s.provider === Provider.VASTTRAFIK ? 'Västtrafik' : s.provider === Provider.TRAFIKVERKET ? 'Tåg' : 'ResRobot'}
              </div>
            </div>
          </button>
        ))}
      </div>
    )}
  </div>
);

// ─── Journey Card ─────────────────────────────────────────────────────────────
interface JourneyCardProps {
  journey: Journey;
  isExpanded: boolean;
  onToggle: () => void;
  fromName: string;
  toName: string;
  watched: boolean;
  onWatch: () => void;
}
const JourneyCard: React.FC<JourneyCardProps> = ({ journey: j, isExpanded, onToggle, fromName, toName, watched, onWatch }) => {
  const transfers = countTransfers(j.legs);
  const duration = calcDuration(j.startTime, j.endTime);
  const hasIssue = j.legs.some(l => l.cancelled || l.disruptionSeverity === 'severe');
  const hasWarning = !hasIssue && j.legs.some(l => l.messages && l.messages.length > 0);
  const walkMins = j.legs.reduce((acc, l) => l.type === 'WALK' ? acc + l.duration : acc, 0);

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-2xl border overflow-hidden transition-all duration-200 ${hasIssue ? 'border-red-200 dark:border-red-900/40' : 'border-slate-100 dark:border-slate-800'} shadow-sm hover:shadow-md`}>

      {/* Summary Row */}
      <div onClick={onToggle} className="p-4 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors select-none">
        <div className="flex items-start justify-between gap-3 mb-3">
          {/* Times */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{j.startTime}</span>
            <span className="text-slate-300 dark:text-slate-600 font-bold">→</span>
            <span className="text-xl font-bold text-slate-500 dark:text-slate-400">{j.endTime}</span>
          </div>
          {/* Duration pill + badges */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
              <FontAwesomeIcon icon={faClock} className="text-slate-400 text-[10px]" />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{duration}</span>
            </div>
            {hasIssue && (
              <span className="text-[10px] font-bold text-red-500 flex items-center gap-1 animate-pulse">
                <FontAwesomeIcon icon={faExclamationCircle} /> Störning
              </span>
            )}
            {hasWarning && (
              <span className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
                <FontAwesomeIcon icon={faExclamationTriangle} /> Info
              </span>
            )}
          </div>
        </div>

        {/* Leg Pills */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {j.legs.map((leg, li) => {
            if (leg.type === 'WALK') {
              if (leg.duration < 3) return null;
              return (
                <React.Fragment key={li}>
                  <div className="flex items-center gap-0.5 text-slate-400 dark:text-slate-500 text-[11px] font-bold">
                    <FontAwesomeIcon icon={faWalking} />
                    <span>{leg.duration}m</span>
                  </div>
                  {li < j.legs.length - 1 && <div className="w-3 h-px bg-slate-200 dark:bg-slate-700" />}
                </React.Fragment>
              );
            }
            return (
              <React.Fragment key={li}>
                {li > 0 && !j.legs[li - 1] && <div className="w-3 h-px bg-slate-200 dark:bg-slate-700" />}
                <div
                  className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-black shadow-sm ${leg.cancelled ? 'opacity-50 line-through' : ''}`}
                  style={{ backgroundColor: leg.bgColor || '#0ea5e9', color: leg.fgColor || '#fff' }}
                >
                  <TransportIcon type={leg.type} size={11} />
                  <span>{leg.name.replace(/\D/g, '') || leg.name.slice(0, 4)}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
          <div className="flex items-center gap-2 font-medium">
            {transfers === 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">Direktresa</span>
            ) : (
              <span>{transfers} byte{transfers > 1 ? 'n' : ''}</span>
            )}
            {walkMins > 0 && (
              <>
                <span>·</span>
                <span>{walkMins} min gång</span>
              </>
            )}
          </div>
          <FontAwesomeIcon icon={faChevronRight} className={`transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4">
          <div className="relative">
            {/* Vertical timeline bar */}
            <div className="absolute left-[3.35rem] top-2 bottom-4 w-px bg-slate-200 dark:bg-slate-800" />

            {j.legs.map((leg, idx) => {
              const isLast = idx === j.legs.length - 1;
              const isWalk = leg.type === 'WALK';
              return (
                <React.Fragment key={idx}>
                  <div className="flex gap-3 mb-5 last:mb-0">
                    {/* Time */}
                    <div className="w-11 text-right flex-shrink-0 pt-0.5">
                      <span className="text-xs font-black text-slate-700 dark:text-slate-200 font-mono">{leg.origin.time}</span>
                    </div>
                    {/* Node */}
                    <div className="relative z-10 flex-shrink-0 pt-1">
                      <div className={`w-3 h-3 rounded-full border-2 ${isWalk ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600' : 'bg-white dark:bg-slate-900 border-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.15)]'}`} />
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-bold text-sm text-slate-800 dark:text-white truncate">{leg.origin.name}</span>
                        {leg.origin.track && (
                          <div className="w-5 h-5 rounded-full bg-slate-950 dark:bg-black text-slate-100 border border-slate-800 dark:border-slate-700 flex items-center justify-center text-[9px] font-black flex-shrink-0 shadow-sm">
                            {leg.origin.track}
                          </div>
                        )}
                      </div>
                      {/* Transport Card */}
                      <div className={`p-2.5 rounded-xl border flex items-center gap-2.5 ${isWalk ? 'bg-transparent border-dashed border-slate-300 dark:border-slate-700' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 shadow-sm'}`}>
                        <div
                          className="h-8 min-w-[32px] px-2 rounded-lg flex items-center justify-center gap-1 text-xs font-black flex-shrink-0 shadow-sm"
                          style={isWalk
                            ? { backgroundColor: '#e2e8f0', color: '#64748b' }
                            : { backgroundColor: leg.bgColor || '#0ea5e9', color: leg.fgColor || '#fff' }
                          }
                        >
                          <TransportIcon type={leg.type} size={11} />
                          {!isWalk && <span>{leg.name.replace(/\D/g, '') || leg.name.slice(0, 4)}</span>}
                        </div>
                        <div className="min-w-0">
                          {isWalk ? (
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                              Gång {leg.duration} min{leg.distance ? ` · ${leg.distance}m` : ''}
                            </span>
                          ) : (
                            <>
                              <div className="font-bold text-sm text-slate-800 dark:text-white truncate">{leg.name}</div>
                              <div className="text-xs text-slate-400 dark:text-slate-500 truncate">mot {leg.direction}</div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Final destination */}
                  {isLast && (
                    <div className="flex gap-3 items-start bg-sky-50 dark:bg-sky-900/10 -mx-4 px-4 py-3 border-t border-sky-100 dark:border-sky-900/30 mt-2 rounded-b-xl">
                      <div className="w-11 text-right flex-shrink-0">
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200 font-mono">{leg.destination.time}</span>
                      </div>
                      <div className="relative z-10 pt-0.5 flex-shrink-0">
                        <div className="w-4 h-4 rounded-full bg-slate-800 dark:bg-white flex items-center justify-center shadow-md">
                          <FontAwesomeIcon icon={faFlag} className="text-white dark:text-slate-900 text-[7px]" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-black text-sm text-slate-900 dark:text-white">{leg.destination.name}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Slutstation · Ankomst</div>
                          </div>
                          {leg.destination.track && (
                            <div className="w-6 h-6 rounded-full bg-slate-950 dark:bg-black text-slate-100 border border-slate-800 dark:border-slate-700 flex items-center justify-center text-[10px] font-black shadow-sm">
                              {leg.destination.track}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Watch Journey Button */}
          <button
            onClick={e => { e.stopPropagation(); onWatch(); }}
            className={`mt-4 w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${watched
              ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800'
              : 'bg-sky-500 hover:bg-sky-600 text-white shadow-md shadow-sky-500/20'}`}
          >
            <FontAwesomeIcon icon={watched ? faBell : faBell} className={watched ? 'animate-wiggle' : ''} />
            {watched ? 'Bevakar denna resa' : 'Bevaka resa'}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Main TripPlanner ─────────────────────────────────────────────────────────
export const TripPlanner: React.FC = () => {
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [fromStation, setFromStation] = useState<Station | null>(null);
  const [toStation, setToStation] = useState<Station | null>(null);
  const [provider, setProvider] = useState<Provider>(() => {
    return (localStorage.getItem('resmus_storage_provider') as Provider) || Provider.VASTTRAFIK;
  });
  const [favorites, setFavorites] = useState<Station[]>([]);
  const [resultsFrom, setResultsFrom] = useState<Station[]>([]);
  const [resultsTo, setResultsTo] = useState<Station[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [timeMode, setTimeMode] = useState<'now' | 'later'>('now');
  const [tripDate, setTripDate] = useState(getLocalDate);
  const [tripTime, setTripTime] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  });

  const { watch, unwatch, isWatched } = useJourneyWatcher();
  const toast = useToast();

  useEffect(() => {
    const saved = localStorage.getItem('resmus_favorites');
    if (saved) setFavorites(JSON.parse(saved));
  }, []);
  // Debounced station search
  useEffect(() => {
    const t = setTimeout(() => {
      if (fromQuery.length > 2 && !fromStation) {
        TransitService.searchStations(fromQuery, provider).then(setResultsFrom).catch(() => setResultsFrom([]));
      } else if (!fromQuery) setResultsFrom([]);
    }, 280);
    return () => clearTimeout(t);
  }, [fromQuery, fromStation, provider]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (toQuery.length > 2 && !toStation) {
        TransitService.searchStations(toQuery, provider).then(setResultsTo).catch(() => setResultsTo([]));
      } else if (!toQuery) setResultsTo([]);
    }, 280);
    return () => clearTimeout(t);
  }, [toQuery, toStation, provider]);

  const handleMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const nearby = await TransitService.getNearbyStations(pos.coords.latitude, pos.coords.longitude);
        if (nearby.length > 0) { setFromStation(nearby[0]); setFromQuery(nearby[0].name); setResultsFrom([]); }
      } finally { setLocating(false); }
    }, () => setLocating(false));
  };

  const handleSwap = () => {
    const [qs, ql, st] = [toQuery, fromQuery, fromStation];
    setFromQuery(toQuery); setFromStation(toStation);
    setToQuery(ql); setToStation(st);
    setResultsFrom([]); setResultsTo([]);
  };

  const handleSearch = async () => {
    if (!fromStation || !toStation) return;
    setLoading(true); setError(null); setJourneys([]); setHasSearched(false); setExpandedId(null);
    try {
      const iso = timeMode === 'later' ? `${tripDate}T${tripTime}:00` : undefined;
      const results = await TransitService.planTrip(fromStation.id, toStation.id, iso, provider);
      if (!results.length) setError('Inga resor hittades för vald tid. Prova ett annat klockslag.');
      setJourneys(results);
    } catch {
      setError('Kunde inte hämta resor. Kontrollera din anslutning.');
    } finally {
      setLoading(false); setHasSearched(true);
    }
  };

  const handleWatch = async (j: Journey) => {
    const id = `${j.id}`;
    if (isWatched(id)) { await unwatch(id); toast.success('Bevakning borttagen', ''); return; }
    const legSummary = j.legs.filter(l => l.type !== 'WALK').map(l => l.name).join(' → ');
    const journey: WatchedJourney = {
      id,
      from_name: fromStation?.name || '?',
      to_name: toStation?.name || '?',
      departure_time: j.legs[0]?.origin.time || j.startTime,
      arrival_time: j.legs[j.legs.length - 1]?.destination.time || j.endTime,
      line_summary: legSummary,
      duration_min: j.duration,
    };
    const ok = await watch(journey);
    if (ok) toast.success('Resa bevakad! 🔔', 'Du får notis vid störningar eller förseningar.');
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">

      {/* ── Search Panel ──────────────────────────────────────────────────── */}
      <div className="flex-none z-40 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-4 pt-4 pb-3 space-y-2">

        <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">Sök resa</h2>
            {/* Provider Toggle */}
            <div className="flex gap-1 bg-slate-200/50 dark:bg-slate-800 rounded-lg p-0.5">
                {[Provider.VASTTRAFIK, Provider.SL, Provider.RESROBOT].map(p => (
                    <button
                        key={p}
                        onClick={() => setProvider(p)}
                        className={`px-2 py-0.5 rounded text-[9px] font-black transition-all ${provider === p ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {p === Provider.VASTTRAFIK ? 'VT' : p === Provider.SL ? 'SL' : 'RR'}
                    </button>
                ))}
            </div>
        </div>

        {/* From / To inputs + swap */}
        <div className="relative space-y-2">
          {/* Connector line */}
          <div className="absolute left-[1.35rem] top-10 bottom-10 w-px bg-gradient-to-b from-slate-300 to-sky-400 dark:from-slate-600 dark:to-sky-600" />

          <StationInput
            label="Från" placeholder="Avreseplats..." value={fromStation} query={fromQuery}
            results={resultsFrom} dot="origin"
            onQueryChange={q => { setFromQuery(q); setFromStation(null); }}
            onSelect={s => { setFromStation(s); setResultsFrom([]); setFromQuery(s.name); }}
            onClear={() => { setFromStation(null); setFromQuery(''); setResultsFrom([]); }}
            onUseLocation={handleMyLocation} locating={locating}
          />

          <StationInput
            label="Till" placeholder="Destination..." value={toStation} query={toQuery}
            results={resultsTo} dot="dest"
            onQueryChange={q => { setToQuery(q); setToStation(null); }}
            onSelect={s => { setToStation(s); setResultsTo([]); setToQuery(s.name); }}
            onClear={() => { setToStation(null); setToQuery(''); setResultsTo([]); }}
          />

          {/* Swap button */}
          <button
            onClick={handleSwap}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-full flex items-center justify-center text-slate-400 hover:text-sky-500 hover:border-sky-300 dark:hover:border-sky-600 transition-all shadow-sm hover:shadow active:rotate-180"
            title="Växla"
          >
            <FontAwesomeIcon icon={faArrowRightArrowLeft} className="rotate-90 text-xs" />
          </button>
        </div>

        {/* Time mode + Search button */}
        <div className="flex gap-2 items-center">
          <div className="flex bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 rounded-xl flex-1 gap-1">
            <button
              onClick={() => setTimeMode('now')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${timeMode === 'now' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'}`}
            >Nu</button>
            <button
              onClick={() => setTimeMode('later')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${timeMode === 'later' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'}`}
            >
              <FontAwesomeIcon icon={faCalendarAlt} className="text-[10px]" />
              {timeMode === 'later' ? `${tripDate.slice(5)} ${tripTime}` : 'Välj tid'}
            </button>
          </div>
          <button
            onClick={handleSearch}
            disabled={!fromStation || !toStation || loading}
            className="bg-sky-500 hover:bg-sky-600 disabled:opacity-40 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-black px-5 py-2.5 rounded-xl shadow-md shadow-sky-500/20 transition-all active:scale-95 flex items-center gap-2"
          >
            {loading ? <ThemedSpinner size={18} /> : <FontAwesomeIcon icon={faSearch} />}
          </button>
        </div>

        {/* Date/Time pickers */}
        {timeMode === 'later' && (
          <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-1 fade-in duration-200">
            <input type="date" value={tripDate} onChange={e => setTripDate(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-sky-500 transition-colors" />
            <input type="time" value={tripTime} onChange={e => setTripTime(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-sky-500 transition-colors text-center" />
          </div>
        )}

        {/* Favorite Stations shortcut */}
        {!hasSearched && !loading && favorites.length > 0 && (
          <div className="flex gap-2 overflow-x-auto py-1 no-scrollbar animate-in fade-in duration-500">
            {favorites.map(fav => (
              <button
                key={fav.id}
                onClick={() => {
                  if (!fromStation) {
                    setFromStation(fav); setFromQuery(fav.name);
                  } else {
                    setToStation(fav); setToQuery(fav.name);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-full text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:border-sky-300 transition-all whitespace-nowrap shadow-sm"
              >
                <FontAwesomeIcon icon={faStar} className="text-yellow-500 text-[10px]" />
                {fav.name.split(',')[0]}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-400 font-medium animate-in fade-in">
            <FontAwesomeIcon icon={faExclamationTriangle} className="text-red-400 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28 space-y-3">

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3 animate-in fade-in">
            <JourneySkeleton /><JourneySkeleton />
          </div>
        )}

        {/* Empty pre-search */}
        {!loading && !hasSearched && (
          <div className="flex flex-col items-center justify-center mt-16 opacity-40 space-y-3 animate-in zoom-in-95 duration-500">
            <div className="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-3xl flex items-center justify-center rotate-3">
              <FontAwesomeIcon icon={faSearch} className="text-slate-400 text-3xl" />
            </div>
            <p className="font-bold text-slate-400 text-sm uppercase tracking-widest text-center">Välj avrese- och<br />destinationsplats</p>
          </div>
        )}

        {/* No results */}
        {!loading && hasSearched && journeys.length === 0 && (
          <div className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center animate-in fade-in">
            <FontAwesomeIcon icon={faExclamationCircle} className="text-slate-400 text-3xl mb-3" />
            <p className="font-bold text-slate-600 dark:text-slate-300">Inga resor hittades</p>
            <p className="text-sm text-slate-400 mt-1">Prova en annan tid eller rutt.</p>
          </div>
        )}

        {/* Journey Cards */}
        {journeys.map(j => (
          <JourneyCard
            key={j.id}
            journey={j}
            isExpanded={expandedId === j.id}
            onToggle={() => setExpandedId(expandedId === j.id ? null : j.id)}
            fromName={fromStation?.name || ''}
            toName={toStation?.name || ''}
            watched={isWatched(j.id)}
            onWatch={() => handleWatch(j)}
          />
        ))}
      </div>
    </div>
  );
};
