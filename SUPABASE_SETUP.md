# Supabase-koppling i Resmus

Resmus använder Supabase för inloggning och (valfritt) sparande av användarinställningar.

## Miljövariabler (valfritt)

- `VITE_SUPABASE_URL` – din Supabase-projekt-URL  
- `VITE_SUPABASE_ANON_KEY` – din anon/public-nyckel  

Om de inte sätts används standardvärden från projektet.

## Tabell för användarinställningar

Kör följande SQL i Supabase (SQL Editor) för att aktivera "Spara inställningar i molnet":

```sql
create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value text,
  updated_at timestamptz default now(),
  unique(user_id, key)
);

alter table public.user_preferences enable row level security;

create policy "Users can manage own preferences"
  on public.user_preferences for all
  using (auth.uid() = user_id);
```

Därefter kan inloggade användares inställningar (t.ex. favoritregion) sparas och hämtas via `userPreferencesService.ts`.
