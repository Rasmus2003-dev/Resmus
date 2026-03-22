/**
 * Användarinställningar i Supabase – synkas när användaren är inloggad.
 * Kräver tabell i Supabase:
 *
 * create table if not exists public.user_preferences (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid references auth.users(id) on delete cascade not null,
 *   key text not null,
 *   value text,
 *   updated_at timestamptz default now(),
 *   unique(user_id, key)
 * );
 * alter table public.user_preferences enable row level security;
 * create policy "Users can manage own preferences"
 *   on public.user_preferences for all using (auth.uid() = user_id);
 */

import { supabase } from './supabaseClient';

const TABLE = 'user_preferences';

export async function getUserPreference(userId: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('value')
      .eq('user_id', userId)
      .eq('key', key)
      .maybeSingle();
    if (error) return null;
    return data?.value ?? null;
  } catch {
    return null;
  }
}

export async function setUserPreference(userId: string, key: string, value: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
    return !error;
  } catch {
    return false;
  }
}
