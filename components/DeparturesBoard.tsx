import React, { useState, useEffect } from 'react';
import { Departure, Station, Provider, JourneyDetail, TrafficSituation } from '../types';
import { TransitService } from '../services/transitService';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Navigation } from 'lucide-react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faMapPin, faArrowUp, faArrowDown, faChevronUp, faExclamationCircle, faExclamationTriangle, faArrowsAltV, faCalendarAlt, faTimes, faBus, faLocationArrow, faTram, faShip, faBan, faStar, faTrash, faWalking, faTaxi, faFilter, faChevronLeft, faChevronRight, faInfoCircle, faGlobe, faMap, faTrain, faSubway, faMapMarkerAlt, faLocationDot, faSearchPlus, faSearchMinus } from '@fortawesome/free-solid-svg-icons';
import { DepartureSkeleton, ThemedSpinner } from './Loaders';

import { WeatherDisplay } from './WeatherDisplay';
import { useAlarms } from '../hooks/useAlarms';

const DepartureRouteMap = React.lazy(() => import('./DepartureRouteMap').then(module => ({ default: module.DepartureRouteMap })));
const TripPlanner = React.lazy(() => import('./TripPlanner').then(module => ({ default: module.TripPlanner })));
import { DepartureDetailsModal } from './DepartureDetailsModal';
import { useToast } from './ToastProvider';
import { faShareAlt } from '@fortawesome/free-solid-svg-icons';

interface DeparturesBoardProps {
  initialStation?: Station;
  mode?: 'departures' | 'arrivals';
}

