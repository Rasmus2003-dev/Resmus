import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import fs from 'fs';

const dump = fs.readFileSync('orebro_dump.pb');
const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(dump);

let count = 0;
for (const entity of feed.entity) {
    if (entity.vehicle && count < 10) {
        console.log("ID:", entity.id);
        console.log("Vehicle ID:", entity.vehicle.vehicle?.id);
        console.log("Vehicle Label:", entity.vehicle.vehicle?.label);
        console.log("Trip ID:", entity.vehicle.trip?.tripId);
        console.log("Route ID:", entity.vehicle.trip?.routeId);
        count++;
    }
}
console.log("Total entities:", feed.entity.length);
