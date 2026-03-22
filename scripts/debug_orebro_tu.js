import fetch from 'node-fetch';
import fs from 'fs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const fetchOrebroTU = async () => {
    const url = 'https://opendata.samtrafiken.se/gtfs-rt/orebro/TripUpdates.pb?key=600ef54ef3234bd1880624c148baa8f7&_t=' + Date.now();
    const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    if (!res.ok) { console.error("Failed to fetch"); return; }

    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    let count = 0;
    for (const entity of feed.entity) {
        if (entity.tripUpdate && count < 5) {
            console.log("Trip ID:", entity.tripUpdate.trip?.tripId);
            console.log("Route ID:", entity.tripUpdate.trip?.routeId);
            console.log("Vehicle ID:", entity.tripUpdate.vehicle?.id);
            count++;
        }
    }
    console.log("Total TU entities:", feed.entity.length);
};

fetchOrebroTU().catch(console.error);
