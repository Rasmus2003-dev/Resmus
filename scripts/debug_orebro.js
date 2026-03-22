import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Simple script to test fetching Orebro vehicles without React
const fetchOrebro = async () => {
    // We can just use the public API directly
    const url = 'https://opendata.samtrafiken.se/gtfs-rt/orebro/VehiclePositions.pb?key=600ef54ef3234bd1880624c148baa8f7&_t=' + Date.now();
    console.log("Fetching from " + url);
    const res = await fetch(url, {
        headers: { Accept: 'application/octet-stream' }
    });

    if (!res.ok) {
        console.error("Failed to fetch", res.status, res.statusText);
        return;
    }

    const buffer = await res.arrayBuffer();
    fs.writeFileSync('orebro_dump.pb', Buffer.from(buffer));
    console.log("Dumped protobuf to orebro_dump.pb");
};

fetchOrebro().catch(console.error);
