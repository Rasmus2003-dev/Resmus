/**
 * Trafikverket API – tågavgångar/ankomster och trafikstörningar (OperativeEvent, RailwayEvent).
 */
import { Departure, Provider, Station, TrafficSituation, JourneyDetail } from '../types';
import { API_KEYS } from './config';

const TV_AUTH_KEY = (API_KEYS as any).TRAFIKVERKET_API_KEY as string | undefined;
const API_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';

function getProxyUrl(): string {
  return import.meta.env.DEV ? '/trafikverket-api/v2/data.json' : 'https://corsproxy.io/?' + encodeURIComponent(API_URL);
}

export const TrafikverketService = {
  stationCache: new Map<string, string>(),
  stationNameMap: new Map<string, string>(),
  stationCoordsMap: new Map<string, { lat: number; lng: number }>(),

  ensureStationCache: async (): Promise<void> => {
    if (TrafikverketService.stationCache.size > 0 && TrafikverketService.stationCoordsMap.size > 0) return;
    if (!TV_AUTH_KEY) return;
    const xml = `
<REQUEST>
  <LOGIN authenticationkey="${TV_AUTH_KEY}" />
  <QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5">
    <INCLUDE>LocationSignature</INCLUDE>
    <INCLUDE>AdvertisedLocationName</INCLUDE>
    <INCLUDE>Geometry.WGS84</INCLUDE>
  </QUERY>
</REQUEST>`;
    try {
      const cached = localStorage.getItem('tv_station_cache_v3');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 86400000) {
          parsed.data.forEach((s: any) => {
            const sig = s.sig.toUpperCase();
            TrafikverketService.stationCache.set(sig, s.name);
            TrafikverketService.stationNameMap.set(s.name, sig);
            if (s.lat && s.lng) TrafikverketService.stationCoordsMap.set(sig, { lat: s.lat, lng: s.lng });
          });
          return;
        }
      }
      const res = await fetch(getProxyUrl(), { method: 'POST', body: xml, headers: { 'Content-Type': 'text/xml' } });
      if (!res.ok) return;
      const data = await res.json();
      const stations = data?.RESPONSE?.RESULT?.[0]?.TrainStation || [];
      const cacheData: any[] = [];
      stations.forEach((s: any) => {
        const sig = s.LocationSignature.toUpperCase();
        TrafikverketService.stationCache.set(sig, s.AdvertisedLocationName);
        TrafikverketService.stationNameMap.set(s.AdvertisedLocationName, sig);
        let lat = 0, lng = 0;
        if (s.Geometry?.WGS84) {
          const match = s.Geometry.WGS84.match(/POINT \(([\d.]+) ([\d.]+)\)/);
          if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
        }
        if (lat && lng) {
          TrafikverketService.stationCoordsMap.set(sig, { lat, lng });
          cacheData.push({ sig, name: s.AdvertisedLocationName, lat, lng });
        } else {
          cacheData.push({ sig, name: s.AdvertisedLocationName });
        }
      });
      localStorage.setItem('tv_station_cache_v3', JSON.stringify({ timestamp: Date.now(), data: cacheData }));
    } catch (e) {
      console.error('[Trafikverket] Cache init error', e);
    }
  },

  getTrainDepartures: async (
    stationIdentifier: string,
    dateTime?: string,
    mode: 'departures' | 'arrivals' = 'departures'
  ): Promise<Departure[]> => {
    if (!TV_AUTH_KEY) return [];
    try {
      await TrafikverketService.ensureStationCache();
      const upperId = stationIdentifier.toUpperCase().replace(/^TV-/, '');
      let locationSign = TrafikverketService.stationCache.has(upperId)
        ? upperId
        : TrafikverketService.stationNameMap.get(stationIdentifier) || '';
      if (!locationSign && stationIdentifier.length > 1) {
        const lowerId = stationIdentifier.toLowerCase();
        for (const [name, sig] of TrafikverketService.stationNameMap.entries()) {
          if (name.toLowerCase() === lowerId) { locationSign = sig; break; }
        }
      }
      if (!locationSign) return [];
      const stationName = TrafikverketService.stationCache.get(locationSign) || locationSign;
      const timeFilter = dateTime ? new Date(dateTime).toISOString() : new Date().toISOString();
      const depXml = `
<REQUEST>
  <LOGIN authenticationkey="${TV_AUTH_KEY}" />
  <QUERY objecttype="TrainAnnouncement" schemaversion="1.9" orderby="AdvertisedTimeAtLocation">
    <FILTER>
      <EQ name="LocationSignature" value="${locationSign}" />
      <GT name="AdvertisedTimeAtLocation" value="${timeFilter}" />
      <LT name="AdvertisedTimeAtLocation" value="${new Date(new Date(timeFilter).getTime() + 14400000).toISOString()}" />
      <EQ name="Advertised" value="true" />
    </FILTER>
    <INCLUDE>AdvertisedTrainIdent</INCLUDE>
    <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
    <INCLUDE>TimeAtLocation</INCLUDE>
    <INCLUDE>TrackAtLocation</INCLUDE>
    <INCLUDE>ToLocation</INCLUDE>
    <INCLUDE>FromLocation</INCLUDE>
    <INCLUDE>Canceled</INCLUDE>
    <INCLUDE>Deviation</INCLUDE>
    <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
    <INCLUDE>InformationOwner</INCLUDE>
    <INCLUDE>ProductInformation</INCLUDE>
    <INCLUDE>ActivityType</INCLUDE>
    <INCLUDE>OperationalTransportIdentifiers</INCLUDE>
  </QUERY>
</REQUEST>`;
      const depRes = await fetch(getProxyUrl(), {
        method: 'POST',
        body: depXml,
        headers: { 'Content-Type': 'text/xml; charset=utf-8' }
      });
      if (!depRes.ok) return [];
      const depData = await depRes.json();
      let trains = depData?.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];
      const activityFilter = mode === 'arrivals' ? 'Ank' : 'Avg';
      trains = trains.filter(
        (t: any) =>
          t.ActivityType && t.ActivityType.indexOf(activityFilter) >= 0 && t.AdvertisedTrainIdent !== '600'
      );
      return trains.map((t: any) => {
        const locRaw = mode === 'arrivals' ? t.FromLocation : t.ToLocation;
        const direction = locRaw
          ? locRaw
              .map((l: any) => {
                const sig = typeof l === 'object' && l.LocationName ? l.LocationName : l;
                return TrafikverketService.stationCache.get(String(sig).toUpperCase()) || sig;
              })
              .join(', ')
          : mode === 'arrivals' ? 'Okänt ursprung' : 'Slutstation';
        let dMsg: string | undefined;
        if (t.Deviation) {
          dMsg = t.Deviation.map((d: any) => (typeof d === 'string' ? d : d?.Description || d?.Code || ''))
            .filter(Boolean)
            .join('. ');
        }
        return {
          id: `tv-${t.AdvertisedTrainIdent}-${t.AdvertisedTimeAtLocation}`,
          journeyRef: `tv-${t.AdvertisedTrainIdent}-${t.AdvertisedTimeAtLocation}`,
          line: t.AdvertisedTrainIdent,
          direction,
          time: new Date(t.AdvertisedTimeAtLocation).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
          datetime: t.AdvertisedTimeAtLocation,
          timestamp: t.AdvertisedTimeAtLocation,
          realtime: t.EstimatedTimeAtLocation
            ? new Date(t.EstimatedTimeAtLocation).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
            : undefined,
          track: t.TrackAtLocation || '',
          stopPoint: { name: stationName, gid: locationSign },
          provider: Provider.TRAFIKVERKET,
          status: t.Canceled ? 'CANCELLED' : (t.EstimatedTimeAtLocation && t.EstimatedTimeAtLocation !== t.AdvertisedTimeAtLocation ? 'LATE' : 'ON_TIME'),
          type: 'TRAIN' as const,
          disruptionMessage: dMsg,
          operationalTransportIdentifiers: t.OperationalTransportIdentifiers
        };
      });
    } catch (e) {
      console.error('[Trafikverket] getTrainDepartures error', e);
      return [];
    }
  },

  searchStations: async (query: string): Promise<Station[]> => {
    if (!TV_AUTH_KEY) return [];
    await TrafikverketService.ensureStationCache();
    if (!query || query.length < 2) return [];
    const lowerQ = query.toLowerCase();
    const results: { id: string; name: string; coords: { lat: number; lng: number }; isStartMatch: boolean }[] = [];
    let count = 0;
    for (const [name, sig] of TrafikverketService.stationNameMap.entries()) {
      if (name.toLowerCase().includes(lowerQ)) {
        const coords = TrafikverketService.stationCoordsMap.get(sig) || { lat: 0, lng: 0 };
        results.push({
          id: `tv-${sig}`,
          name,
          coords,
          isStartMatch: name.toLowerCase().startsWith(lowerQ)
        });
        count++;
        if (count >= 50) break;
      }
    }
    return results
      .sort((a, b) => {
        if (a.isStartMatch && !b.isStartMatch) return -1;
        if (!a.isStartMatch && b.isStartMatch) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        name: s.name,
        provider: Provider.TRAFIKVERKET as Provider,
        coords: s.coords
      }));
  },

  /** Trafikstörningar (tåg) – OperativeEvent + RailwayEvent från senaste dygnet + pågående (sluttid ännu inte passerad). */
  getDisruptions: async (): Promise<TrafficSituation[]> => {
    if (!TV_AUTH_KEY) return [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneDayAgoIso = oneDayAgo.toISOString();
    const xml = `
<REQUEST>
  <LOGIN authenticationkey="${TV_AUTH_KEY}" />
  <QUERY objecttype="OperativeEvent" namespace="ols.open" schemaversion="1.0" limit="50">
    <FILTER><AND><EQ name="EventState" value="1" /><IN name="EventTrafficType" value="0,2" /><EQ name="Deleted" value="false" /></AND></FILTER>
    <INCLUDE>OperativeEventId</INCLUDE>
    <INCLUDE>StartDateTime</INCLUDE>
    <INCLUDE>EndDateTime</INCLUDE>
    <INCLUDE>ModifiedDateTime</INCLUDE>
    <INCLUDE>EventType.Description</INCLUDE>
    <INCLUDE>TrafficImpact.PublicMessage.Header</INCLUDE>
    <INCLUDE>TrafficImpact.PublicMessage.Description</INCLUDE>
    <INCLUDE>TrafficImpact.SelectedSection.FromLocation.Signature</INCLUDE>
    <INCLUDE>TrafficImpact.SelectedSection.ToLocation.Signature</INCLUDE>
    <INCLUDE>TrafficImpact.SelectedSection.ViaLocation.Signature</INCLUDE>
    <INCLUDE>EventSection.FromLocation.Signature</INCLUDE>
    <INCLUDE>EventSection.ToLocation.Signature</INCLUDE>
    <INCLUDE>EventSection.ViaLocation.Signature</INCLUDE>
  </QUERY>
  <QUERY objecttype="RailwayEvent" namespace="ols.open" schemaversion="1.0" limit="50">
    <FILTER><AND><EQ name="Deleted" value="false" /><GT name="StartDateTime" value="${oneDayAgoIso}" /></AND></FILTER>
    <INCLUDE>EventId</INCLUDE>
    <INCLUDE>OperativeEventId</INCLUDE>
    <INCLUDE>EventStatus</INCLUDE>
    <INCLUDE>ReasonCode</INCLUDE>
    <INCLUDE>StartDateTime</INCLUDE>
    <INCLUDE>EndDateTime</INCLUDE>
    <INCLUDE>ModifiedDateTime</INCLUDE>
    <INCLUDE>SelectedSection.FromLocation.Signature</INCLUDE>
    <INCLUDE>SelectedSection.ToLocation.Signature</INCLUDE>
    <INCLUDE>SelectedSection.ViaLocation.Signature</INCLUDE>
  </QUERY>
</REQUEST>`;
    try {
      await TrafikverketService.ensureStationCache();
      const res = await fetch(getProxyUrl(), { method: 'POST', body: xml, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
      if (!res.ok) return [];
      const data = await res.json();
      const opEvents = data?.RESPONSE?.RESULT?.[0]?.OperativeEvent || [];
      const railwayEvents = data?.RESPONSE?.RESULT?.[1]?.RailwayEvent || [];
      const railwayByOp = new Map<string, any[]>();
      railwayEvents.forEach((r: any) => {
        if (r.OperativeEventId) {
          if (!railwayByOp.has(r.OperativeEventId)) railwayByOp.set(r.OperativeEventId, []);
          railwayByOp.get(r.OperativeEventId)!.push(r);
        }
      });
      const processedRyIds = new Set<string>();
      const result: TrafficSituation[] = [];
      const sigToName = (sig: string) => TrafikverketService.stationCache.get(sig?.toUpperCase() || '') || sig;
      const collectSigs = (e: any): string[] => {
        const set = new Set<string>();
        const add = (s: any) => { const v = s?.Signature ?? s; if (v) set.add(String(v).toUpperCase()); };
        const sec = (x: any) => (Array.isArray(x) ? x : x ? [x] : []).forEach((s: any) => {
          add(s?.FromLocation); add(s?.ToLocation); add(s?.ViaLocation);
        });
        if (e.EventSection) sec(e.EventSection);
        if (e.TrafficImpact?.SelectedSection) sec(e.TrafficImpact.SelectedSection);
        return Array.from(set);
      };
      const reasonCodesFromRailway = (events: any[]): string => {
        const parts: string[] = [];
        events.forEach((r: any) => {
          if (!r.ReasonCode) return;
          const arr = Array.isArray(r.ReasonCode) ? r.ReasonCode : [r.ReasonCode];
          arr.forEach((rc: any) => {
            const code = rc?.Code ?? rc;
            const desc = rc?.Description;
            if (code) parts.push(desc ? `${code} (${desc})` : String(code));
          });
        });
        return [...new Set(parts)].join(', ');
      };
      opEvents.forEach((e: any) => {
        const id = e.OperativeEventId;
        const linked = railwayByOp.get(id) || [];
        linked.forEach((r: any) => processedRyIds.add(r.EventId));
        const sigs = collectSigs(e);
        let title = 'Trafikstörning';
        let description = '';
        if (e.TrafficImpact?.PublicMessage) {
          const msg = Array.isArray(e.TrafficImpact.PublicMessage) ? e.TrafficImpact.PublicMessage[0] : e.TrafficImpact.PublicMessage;
          title = msg.Header || title;
          description = msg.Description || description;
        }
        if (title === 'Trafikstörning' && e.EventType?.Description) title = e.EventType.Description;
        if (!description) description = sigs.map(sigToName).filter(Boolean).join(', ') || 'Ingen detaljerad information.';
        result.push({
          situationNumber: id,
          creationTime: e.StartDateTime,
          startTime: e.StartDateTime,
          endTime: e.EndDateTime || undefined,
          publishedTime: e.ModifiedDateTime || undefined,
          reasonCode: reasonCodesFromRailway(linked) || undefined,
          severity: 'normal',
          title,
          description,
          affectedLines: sigs.map(sig => ({ gid: sig, designation: sigToName(sig) })),
          affected: sigs.map(sig => ({ designation: sigToName(sig) }))
        });
      });
      railwayEvents.filter((r: any) => !processedRyIds.has(r.EventId)).forEach((e: any) => {
        const id = e.EventId;
        let title = 'Järnvägshändelse';
        let reasonCodeStr = '';
        if (e.ReasonCode) {
          const arr = Array.isArray(e.ReasonCode) ? e.ReasonCode : [e.ReasonCode];
          reasonCodeStr = arr.map((rc: any) => rc?.Description ? `${rc.Code} (${rc.Description})` : rc?.Code || rc).filter(Boolean).join(', ');
          const rc = arr[0];
          title = (rc?.Description || rc?.Code || title) as string;
        }
        const sigs = new Set<string>();
        const add = (s: any) => { const v = s?.Signature ?? s?.LocationName ?? s; if (v) sigs.add(String(v).toUpperCase()); };
        (Array.isArray(e.SelectedSection) ? e.SelectedSection : e.SelectedSection ? [e.SelectedSection] : []).forEach((s: any) => {
          add(s?.FromLocation); add(s?.ToLocation); add(s?.ViaLocation);
        });
        const arr = Array.from(sigs);
        const desc = arr.map(sigToName).join(', ') || e.EventStatus || 'Ingen information';
        result.push({
          situationNumber: id,
          creationTime: e.StartDateTime,
          startTime: e.StartDateTime,
          endTime: e.EndDateTime || undefined,
          publishedTime: e.ModifiedDateTime || undefined,
          reasonCode: reasonCodeStr || undefined,
          severity: e.EventStatus === 'OperativeHändelse' ? 'normal' : 'slight',
          title,
          description: desc,
          affectedLines: arr.map(sig => ({ gid: sig, designation: sigToName(sig) })),
          affected: arr.map(sig => ({ designation: sigToName(sig) }))
        });
      });
      const nowMs = now.getTime();
      const oneDayAgoMs = oneDayAgo.getTime();

      const isBanarbete = (r: TrafficSituation): boolean => {
        const t = (r.title + ' ' + (r.description || '') + ' ' + (r.reasonCode || '')).toLowerCase();
        if (/banarbete|spårarbete|planerat banarbete|underhåll\s*(av\s*)?(ban|spår)/i.test(t)) return true;
        const code = (r.reasonCode || '').toUpperCase();
        if (/^I\s*BT(\s|$)/.test(code) || code.startsWith('I BT ')) return true;
        return false;
      };

      const filtered = result.filter((r) => {
        const startMs = new Date(r.startTime).getTime();
        const endMs = r.endTime ? new Date(r.endTime).getTime() : 0;
        const withinLastDay = startMs >= oneDayAgoMs;
        const stillOngoing = !r.endTime || endMs > nowMs;
        if (isBanarbete(r)) return false;
        return withinLastDay && stillOngoing;
      });
      filtered.sort((a, b) => (new Date(b.startTime).getTime()) - (new Date(a.startTime).getTime()));
      return filtered;
    } catch (err) {
      console.error('[Trafikverket] getDisruptions error', err);
      return [];
    }
  },

  /** Hämta alla stopp för ett tåg (hela resan) utifrån journeyRef från avgångar. */
  getJourneyDetails: async (journeyRef: string): Promise<JourneyDetail[]> => {
    if (!TV_AUTH_KEY) return [];
    await TrafikverketService.ensureStationCache();

    let trainIdent = journeyRef;
    let date = new Date().toISOString().split('T')[0];

    if (journeyRef.startsWith('tv-')) {
      const match = journeyRef.match(/^tv-([^-]+)-(\d{4}-\d{2}-\d{2})/);
      if (match) {
        trainIdent = match[1];
        const datePart = match[2];
        if (datePart) date = datePart;
      } else {
        const parts = journeyRef.split('-');
        trainIdent = parts[1];
        if (trainIdent && parts.length >= 5) {
          const y = parts[2], m = parts[3], d = parts[4].split('T')[0];
          if (y?.length === 4 && m && d) date = `${y}-${m}-${d}`;
        }
      }
      if (!trainIdent) return [];
    }

    const d = new Date(date + 'T12:00:00');
    const start = new Date(d);
    start.setDate(start.getDate() - 3);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setDate(end.getDate() + 4);
    end.setHours(23, 59, 59, 999);

    const xml = `
<REQUEST>
  <LOGIN authenticationkey="${TV_AUTH_KEY}" />
  <QUERY objecttype="TrainAnnouncement" schemaversion="1.9" orderby="AdvertisedTimeAtLocation" limit="1500">
    <FILTER>
      <EQ name="AdvertisedTrainIdent" value="${String(trainIdent).trim()}" />
      <GT name="AdvertisedTimeAtLocation" value="${start.toISOString()}" />
      <LT name="AdvertisedTimeAtLocation" value="${end.toISOString()}" />
      <EQ name="Advertised" value="true" />
    </FILTER>
    <INCLUDE>LocationSignature</INCLUDE>
    <INCLUDE>AdvertisedLocationName</INCLUDE>
    <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
    <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
    <INCLUDE>TimeAtLocation</INCLUDE>
    <INCLUDE>TrackAtLocation</INCLUDE>
    <INCLUDE>ActivityType</INCLUDE>
    <INCLUDE>Canceled</INCLUDE>
    <INCLUDE>Deviation</INCLUDE>
    <INCLUDE>OperationalTransportIdentifiers</INCLUDE>
    <INCLUDE>ViaFromLocation</INCLUDE>
    <INCLUDE>ViaToLocation</INCLUDE>
  </QUERY>
</REQUEST>`;

    try {
      const url = getProxyUrl();
      const res = await fetch(url, { method: 'POST', body: xml, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
      const data = await res.json?.() ?? {};
      if (!res.ok) {
        if (import.meta.env.DEV) console.warn('[Trafikverket] getJourneyDetails non-OK', res.status, data);
        return [];
      }
      const results = data?.RESPONSE?.RESULT;
      let stopsArray: any[] = [];
      if (Array.isArray(results)) {
        for (const item of results) {
          if (Array.isArray(item)) {
            if (item.length > 0 && item.some((x: any) => x?.LocationSignature != null)) {
              stopsArray = item;
              break;
            }
          } else if (item && typeof item === 'object') {
            const arr = item.TrainAnnouncement ?? item.trainannouncement ?? Object.values(item).find((v: any) => Array.isArray(v) && v.length > 0 && v.some((x: any) => x?.LocationSignature != null));
            if (Array.isArray(arr) && arr.length > 0) {
              stopsArray = arr;
              break;
            }
          }
        }
      }
      if (!Array.isArray(stopsArray)) stopsArray = [];
      const dateStr = date;
      const sameDay = (iso: string | undefined) => {
        if (!iso) return false;
        const s = String(iso);
        if (s.startsWith(dateStr)) return true;
        try {
          const t = new Date(iso);
          const y = t.getFullYear(), m = String(t.getMonth() + 1).padStart(2, '0'), d = String(t.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}` === dateStr;
        } catch { return false; }
      };
      const onTargetDay = stopsArray.filter((s: any) => sameDay(s?.AdvertisedTimeAtLocation));
      if (onTargetDay.length > 0) stopsArray = onTargetDay;
      if (import.meta.env.DEV && stopsArray.length === 0 && data?.RESPONSE) {
        console.warn('[Trafikverket] getJourneyDetails empty stops. TrainIdent:', trainIdent, 'Date:', date, 'RESPONSE:', JSON.stringify(data.RESPONSE).slice(0, 500));
      }
      if (import.meta.env.DEV && stopsArray.length > 0) {
        console.info('[Trafikverket] getJourneyDetails raw announcements:', stopsArray.length, 'date:', date);
      }
      const stationMap = new Map<string, { name: string; sig: string; arr: any; dep: any; track: string; cancelled?: boolean; operationalTransportIdentifiers?: any }>();
      const act = (s: any) => String(s?.ActivityType ?? '').toLowerCase();

      stopsArray.forEach((s: any) => {
        const sig = s.LocationSignature;
        if (!stationMap.has(sig)) {
          stationMap.set(sig, {
            name: s.AdvertisedLocationName || TrafikverketService.stationCache.get(sig) || sig,
            sig,
            arr: null,
            dep: null,
            track: s.TrackAtLocation || '',
            cancelled: s.Canceled,
            operationalTransportIdentifiers: s.OperationalTransportIdentifiers
          });
        }
        const entry = stationMap.get(sig)!;
        const isArr = act(s).includes('ankomst') || act(s).includes('arrival');
        const isDep = act(s).includes('avgång') || act(s).includes('avgang') || act(s).includes('departure');
        if (isArr) entry.arr = s;
        if (isDep) {
          entry.dep = s;
          if (s.TrackAtLocation) entry.track = s.TrackAtLocation;
          if (s.OperationalTransportIdentifiers) entry.operationalTransportIdentifiers = s.OperationalTransportIdentifiers;
        }
        if (!isArr && !isDep) {
          entry.dep = entry.dep || s;
          entry.arr = entry.arr || s;
          if (s.TrackAtLocation) entry.track = s.TrackAtLocation;
        }
        if (s.TrackAtLocation) entry.track = s.TrackAtLocation;
      });

      const toHhMm = (iso: string | undefined) =>
        iso ? new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : undefined;

      const result: JourneyDetail[] = [];
      const processedSigs = new Set<string>();

      stopsArray.forEach((s: any) => {
        const sig = s.LocationSignature;
        if (processedSigs.has(sig)) return;
        processedSigs.add(sig);
        const entry = stationMap.get(sig)!;
        const arr = entry.arr;
        const dep = entry.dep;
        const arrivalTime = arr?.AdvertisedTimeAtLocation;
        const realtimeArrival = arr?.EstimatedTimeAtLocation;
        const departureTime = dep?.AdvertisedTimeAtLocation;
        const realtimeDeparture = dep?.EstimatedTimeAtLocation;
        const mainTime = departureTime || arrivalTime;
        const track = dep?.TrackAtLocation || arr?.TrackAtLocation || entry.track || '';

        result.push({
          name: entry.name,
          time: mainTime ? toHhMm(mainTime)! : '',
          track: track || undefined,
          date: mainTime,
          isCancelled: entry.cancelled,
          isDeparture: true,
          arrivalTime: arrivalTime ? toHhMm(arrivalTime) : undefined,
          departureTime: departureTime ? toHhMm(departureTime) : undefined,
          realtimeArrival: realtimeArrival ? toHhMm(realtimeArrival) : undefined,
          realtimeDeparture: realtimeDeparture ? toHhMm(realtimeDeparture) : undefined,
          operationalTransportIdentifiers: entry.operationalTransportIdentifiers
        });
      });

      if (result.length >= 2) {
        const firstAnn = stopsArray[0];
        const viaTo = firstAnn?.ViaToLocation;
        const viaFrom = firstAnn?.ViaFromLocation;
        const collectSigs = (v: any): string[] => {
          if (!v) return [];
          const arr = Array.isArray(v) ? v : [v];
          return arr.map((x: any) => (typeof x === 'object' && x?.LocationName != null) ? x.LocationName : (typeof x === 'string' ? x : '')).filter(Boolean);
        };
        const viaSigs = [...collectSigs(viaFrom), ...collectSigs(viaTo)];
        const alreadyIn = new Set(result.map(r => r.name));
        const inserted = new Set<string>();
        for (const sig of viaSigs) {
          const u = String(sig).toUpperCase();
          if (inserted.has(u)) continue;
          const name = TrafikverketService.stationCache.get(u) || sig;
          if (!name || alreadyIn.has(name)) continue;
          inserted.add(u);
          alreadyIn.add(name);
          const idx = Math.max(1, result.length - 1);
          result.splice(idx, 0, {
            name,
            time: '--:--',
            track: undefined,
            date: undefined,
            isDeparture: true,
            arrivalTime: undefined,
            departureTime: undefined
          });
        }
      }

      return result;
    } catch (e) {
      console.error('[Trafikverket] getJourneyDetails error', e);
      return [];
    }
  }
};
