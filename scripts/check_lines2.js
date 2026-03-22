import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const printAllFields = async () => {
    const url = 'https://opendata.samtrafiken.se/gtfs-rt/orebro/VehiclePositions.pb?key=600ef54ef3234bd1880624c148baa8f7&_t=' + Date.now();
    const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    if (!res.ok) return;

    const buffer = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    for (const entity of feed.entity) {
        if (entity.vehicle?.trip?.routeId) {
            console.log("Found RouteID:", entity.vehicle.trip.routeId, "for trip", entity.vehicle.trip.tripId);
        }
        if (entity.vehicle?.vehicle?.label) {
            console.log("Found VehicleLabel:", entity.vehicle.vehicle.label);
        }
    }
    console.log("Done");
};

printAllFields().catch();
