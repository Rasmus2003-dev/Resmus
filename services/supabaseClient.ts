import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://btpexmjilzxkkvoozfpe.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vQENjrmYXqCmFmDuL16s0Q_TEBpS2O1';

export const supabase = createClient(supabaseUrl, supabaseKey);
