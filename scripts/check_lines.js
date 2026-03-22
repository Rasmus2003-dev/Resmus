import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const countTrips = async () => {
    const url = 'https://opendata.samtrafiken.se/gtfs-rt/orebro/VehiclePositions.pb?key=600ef54ef3234bd1880624c148baa8f7&_t=' + Date.now();
    const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    if (!res.ok) return;

    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    const lines = new Set();
    const samples = {};
    for (const entity of feed.entity) {
        const tripId = entity.vehicle?.trip?.tripId;
        if (tripId && tripId.length >= 11) {
            const raw = tripId.substring(7, 11);
            const cleaned = raw.replace(/^0+/, '');
            lines.add(cleaned);
            if (!samples[cleaned]) samples[cleaned] = [];
            samples[cleaned].push(tripId);
        }
    }
    console.log("Found line codes:", Array.from(lines).sort());
    for (const line of Object.keys(samples).sort()) {
        console.log(`Line ${line} examples:`, samples[line].slice(0, 3));
    }
};

countTrips().catch();
