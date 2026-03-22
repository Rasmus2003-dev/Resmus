/**
 * Debug: Hämta verkliga trip_id, route_id, vehicle.label från GTFS Sweden 3
 * Kör: node scripts/debug_sweden3_lines.js
 */
import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const SWEDEN3_KEY = 'b6cb9ecb1b5e4a6cb0349f3130214702';
const REGIONAL_KEY = '600ef54ef3234bd1880624c148baa8f7';

const run = async (operatorId, useSweden3 = true) => {
  const base = useSweden3 ? 'gtfs-rt-sweden' : 'gtfs-rt';
  const file = useSweden3 ? 'VehiclePositionsSweden.pb' : 'VehiclePositions.pb';
  const key = useSweden3 ? SWEDEN3_KEY : REGIONAL_KEY;
  const url = `https://opendata.samtrafiken.se/${base}/${operatorId}/${file}?key=${key}`;
  console.log('\n---', operatorId.toUpperCase(), '---');
  const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
  if (!res.ok) {
    console.log('Error:', res.status, res.statusText);
    return;
  }
  const buf = await res.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
  const samples = [];
  for (const e of (feed.entity || [])) {
    const v = e.vehicle;
    if (!v?.position) continue;
    const t = v.trip || {};
    const tripId = t.tripId ?? t.trip_id ?? '(none)';
    const routeId = t.routeId ?? t.route_id ?? '(none)';
    if (tripId === '(none)' && routeId === '(none)') continue;
    samples.push({ tripId, routeId, vehicleLabel: v.vehicle?.label ?? '', headsign: t.tripHeadsign ?? t.trip_headsign ?? '' });
  }
  console.log('Entities with trip/route:', samples.length);
  console.log(JSON.stringify(samples, null, 2));
};

(async () => {
  console.log('=== GTFS Sweden 3 ===');
  await run('jlt', true);
  await run('orebro', true);
  console.log('\n=== GTFS Regional (jämförelse) ===');
  await run('jlt', false);
  await run('orebro', false);
})();