const DepartureRow = React.memo(({
  dep,
  isDense,
  isExpanded,
  toggleExpand,
  timeDisplayMode,
  stationName,
  viewMode
}: {
  dep: Departure,
  isDense: boolean,
  isExpanded: boolean,
  toggleExpand: (dep: Departure) => void,
  timeDisplayMode: 'minutes' | 'clock',
  stationName: string,
  viewMode: 'departures' | 'arrivals'
}) => {
  const isCancelled = dep.status === 'CANCELLED';
  const hasRealtime = !!dep.realtime;
  const isDeviation = hasRealtime && dep.realtime !== dep.time;

  let displayDirection = dep.direction;
  if ((displayDirection === 'Okänd' || displayDirection === '') && stationName) {
    displayDirection = viewMode === 'arrivals' ? "Ankommande" : stationName;
  }

  const diff = dep.timestamp ? (new Date(dep.timestamp).getTime() - Date.now()) / 60000 : 0;
  // Don't render past events in the list (handled by parent filter usually, but safe guard)
  // if (diff < -0.5) return null; 

  const minsRemaining = Math.ceil(diff);
  const originalTime = dep.time;
  const newTime = dep.realtime && dep.realtime !== dep.time ? dep.realtime : null;

  return (
    <div className="group/row">
      <div
        onClick={() => toggleExpand(dep)}
        className={`relative ${isDense ? 'px-2 py-1' : 'px-3 py-2'} hover:bg-sky-50/40 dark:hover:bg-slate-800/60 transition-colors cursor-pointer group border-b border-slate-100 dark:border-slate-800/50 ${isCancelled ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}
      >
        <div className="flex items-center gap-3">
          {/* Line Badge - Compact */}
          <div className={`${isDense ? 'w-8' : 'w-10'} flex-shrink-0 flex justify-center`}>
            <div
              className={`${isDense ? 'h-5 px-1 min-w-[1.5rem] text-[10px]' : 'h-6 px-1.5 min-w-[2rem] text-xs'} rounded flex items-center justify-center font-bold shadow-sm transition-transform group-hover:scale-105 ${isCancelled ? 'opacity-75' : ''}`}
              style={{
                backgroundColor: dep.bgColor || '#475569',
                color: dep.fgColor || '#ffffff'
              }}
            >
              {dep.line}
            </div>
          </div>

          {/* Destination */}
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className={`${isDense ? 'text-xs' : 'text-sm'} font-bold truncate ${isCancelled ? 'text-red-700 dark:text-red-400 line-through decoration-red-500 decoration-2' : 'text-slate-900 dark:text-slate-100'}`}>
                  {displayDirection}
                </span>
              </div>
              {dep.track === 'X' && (
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                  <FontAwesomeIcon icon={faTaxi} className="text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-500">Turen behöver förbeställas 1h innan</span>
                </div>
              )}
            </div>
          </div>

          {/* Watch Button & Disruption */}
          <div className="mr-2 flex items-center gap-2">
            {dep.hasDisruption && (
              <div className="text-amber-500" title={dep.disruptionMessage || "Trafikstörning"}>
                <FontAwesomeIcon icon={faExclamationTriangle} />
              </div>
            )}
          </div>

          {/* Time & Track */}
          <div className="flex items-center gap-2 text-right justify-end ml-auto">
            <div className="w-12 flex flex-col items-end">
              <div className={`font-bold leading-none ${isDense ? 'text-xs' : 'text-sm'} ${isDeviation ? 'text-slate-400 dark:text-slate-500' + (isDense ? ' text-[10px]' : ' text-xs') : 'text-slate-900 dark:text-slate-100'}`}>
                {timeDisplayMode === 'minutes' ? (minsRemaining <= 0 ? "Nu" : `${minsRemaining} min`) : (isDeviation ? <span className="line-through">{originalTime}</span> : originalTime)}
              </div>
            </div>

            <div className={`w-12 font-bold ${isDense ? 'text-xs' : 'text-sm'} flex items-center justify-end ${isCancelled ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {isCancelled ? (
                <span className="text-[9px] uppercase font-black tracking-tight">Inställd</span>
              ) : (
                isDeviation && timeDisplayMode !== 'minutes' ? newTime : ''
              )}
            </div>

            <div className="w-10 flex justify-end">
              {dep.track && dep.track !== 'X' && dep.track !== '' ? (
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-[10px] select-none shadow-sm ${
                    isCancelled
                      ? 'bg-red-600 text-red-100'
                      : 'bg-slate-950 dark:bg-black text-slate-400 border border-slate-800 dark:border-slate-700'
                  }`}
                  title={`Läge ${dep.track}`}
                >
                  {dep.track.length > 2 ? dep.track.slice(0, 2) : dep.track}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const getMs = (t: string | undefined, refDate: Date = new Date()) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const d = new Date(refDate);
  d.setHours(h, m, 0, 0);
  const now = Date.now();
  // Handle wraparound roughly
  const diff = d.getTime() - now;
  if (diff > 43200000) d.setDate(d.getDate() - 1);
  else if (diff < -43200000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Custom Information Icon (Inline SVG for reliability)
// Custom Information Icon (Modern & Clean)
const DisruptionInfoIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="w-4 h-4 text-sky-500 flex-shrink-0"
    aria-label="Trafikstörning"
  >
    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 0 1 .67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 0 1-.671-1.34l.041-.022ZM12 9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
  </svg>
);

const StationHIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={className} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8v8" />
    <path d="M14 8v8" />
    <path d="M10 12h4" />
  </svg>
);

const JourneyTimeline = ({ stops, type, currentStationName }: { stops: JourneyDetail[], type?: string, currentStationName?: string }) => {
  const [activeState, setActiveState] = useState({ segment: -1, progress: 0 });

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      let segment = -1;
      let progress = 0;

      const getMsLocal = (t: string | undefined) => getMs(t);

      for (let i = 0; i < stops.length - 1; i++) {
        const curr = stops[i];
        const next = stops[i + 1];
        const t1 = getMsLocal(curr.realtimeDeparture || curr.departureTime || curr.time);
        const t2 = getMsLocal(next.realtimeArrival || next.arrivalTime || next.time);

        if (t1 && t2 && now >= t1 && now <= t2) {
          segment = i;
          progress = (now - t1) / (t2 - t1);
          break;
        }
      }
      setActiveState({ segment, progress });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [stops]);

  // Handle locale safely for Swedish time format consistent with UI
  const formatTimeStr = (t: string | undefined) => t ? t.replace('.', ':').substring(0, 5) : '';

  return (
    <div className="relative pl-0 pt-1 pb-1">
      {/* Background Line - Compact alignment: 40px time + 12px gap + 10px center = 62px */}
      <div className="absolute left-[62px] top-4 bottom-4 w-0.5 bg-slate-200 dark:bg-slate-700"></div>

      {stops.map((stop, idx) => {
        const isCancelled = stop.isCancelled;
        const isActive = stop.name === currentStationName;

        // Times
        const depTime = formatTimeStr(stop.departureTime || stop.time);
        const depReal = formatTimeStr(stop.realtimeDeparture);
        const arrTime = formatTimeStr(stop.arrivalTime || stop.time);
        const arrReal = formatTimeStr(stop.realtimeArrival);

        let showDouble = false;
        if (idx > 0 && idx < stops.length - 1) {
          if (arrTime !== depTime || arrReal !== depReal) showDouble = true;
        }

        const renderTimeBlock = (sched: string, real?: string) => {
          const isLate = real && real !== sched;
          return (
            <div className="flex flex-col items-end leading-tight">
              {isLate && <span className="text-[9px] text-slate-400 line-through decoration-slate-400 decoration-1">{sched}</span>}
              <span className={`font-bold text-xs ${isLate ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/40 px-1 rounded -my-0.5' : (isCancelled ? 'text-red-500' : 'text-slate-700 dark:text-slate-300')}`}>
                {real || sched}
              </span>
            </div>
          )
        }

        return (
          <div key={idx} className={`relative flex gap-3 min-h-[2.25rem] ${activeState.segment > idx ? 'opacity-40' : ''}`}>
            {/* Left: Time - Compact Width 40px */}
            <div className="w-[40px] text-right flex flex-col items-end justify-center shrink-0">
              {showDouble ? (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 w-5 text-right">AVG</span>
                    {renderTimeBlock(depTime, depReal)}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 w-5 text-right">ANK</span>
                    {renderTimeBlock(arrTime, arrReal)}
                  </div>
                </>
              ) : (
                renderTimeBlock(idx === 0 ? depTime : arrTime, idx === 0 ? depReal : arrReal)
              )}
            </div>

            {/* Center: Dot & Vehicle */}
            <div className="relative flex flex-col items-center w-5 shrink-0 z-10 pt-1">
              <div className={`w-3 h-3 rounded-full border-[2px] box-content bg-white dark:bg-slate-900 transition-all ${isActive ? 'border-sky-500 scale-125 shadow-[0_0_8px_rgba(14,165,233,0.5)]' :
                (activeState.segment > idx ? 'border-slate-300 dark:border-slate-700' : 'border-slate-400 dark:border-slate-500')
                }`}></div>

              {/* Vehicle Icon */}
              {activeState.segment === idx && (
                <div className="absolute top-2 w-0.5" style={{ height: 'calc(100% + 1rem)', zIndex: 20 }}>
                  <div className="absolute left-1/2 -translate-x-1/2 w-5 h-5 bg-sky-500 border-2 border-white text-white rounded-full flex items-center justify-center shadow-md text-[9px] transition-all duration-1000 ease-linear"
                    style={{ top: `${activeState.progress * 100}%` }}>
                    <FontAwesomeIcon icon={type === 'TRAM' ? faTram : faBus} />
                  </div>
                </div>
              )}
            </div>

            {/* Right: Info */}
            <div className="flex-1 pt-0.5 pb-2 border-b border-slate-100 dark:border-slate-800/40 flex items-center flex-wrap">
              <div className={`font-medium text-sm mr-2 ${isActive ? 'text-sky-600' : 'text-slate-800 dark:text-slate-200'} ${isCancelled ? 'line-through decoration-red-500 text-red-700' : ''}`}>
                {stop.name}
              </div>
              {isCancelled && <span className="text-red-500 text-[10px] font-bold uppercase tracking-wide mr-2">Inställd</span>}
              {stop.track && !isCancelled && (
                <span className="ml-auto text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700" title={`Läge ${stop.track}`}>
                  {stop.track}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div >
  )
};


export const DeparturesBoard: React.FC<DeparturesBoardProps> = ({ initialStation, mode = 'departures' }) => {
  const toast = useToast();
  const { addAlarm, alarms } = useAlarms();
  const { stationId: paramStationId, provider: paramProvider } = useParams<{ stationId: string, provider: string }>();
  const navigate = useNavigate();

  // View Mode State (Station vs Trip Planner)
  const [rootView, setRootView] = useState<'station' | 'planner'>('station');

  // Search & Station State
  const [query, setQuery] = useState('');
  const [station, setStation] = useState<Station | null>(initialStation || null);

  const [provider, setProvider] = useState<Provider>(() => {
    const saved = localStorage.getItem('resmus_storage_provider') as Provider | null;
    return saved || Provider.VASTTRAFIK;
  });

  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [viewMode, setViewMode] = useState<'departures' | 'arrivals'>(mode);
  const [sortMode, setSortMode] = useState<'time' | 'line'>('time');
  const [timeDisplayMode, setTimeDisplayMode] = useState<'minutes' | 'clock'>('minutes'); // Default to minutes for better UX
  const [isDense, setIsDense] = useState(false);

  const [customTime, setCustomTime] = useState<string>(''); // YYYY-MM-DDTHH:MM
  const [timeWindow, setTimeWindow] = useState(() => parseInt(localStorage.getItem('resmus_time_span') || '240', 10)); // Default 4 hours

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Check for station-based disruptions and withdrawals
  const [stationDisruptions, setStationDisruptions] = useState<any[]>([]);
  const [withdrawnLines, setWithdrawnLines] = useState<Set<string>>(new Set());

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [transportFilter, setTransportFilter] = useState<string>('all');
  const [trackFilter, setTrackFilter] = useState<string>('all');
  const [showDisruptionDetails, setShowDisruptionDetails] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Expanded Departure State
  const [expandedDepartureId, setExpandedDepartureId] = useState<string | null>(null);
  const [journeyDetails, setJourneyDetails] = useState<JourneyDetail[]>([]);
  const [specificDisruptions, setSpecificDisruptions] = useState<TrafficSituation[] | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [nextStop, setNextStop] = useState<JourneyDetail | null>(null);
  const [detailsUpdatedAt, setDetailsUpdatedAt] = useState<Date | null>(null);

  // Track mount status for provider change logic
  const isMountedRef = React.useRef(false);

  // Handle Select Station
  const handleSelectStation = (s: Station) => {
    setStation(s);
    setQuery('');
    setSearchResults([]);
    setDepartures([]);
    navigate(`/station/${s.provider.toLowerCase()}/${s.id}`, { replace: true });
  };

  // Sync station from URL
  useEffect(() => {
    if (paramStationId && paramProvider) {
       const prov = paramProvider.toUpperCase() as Provider;
       if (!station || station.id !== paramStationId) {
         const saved = localStorage.getItem('resmus_favorites');
         const favs = saved ? JSON.parse(saved) : [];
         const existing = favs.find((f: Station) => f.id === paramStationId);
         
         if (existing) {
            setStation(existing);
         } else {
            setStation({ id: paramStationId, provider: prov, name: 'Laddar station...', coords: { lat: 0, lng: 0 } });
         }
         setProvider(prov);
       }
    } else if (!paramStationId && isMountedRef.current) {
        setStation(null);
        setDepartures([]);
    }
    isMountedRef.current = true;
  }, [paramStationId, paramProvider]);

  // Clear station/results when provider changes manually
  useEffect(() => {
    if (isMountedRef.current && !paramStationId) {
        setStation(null);
        setDepartures([]);
        setSearchResults([]);
        setQuery('');
    }
  }, [provider]);

  // Listen for external updates (Settings)
  useEffect(() => {
    const handleStorageChange = () => {
      const newProvider = (localStorage.getItem('resmus_storage_provider') as Provider) || Provider.VASTTRAFIK;
      setProvider(newProvider);

      const newTimeWindow = parseInt(localStorage.getItem('resmus_time_span') || '60', 10);
      setTimeWindow(newTimeWindow);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Update "Next Stop" based on time
  useEffect(() => {
    if (!journeyDetails.length) {
      setNextStop(null);
      return;
    }
    const updateNextStop = () => {
      const now = Date.now();
      // Find the first stop that we haven't departed from yet (or just arrived at)
      // Simple logic: Find first stop with departureTime > now. 
      // If we are between stops, the next one is the target.
      const next = journeyDetails.find(s => {
        const t = getMs(s.realtimeDeparture || s.departureTime || s.time);
        return t && t > now;
      });
      if (next) setNextStop(next);
      else if (journeyDetails.length > 0) {
        // If all passed, show last? or "End"
        setNextStop({ name: "Slutdestination" } as any);
      }
    };
    updateNextStop();
    const interval = setInterval(updateNextStop, 10000);
    return () => clearInterval(interval);
  }, [journeyDetails]);
  // ---------------------------------------------

  // Favorites State
  const [favorites, setFavorites] = useState<Station[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('resmus_favorites');
    if (saved) {
      try {
        setFavorites(JSON.parse(saved));
      } catch (e) { console.error("Failed to load favorites"); }
    }

    // Check if we navigated from favorites
    const selectedFavorite = localStorage.getItem('resmus_selected_favorite');
    if (selectedFavorite) {
      try {
        const station = JSON.parse(selectedFavorite);
        setStation(station);
        localStorage.removeItem('resmus_selected_favorite'); // Clean up
      } catch (e) {
        console.error("Failed to parse selected favorite");
      }
    }
  }, []);

  const toggleFavorite = (s: Station) => {
    const isFav = favorites.some(f => f.id === s.id);
    let newFavs;
    if (isFav) {
      newFavs = favorites.filter(f => f.id !== s.id);
    } else {
      newFavs = [...favorites, s];
    }
    setFavorites(newFavs);
    localStorage.setItem('resmus_favorites', JSON.stringify(newFavs));
  };

  const isStationFavorite = (s: Station | null) => {
    if (!s) return false;
    return favorites.some(f => f.id === s.id);
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length > 2) {
        setIsSearching(true);
        const results = await TransitService.searchStations(query, provider);
        setSearchResults(results);
        setIsSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query, provider]);

  // Fetch data function
  useEffect(() => {
    let isMounted = true;
    let intervalId: NodeJS.Timeout;

    const fetchData = async () => {
      if (!station) return;

      setLoading(true);
      setError(null);
      // Don't clear departures immediately to prevent flash if refreshing
      // setDepartures([]); 

      const now = new Date();
      let dateTimeStr = customTime || undefined;

      console.log(`Fetching departures for ${station.name} (${station.id})...`);

      try {
        // Parallel fetch: Departures + Global Disruptions (if Västtrafik)
        const [data, fetchedDisruptions] = await Promise.all([
          TransitService.getDepartures(
            station.id,
            station.provider,
            viewMode,
            dateTimeStr,
            timeWindow
          ),
          station.provider === Provider.VASTTRAFIK ? TransitService.getVasttrafikDisruptions() : Promise.resolve([])
        ]);

        if (!isMounted) return;

        console.log(`Fetched ${data.length} departures and ${fetchedDisruptions.length} disruptions`);

        // Enhance departures with disruption info
        const enhancedDepartures = data.map(dep => {
          // If already has disruption from API, keep it
          if (dep.hasDisruption) return dep;

          // Match usage of global disruptions
          const matchingSituation = fetchedDisruptions.find(sit => {
            // Check if active time
            const startTime = new Date(sit.startTime).getTime();
            const endTime = sit.endTime ? new Date(sit.endTime).getTime() : Infinity;
            const nowTime = now.getTime();
            if (nowTime < startTime || nowTime > endTime) return false;

            // Check Line Name match (e.g. "3955", "Blå Tåget", "17")
            const affectedLine = sit.affectedLines?.some(l => {
              if (!l) return false;
              
              // 1. Strict match by unique GID if both are present
              if (l.gid && dep.lineGid) {
                 return l.gid === dep.lineGid;
              }

              // 2. Fallback to name matching (for other providers, or if GIDs are somehow missing)
              if (!l.designation) return false;
              const ds = l.designation.toLowerCase();
              const dl = dep.line.toLowerCase();
              return ds === dl || (ds.length > 3 && dl.includes(ds));
            });

            // Check Stop match
            const affectedStop = sit.affectedStopPoints?.some(s => s.gid === station.id);

            return affectedLine || affectedStop;
          });

          if (matchingSituation) {
            return {
              ...dep,
              hasDisruption: true,
              disruptionSeverity: matchingSituation.severity || 'normal',
              disruptionMessage: matchingSituation.title || matchingSituation.description
            };
          }
          return dep;
        });

        // Loop logic: If too few departures, try next day? (Simplified for stability)
        // For now, just set what we have.
        setDepartures(enhancedDepartures);

      } catch (err) {
        console.error("Fetch error:", err);
        if (isMounted) setError("Kunde inte hämta avgångar.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (station && station.name === 'Laddar station...' && departures.length > 0) {
      // Auto-correct station name from first departure
      const realName = departures[0].stopPoint.name;
      if (realName) {
        setStation(prev => prev ? { ...prev, name: realName } : prev);
      }
    }

    fetchData();
    intervalId = setInterval(fetchData, 60000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [station, viewMode, customTime, timeWindow]);

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolokalisering stöds inte.");
      return;
    }
    setIsSearching(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const stations = await TransitService.getNearbyStations(latitude, longitude);
      setSearchResults(stations);
      setIsSearching(false);
    }, (err) => {
      console.error(err);
      setLocationError("Kunde inte hämta position.");
      setIsSearching(false);
    });
  };

  // Filter out departures way in the past if using "now"
  // If custom time is set, we trust API to return correct window
  const filteredDepartures = departures.filter(dep => {
    if (!dep.timestamp) return false;

    // Type Filter
    if (transportFilter !== 'all') {
      // Map Västtrafik types roughly
      const type = (dep.type || '').toUpperCase();
      if (transportFilter === 'BUS' && !type.includes('BUS')) return false;
      if (transportFilter === 'TRAM' && !type.includes('TRAM') && !type.includes('SPÅRVAGN')) return false;
      if (transportFilter === 'TRAIN' && !type.includes('TRAIN') && !type.includes('TÅG')) return false;
      if (transportFilter === 'FERRY' && !type.includes('FERRY') && !type.includes('BÅT')) return false;
    }

    // If no custom time, filter out old departures (>10 min ago)
    if (!customTime) {
      const depTime = new Date(dep.timestamp).getTime();
      const now = Date.now();
      if (depTime < now - (10 * 60 * 1000)) return false;
    }
    return true;
  });

  const sortedDepartures = [...filteredDepartures]
    .sort((a, b) => {
      if (sortMode === 'time') {
        if (a.timestamp && b.timestamp) {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
        return a.time.localeCompare(b.time);
      }
      return a.line.localeCompare(b.line, undefined, { numeric: true, sensitivity: 'base' });
    });

  const toggleSort = () => setSortMode(prev => prev === 'time' ? 'line' : 'time');



  const getTransportIcon = (type: string | undefined, size = 16) => {
    const t = (type || '').toUpperCase();

    // Metro / Tunnelbana
    if (t.includes('METRO') || t.includes('TUNNELBANA')) return <FontAwesomeIcon icon={faSubway} className={`text-[${size}px]`} />;

    // Tram / Spårvagn
    if (t.includes('TRAM') || t.includes('SPÅRVAGN') || t.includes('SPARVAGN')) return <FontAwesomeIcon icon={faTram} className={`text-[${size}px]`} />;

    // Boat / Ferry / Båt / Färja
    if (t.includes('FERRY') || t.includes('BOAT') || t.includes('BÅT') || t.includes('BAT') || t.includes('FÄRJA') || t.includes('FARJA') || t.includes('ÄLVSNABBEN')) return <FontAwesomeIcon icon={faShip} className={`text-[${size}px]`} />;

    // Walk / Gå
    if (t === 'WALK' || t.includes('GÅ')) return <FontAwesomeIcon icon={faWalking} className={`text-[${size}px]`} />;

    // Default / Bus (Returns null to hide icon as requested, unless logic changes)
    return null;
  };

  /* 
   * Color Mapping based on Operator/Region
   */
  const getOperatorColor = (operator: string | undefined) => {
    const op = (operator || '').toLowerCase();

    // Stockholm (SL) - Red/Blue
    if (op.includes('sl') || op.includes('stockholm')) return '#d90000'; // SL Red

    // Skånetrafiken - Green
    if (op.includes('skåne')) return '#00a54f'; // Skåne Green

    // Västtrafik - Blue (Default Resmus Brand)
    if (op.includes('västtrafik')) return '#0095ff';

    // Östgötatrafiken - Red/Orange
    if (op.includes('östgöta')) return '#ff5000';

    // UL (Uppsala) - Yellow
    if (op.includes('upplands') || op.includes('ul')) return '#bfae0a';

    // SJ - Gray/Black
    if (op.includes('sj')) return '#222222';

    // Vy - Green
    if (op.includes('vy')) return '#006241';

    // Mälartåg - Red/White
    if (op.includes('mälar')) return '#e30613';

    // Hallandstrafiken - Blue
    if (op.includes('halland')) return '#007ac9';

    return null; // Fallback to type-based
  };

  const getDefaultLineColor = (type: string | undefined, line: string, operator?: string) => {

    // 1. Check Operator specific overrides first (if ResRobot)
    const opColor = getOperatorColor(operator);
    if (opColor) return opColor;

    const t = (type || '').toUpperCase();
    const lineNum = parseInt(line) || 0;

    // Train / Tåg - Dark blue (better contrast)
    if (t.includes('TRAIN') || t.includes('TÅG') || t.includes('TAG') || t.includes('KUSTPILEN') || t.includes('ÖRESUNDSTÅG') || t.includes('VÄSTTÅGEN')) {
      return '#1e40af'; // Dark blue instead of light blue
    }

    // Tram / Spårvagn - Dark green
    if (t.includes('TRAM') || t.includes('SPÅRVAGN') || t.includes('SPARVAGN')) {
      return '#047857'; // Dark green instead of light green
    }

    // Boat / Ferry / Båt / Färja - Dark teal
    if (t.includes('FERRY') || t.includes('BOAT') || t.includes('BÅT') || t.includes('BAT') || t.includes('FÄRJA') || t.includes('FARJA') || t.includes('ÄLVSNABBEN')) {
      return '#0f766e'; // Dark teal instead of light teal
    }

    // Bus - Based on line number ranges (darker, more accessible colors)
    if (lineNum >= 1 && lineNum <= 99) {
      // Local buses - Dark orange instead of bright orange
      return '#c2410c';
    } else if (lineNum >= 100 && lineNum <= 199) {
      // Regional buses - Dark purple
      return '#6b21a8';
    } else if (lineNum >= 200 && lineNum <= 299) {
      // Express buses - Dark red
      return '#dc2626';
    } else if (lineNum >= 300 && lineNum <= 399) {
      // Airport buses - Dark blue
      return '#1d4ed8';
    }

    // Default fallback - Dark gray
    return '#475569';
  };

  const toggleDepartureExpand = async (dep: Departure) => {
    // If clicking the same row, collapse it
    if (expandedDepartureId === dep.id) {
      setExpandedDepartureId(null);
      setJourneyDetails([]);
      return;
    }

    setExpandedDepartureId(dep.id);
    setLoadingDetails(true);
    setJourneyDetails([]);
    setSpecificDisruptions(null);
    setDetailsUpdatedAt(null);

    // Increment "Trips" counter for Statistics
    try {
      const current = localStorage.getItem('resmus_trip_count');
      const count = current ? parseInt(current) : 0;
      localStorage.setItem('resmus_trip_count', (count + 1).toString());
    } catch (e) {
      // Ignore storage errors
    }

    try {
      if (dep.journeyRef) {
        const details = await TransitService.getJourneyDetails(dep.journeyRef);
        setJourneyDetails(details);
        setDetailsUpdatedAt(new Date());
      }
      if (dep.serviceJourneyGid) {
        TransitService.getJourneyDisruptions(dep.serviceJourneyGid).then(disruptions => {
          if (expandedDepartureId === dep.id) {
            // Filter out disruptions that affect strictly other lines
            const relevant = disruptions.filter(d => {
              if (!d.affectedLines || d.affectedLines.length === 0) return true;
              return d.affectedLines.some((l: any) => l.designation === dep.line);
            });
            setSpecificDisruptions(relevant);
          }
        });
      }
    } catch (e) {
      console.error("Failed to fetch details", e);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Auto-update journey details every 30 seconds
  useEffect(() => {
    if (!expandedDepartureId) return;

    const interval = setInterval(async () => {
      const dep = departures.find(d => d.id === expandedDepartureId);
      if (dep?.journeyRef) {
        try {
          const details = await TransitService.getJourneyDetails(dep.journeyRef);
          // Only update if we still have the same departure expanded
          setJourneyDetails(current => {
            return details;
          });
          setDetailsUpdatedAt(new Date());
        } catch (e) { console.error("Auto-refresh details failed", e); }
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [expandedDepartureId, departures]);
  useEffect(() => {
    const fetchDisruptions = async () => {
      if (!station) {
        setStationDisruptions([]);
        setWithdrawnLines(new Set());
        return;
      }

      try {
        const disruptions = await TransitService.getVasttrafikDisruptions();
        const stationIssues: any[] = [];
        const withdrawn = new Set<string>();

        // Filter for this station
        disruptions.forEach((d: any) => {
          const affectedStops = d.affectedStopPoints || [];
          // Normalize text for matching, stripping city name for broader matching
          const cleanStationName = station.name.split(',')[0].trim().toLowerCase();

          // Check if GID matches OR if title/description contains the station name (relaxed match)
          const hasStation = affectedStops.some((s: any) => s.gid === station.id) ||
            d.title.toLowerCase().includes(cleanStationName) ||
            d.description.toLowerCase().includes(cleanStationName);

          if (hasStation) {
            stationIssues.push(d);

            // Check for withdrawn lines/stations
            const title = d.title.toLowerCase();
            const description = d.description.toLowerCase();

            if (title.includes('indragen') || title.includes('flyttad') ||
              description.includes('indragen') || description.includes('flyttad')) {

              // Extract line numbers from affected lines
              if (d.affectedLines) {
                d.affectedLines.forEach((line: any) => {
                  const lineNumber = line.designation.replace(/\D/g, '');
                  if (lineNumber) {
                    withdrawn.add(lineNumber);
                  }
                });
              }
            }
          }
        });

        setStationDisruptions(stationIssues);
        setWithdrawnLines(withdrawn);
      } catch (e) {
        console.error("Failed to fetch disruptions", e);
      }
    };

    fetchDisruptions();
  }, [station]);

  return (
    <div className="flex flex-col h-full bg-transparent relative overflow-hidden">

      {/* --- Root Mode Switcher (Modernized) --- */}
      <div className="flex-none z-30 bg-white/80 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-100 dark:border-slate-800/60 px-4 py-3">
        <div className="flex bg-slate-100/80 dark:bg-slate-800 p-1 rounded-xl max-w-xs mx-auto w-full ring-1 ring-black/[0.03] dark:ring-white/[0.02]">
          <button
            onClick={() => setRootView('station')}
            className={`relative flex-1 py-2 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 text-sm font-bold tracking-tight ${rootView === 'station'
              ? 'bg-[#0095eb] text-white shadow-md shadow-sky-500/20'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
          >
            <span className="relative z-10">Hållplats</span>
          </button>

          <button
            onClick={() => setRootView('planner')}
            className={`relative flex-1 py-2 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 text-sm font-bold tracking-tight ${rootView === 'planner'
              ? 'bg-[#0095eb] text-white shadow-md shadow-sky-500/20'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
          >
            <span className="relative z-10">Sök Resa</span>
          </button>
        </div>
      </div>

      {rootView === 'planner' ? (
        <div className="flex-1 overflow-hidden relative">
          <React.Suspense fallback={<div className="flex items-center justify-center h-full"><ThemedSpinner /></div>}>
            <TripPlanner />
          </React.Suspense>
        </div>
      ) : (
        <>
          {/* SEARCH LAYOUT - VISIBLE ONLY WHEN NO STATION IS SELECTED */}
          {!station && (
            <div className="flex-none z-20 bg-gradient-to-b from-white to-sky-50/50 dark:from-slate-900 dark:to-slate-950 shadow-sm pb-6 rounded-b-[2.5rem]">
              <div className="px-5 pt-4 pb-2 space-y-4">
                {/* Provider Selector Hidden - Moved to Input Icon */}

                <div className="relative shadow-xl shadow-sky-200/20 dark:shadow-none border border-sky-100/50 dark:border-slate-700/50 rounded-3xl bg-white dark:bg-slate-800 z-50 transition-all focus-within:ring-4 ring-sky-100 dark:ring-sky-900/30 focus-within:border-sky-300 transform transition-transform hover:scale-[1.01]">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <FontAwesomeIcon icon={faSearch} className="h-5 w-5 text-sky-400" />
                  </div>
                  <input
                    type="text"
                    className="block w-full pl-10 pr-12 py-3 bg-transparent border-none text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-2xl font-black text-base outline-none"
                    placeholder={
                      provider === Provider.RESROBOT ? "Sök hållplats (t.ex. Örebro, Kumla, Nora)..." :
                        provider === Provider.TRAFIKVERKET ? "Sök tågstation (t.ex. Stockholm C, Göteborg C)..." : "Sök hållplats..."
                    }
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    autoFocus={!station}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1">
                    {/* Provider Toggle (Small) */}
                    {!isSearching && !query && (
                      <button
                        onClick={() => {
                          let next: Provider;
                          if (provider === Provider.VASTTRAFIK) next = Provider.SL;
                          else if (provider === Provider.SL) next = Provider.RESROBOT;
                          else if (provider === Provider.RESROBOT) next = Provider.TRAFIKVERKET;
                          else next = Provider.VASTTRAFIK;

                          setProvider(next);
                          localStorage.setItem('resmus_storage_provider', next);
                          // Clean up previous results
                          setStation(null);
                          setDepartures([]);
                        }}
                        className="group relative flex items-center justify-center transition-transform hover:scale-110 active:scale-95 focus:outline-none"
                        title={
                          provider === Provider.VASTTRAFIK ? "Källa: Västtrafik (Klicka för att byta)" :
                            provider === Provider.SL ? "Källa: SL (Stockholm)" :
                              provider === Provider.RESROBOT ? "Källa: ResRobot – Hela Sverige inkl. Örebro län" :
                                "Källa: Trafikverket – Tåg (som trafikleverantör)"
                        }
                      >
                        {/* Brand Badges */}
                        {provider === Provider.VASTTRAFIK && (
                          <div className="w-7 h-7 rounded-full bg-[#0095eb] flex items-center justify-center shadow-sm border border-white/20">
                            <span className="font-black text-white text-[10px] tracking-tighter leading-none mt-[1px]">VT</span>
                          </div>
                        )}

                        {provider === Provider.SL && (
                          <div className="w-7 h-7 rounded-full bg-[#0078bf] flex items-center justify-center shadow-sm border border-white/20">
                            <span className="font-black text-white text-[10px] tracking-tighter leading-none mt-[1px]">SL</span>
                          </div>
                        )}

                        {provider === Provider.RESROBOT && (
                          <div className="w-7 h-7 rounded-full bg-[#1f2937] flex items-center justify-center shadow-sm border border-white/20">
                            <span className="font-black text-[#8cc63f] text-[10px] tracking-tighter leading-none mt-[1px]">RR</span>
                          </div>
                        )}

                        {provider === Provider.TRAFIKVERKET && (
                          <div className="w-7 h-7 rounded-full bg-[#d2232a] flex items-center justify-center shadow-sm border border-white/20">
                            <span className="font-black text-white text-[10px] tracking-tighter leading-none mt-[1px]">TrV</span>
                          </div>
                        )}

                        <div className="absolute top-full mt-2 right-0 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                          Byt källa
                        </div>
                      </button>
                    )}

                    {isSearching ? <ThemedSpinner size={16} className="text-sky-500" /> : query.length > 0 ? <button onClick={() => setQuery('')} className="p-1 rounded-full text-slate-400 hover:text-slate-600"><FontAwesomeIcon icon={faChevronUp} className="w-3.5 h-3.5" /></button> : null}
                  </div>

                  {/* Search Results Dropdown */}
                  {((searchResults.length > 0) || (query && searchResults.length === 0 && !isSearching) || (showSuggestions && !query && !station)) && (
                    <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-800 max-h-[50vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200 pb-2">

                      {/* No Results Message */}
                      {query && searchResults.length === 0 && !isSearching && (
                        <div className="px-4 py-3 text-slate-500 dark:text-slate-400 text-sm text-center italic">
                          Inga hållplatser hittades via {provider === Provider.VASTTRAFIK ? 'Västtrafik' : provider === Provider.SL ? 'SL' : provider === Provider.TRAFIKVERKET ? 'Trafikverket' : 'ResRobot'}.
                          <br /><span className="text-xs opacity-70">Prova att byta sökkälla, eller sök t.ex. &quot;Örebro&quot;, &quot;Kumla&quot; för Örebro län.</span>
                        </div>
                      )}
                      {/* Location Option - Show when query is empty */}
                      {(!query && showSuggestions && !station) && (
                        <button onMouseDown={handleUseLocation} className="w-full text-left px-4 py-3 border-b border-slate-50 dark:border-slate-800 hover:bg-sky-50 dark:hover:bg-slate-800 flex items-center gap-3 text-sky-600 dark:text-sky-400">
                          <div className="w-7 h-7 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
                            <FontAwesomeIcon icon={faLocationArrow} className="text-sm" />
                          </div>
                          <span className="font-bold text-sm">Visa hållplatser nära mig</span>
                        </button>
                      )}

                      {locationError && !query && (
                        <div className="px-4 py-2 text-xs text-red-500 font-bold bg-red-50 dark:bg-red-900/10 mx-2 mt-2 rounded-lg">{locationError}</div>
                      )}

                      {searchResults.map((s, idx) => (
                        <button
                          key={`${s.id}-${idx}`}
                          onClick={() => {
                            handleSelectStation(s);
                            navigate(`/station/${s.provider.toLowerCase()}/${s.id}`);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center gap-3.5 transition-colors group relative border-b border-slate-50 dark:border-slate-800/50 last:border-0"
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-sm shrink-0 transition-all group-hover:scale-105 group-hover:shadow-md ${provider === Provider.SL ? 'bg-blue-100 text-[#0078bf] dark:bg-[#0078bf]/20 dark:text-[#0078bf]' :
                            provider === Provider.VASTTRAFIK ? 'bg-sky-100 text-[#0095eb] dark:bg-[#0095eb]/20 dark:text-[#0095eb]' :
                              provider === Provider.TRAFIKVERKET ? 'bg-red-100 text-[#d2232a] dark:bg-[#d2232a]/20 dark:text-[#d2232a]' :
                                  'bg-green-100 text-[#8cc63f] dark:bg-[#8cc63f]/20 dark:text-[#8cc63f]'
                            }`}>
                            <FontAwesomeIcon icon={faMapPin} className="text-sm" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors truncate">
                              {s.name}
                            </div>
                          </div>

                          <FontAwesomeIcon icon={faChevronRight} className="text-slate-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-xs" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}



          {
            station && (
              <div className="flex-none z-20 bg-transparent shadow-sm pb-1 border-b border-white/20 dark:border-white/5">
                <div className="px-3 pt-3 pb-1 animate-in slide-in-from-top-4 fade-in duration-500">

                  {/* COMPACT ROW: Name + Tools */}
                  <div className="flex items-center justify-between gap-2 mb-2">

                    {/* Left: Station & Weather */}
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                      <div className="min-w-0">
                        <h1 className="text-lg sm:text-xl font-black text-slate-800 dark:text-white truncate tracking-tight leading-none">
                          {station.name}
                        </h1>
                        {provider === Provider.TRAFIKVERKET && (
                          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">Trafikverket som trafikleverantör</p>
                        )}
                      </div>

                      {station.coords && (
                        <div className="scale-75 origin-left flex-shrink-0 opacity-80">
                          <WeatherDisplay lat={station.coords.lat} lon={station.coords.lng} />
                        </div>
                      )}

                      <div className="flex gap-0.5 ml-1 flex-shrink-0 border-l border-slate-200 dark:border-slate-700 pl-2">
                        <button
                          onClick={() => toggleFavorite(station)}
                          className={`p-1.5 rounded-full transition-all hover:bg-slate-100 dark:hover:bg-slate-800 ${isStationFavorite(station) ? 'text-yellow-500' : 'text-slate-300 hover:text-slate-400'}`}
                        >
                          <FontAwesomeIcon icon={faStar} className="text-xs" />
                        </button>
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/#/station/${station.provider.toLowerCase()}/${station.id}`;
                            navigator.clipboard.writeText(url);
                            toast.success('Länk kopierad', 'Du kan nu dela denna hållplats!');
                          }}
                          className="p-1.5 text-slate-300 hover:text-sky-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                          title="Kopiera länk"
                        >
                          <FontAwesomeIcon icon={faShareAlt} className="text-xs" />
                        </button>
                        <button
                          onClick={() => {
                             setStation(null);
                             navigate('/');
                          }}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                        >
                          <FontAwesomeIcon icon={faTimes} className="text-xs" />
                        </button>
                      </div>
                    </div>

                    {/* Right: Compact Toolbar */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* View Mode (Avg/Ank) - Text Links */}
                      <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 mr-1.5">
                        <button
                          onClick={() => setViewMode('departures')}
                          className={`px-2 py-1 text-[10px] font-bold rounded ${viewMode === 'departures' ? 'bg-white dark:bg-slate-700 shadow-sm text-sky-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          Avg
                        </button>
                        <button
                          onClick={() => setViewMode('arrivals')}
                          className={`px-2 py-1 text-[10px] font-bold rounded ${viewMode === 'arrivals' ? 'bg-white dark:bg-slate-700 shadow-sm text-sky-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          Ank
                        </button>
                      </div>

                      {/* Tools Group */}
                      <div className="flex items-center gap-0.5 bg-slate-50 dark:bg-slate-800/50 rounded-full px-1 border border-slate-100 dark:border-slate-800">

                        {/* Time */}
                        <div className="relative flex items-center justify-center w-7 h-7">
                          <button className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${customTime ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:text-sky-600'}`} title="Välj tid">
                            <FontAwesomeIcon icon={faCalendarAlt} className="text-xs" />
                          </button>
                          <input type="datetime-local" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" onChange={(e) => setCustomTime(e.target.value)} />
                        </div>

                        {/* Zoom */}
                        <button onClick={() => setIsDense(!isDense)} className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${isDense ? 'text-sky-600 bg-sky-50 dark:bg-sky-900/20' : 'text-slate-400 hover:text-sky-600'}`} title="Kompakt läge">
                          <FontAwesomeIcon icon={isDense ? faSearchPlus : faSearchMinus} className="text-xs" />
                        </button>

                        {/* Filter */}
                        <div className="relative">
                          <button onClick={() => setShowFilterMenu(!showFilterMenu)} className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${transportFilter !== 'all' ? 'text-amber-600 bg-amber-50' : 'text-slate-400 hover:text-sky-600'}`} title="Filtrera">
                            <FontAwesomeIcon icon={faFilter} className="text-xs" />
                          </button>
                          {showFilterMenu && (
                            <div className="absolute top-full right-0 mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 p-2 z-50 w-40 animate-in fade-in zoom-in-95">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Visa</h4>
                              {[
                                { id: 'all', label: 'Alla', icon: null },
                                { id: 'BUS', label: 'Buss', icon: faBus },
                                { id: 'METRO', label: 'Tunnelbana', icon: faSubway },
                                { id: 'TRAM', label: 'Spårvagn', icon: faTram },
                                { id: 'TRAIN', label: 'Tåg', icon: faTrain },
                                { id: 'FERRY', label: 'Färja', icon: faShip }
                              ].map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={() => { setTransportFilter(opt.id); setShowFilterMenu(false); }}
                                  className={`w-full text-left px-2 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 ${transportFilter === opt.id ? 'bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                >
                                  {opt.icon && <FontAwesomeIcon icon={opt.icon} className="w-4 text-center" />}
                                  <span className={!opt.icon ? 'pl-6' : ''}>{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* ALERTS SECTION (Withdrawn & Disruptions) - Only if exists */}
                  {(withdrawnLines.size > 0 || stationDisruptions.length > 0) && (
                    <div className="space-y-2 mb-2">
                      {/* Withdrawn */}
                      {withdrawnLines.size > 0 && (
                        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-md border border-red-100 dark:border-red-900/30">
                          <FontAwesomeIcon icon={faExclamationCircle} className="text-sm" />
                          <span className="text-xs font-bold uppercase tracking-wide">
                            Linje {Array.from(withdrawnLines).join(', ')} indragen
                          </span>
                        </div>
                      )}

                      {/* Station Disruptions */}
                      {stationDisruptions.length > 0 && (
                        <div className="text-left">
                          <div className={`bg-gradient-to-r ${stationDisruptions.some((d: any) => d.severity === 'severe' || d.title.toLowerCase().includes('indragen')) ? 'from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border-red-200/50 dark:border-red-700/30' : 'from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-amber-200/50 dark:border-amber-700/30'} border rounded-xl p-2 flex items-start gap-2.5 shadow-sm group cursor-pointer relative overflow-hidden transition-all active:scale-[0.99]`}
                            onClick={() => setShowDisruptionDetails(!showDisruptionDetails)}>

                            <div className="flex-1 min-w-0 pl-1">
                              <p className={`text-[11px] font-medium ${stationDisruptions.some((d: any) => d.severity === 'severe' || d.title.toLowerCase().includes('indragen')) ? "text-red-900 dark:text-red-200" : "text-amber-900 dark:text-amber-200"} leading-relaxed`}>
                                {(() => {
                                  const d = stationDisruptions[0];
                                  const lines = d.affectedLines?.map((l: any) => `Linje ${l.designation}`).join(', ');
                                  const stops = d.affectedStopPoints?.some((s: any) => s.gid === station.id) ? station.name : "";

                                  let scope = "";
                                  if (lines && stops) scope = `${lines}, ${stops}`;
                                  else if (lines) scope = lines;
                                  else if (stops) scope = stops;
                                  else scope = "Hållplatsen";

                                  let status = d.title;
                                  if (status.toLowerCase().includes('indragen')) status = "är indragen";

                                  return `Trafikläge: ${scope} ${status}. ${d.description}`;
                                })()}
                              </p>
                              {stationDisruptions.length > 1 && !showDisruptionDetails && (
                                <div className="mt-0.5 text-[9px] font-bold opacity-60">
                                  +{stationDisruptions.length - 1} meddelande(n) till
                                </div>
                              )}
                            </div>

                            <div className="self-center transform transition-transform duration-300" style={{ transform: showDisruptionDetails ? 'rotate(180deg)' : 'none' }}>
                              <FontAwesomeIcon icon={faChevronUp} className={stationDisruptions.some((d: any) => d.severity === 'severe' || d.title.toLowerCase().includes('indragen')) ? "text-red-400 dark:text-red-600" : "text-amber-400 dark:text-amber-600"} />
                            </div>
                          </div>

                          {/* Details */}
                          {showDisruptionDetails && stationDisruptions.length > 0 && (
                            <div className="mt-2 pl-3 space-y-2 animate-in slide-in-from-top-2 fade-in">
                              {stationDisruptions.map((d, index) => (
                                <div key={index} className={`${d.severity === 'severe' || d.title.toLowerCase().includes('indragen') ? 'bg-red-50/50 dark:bg-red-900/10 border-red-400' : 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-400'} border-l-2 p-2.5 rounded-r-lg`}>
                                  <h4 className={`text-xs font-bold ${d.severity === 'severe' || d.title.toLowerCase().includes('indragen') ? 'text-red-900 dark:text-red-100' : 'text-amber-900 dark:text-amber-100'} mb-1 leading-tight`}>{d.title}</h4>
                                  <p className={`text-[10px] ${d.severity === 'severe' || d.title.toLowerCase().includes('indragen') ? 'text-red-800/80 dark:text-red-300' : 'text-amber-800/80 dark:text-amber-300'} leading-relaxed max-w-prose`}>
                                    {d.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>

              </div>
            )
          }

          {/* Controls Bar - Discrete & Clean */}


          {/* Modern Column Header */}
          {
            station && (
              <div className="bg-sky-400 text-white text-[10px] sm:text-xs font-black uppercase tracking-widest py-1.5 px-4 relative flex items-center z-10 shadow-md">

                {/* Grid Layout for Column Headers */}
                <div className="flex w-full items-center justify-between">

                  {/* Left: Line & Destination */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-11 flex-shrink-0 flex justify-center items-center relative cursor-pointer hover:text-sky-100 transition-colors" onClick={toggleSort}>
                      <span>Linje</span>
                    </div>
                    <div className="flex-1 font-bold pl-1">Destination</div>
                  </div>

                  {/* Right: Time & Track */}
                  <div className="flex items-center gap-2 pl-2 text-right">
                    <div className="min-w-[3.5rem]">Tid</div>
                    <div className="w-14 text-center">NY TID</div>
                    <div className="w-10 text-right">
                      LÄGE
                    </div>
                  </div>
                </div>

              </div>
            )
          }

          {/* List Content */}
          <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950 pb-20">
            {!station ? (
              <div className="p-4">
                {favorites.length > 0 && (
                  <div className="mb-2">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 px-1">Dina Favoriter</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {favorites.map(fav => (
                        <div key={fav.id} onClick={() => handleSelectStation(fav)} className="bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center justify-between group cursor-pointer hover:border-sky-500 dark:hover:border-sky-500 transition-colors shadow-sm">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/20 text-yellow-500 flex items-center justify-center flex-shrink-0">
                              <FontAwesomeIcon icon={faStar} className="text-sm" />
                            </div>
                            <span className="font-bold text-slate-800 dark:text-white truncate text-sm">{fav.name}</span>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); toggleFavorite(fav); }} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                            <FontAwesomeIcon icon={faTrash} className="text-sm" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!favorites.length && (
                  <div className="flex flex-col items-center justify-center pt-20 text-center opacity-40">
                    <FontAwesomeIcon icon={faStar} className="text-5xl text-slate-300 mb-4" />
                    <p className="font-bold text-slate-400">Du har inga favoriter än.</p>
                    <p className="text-xs text-slate-400 mt-1">Sök på en hållplats och klicka på stjärnan.</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {loading && departures.length === 0 ? (
                  <div>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <DepartureSkeleton key={i} />
                    ))}
                  </div>
                ) : sortedDepartures.length > 0 ? (
                  <div>
                    {sortedDepartures.map((dep, idx) => {
                      const isExpanded = expandedDepartureId === dep.id;
                      return (
                        <DepartureRow
                          key={`${dep.id}-${idx}`}
                          dep={dep}
                          isDense={isDense}
                          isExpanded={isExpanded}
                          toggleExpand={toggleDepartureExpand}
                          timeDisplayMode={timeDisplayMode}
                          stationName={station?.name || ''}
                          viewMode={viewMode}
                        />
                      );
                    })}
                    <div className="py-6"></div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center pt-16 text-slate-400 opacity-60">
                    <FontAwesomeIcon icon={faExclamationCircle} className="text-3xl mb-2" />
                    <p className="text-sm font-bold">Inga avgångar hittades</p>
                    {customTime && <p className="text-xs mt-1">Försök att ändra tiden eller sök igen.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )
      }
      {/* Modal Overlay for Expanded Details */}
      {/* Modal Overlay for Expanded Details */}
      {
        expandedDepartureId && (() => {
          const dep = departures.find(d => d.id === expandedDepartureId);
          if (!dep) return null;

          return (
            <DepartureDetailsModal
              departure={dep}
              stationName={station?.name}
              onClose={() => setExpandedDepartureId(null)}
            />
          );
        })()
      }
    </div >
  );
};
