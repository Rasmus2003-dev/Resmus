// disruption-watcher.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load variables from .env
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://btpexmjilzxkkvoozfpe.supabase.co';
// WARNING: Use SERVICE_ROLE key here so you can bypass RLS for inserting data!
// You need to get the "service_role" key from your Supabase dashboard and put it in .env as SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vQENjrmYXqCmFmDuL16s0Q_TEBpS2O1';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('Startar bevakning av trafikstörningar för att skicka notiser via Supabase...');

// Example simplified poller. You can import your whole TransitService if needed
// But since we just need a watcher, here is a mock logic or we require TransitService:
// For simplicity in this demo, let's poll a mock endpoint or you can import from the actual service

async function fetchAndStoreDisruptions() {
  try {
    console.log(`[${new Date().toISOString()}] Hämtar störningar...`);
    
    // I en fullständig miljö, importera TransitService och anropa getVasttrafikDisruptions() etc
    // t.ex. const disruptions = await TransitService.getVasttrafikDisruptions();
    
    // Antag att du fått en ny störning (detta skulle dynamiskt jämföras med vilka som redan finns)
    // const newDisruption = { ... }
    
    // Exempel på insättning i Supabase
    /*
    const { error } = await supabase
      .from('traffic_disruptions')
      .upsert({
         id: disruption.id,
         provider: 'VASTTRAFIK',
         title: disruption.title,
         description: disruption.description,
         severity: disruption.severity,
         type: 'BUS',
         updated_time: new Date().toISOString()
      });
      
    if (error) console.error("Error inserting:", error);
    */
    
    console.log('Klar med sökning.');
  } catch (err) {
    console.error('Fel vid hämtning:', err);
  }
}

// Kör varje minut (eller var 5:e minut)
setInterval(fetchAndStoreDisruptions, 60000);
fetchAndStoreDisruptions();
