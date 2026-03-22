-- ============================================================
--  Tabell: watched_journeys
--  Används av Resmus för att spara bevakade resor per användare
-- ============================================================

create table if not exists public.watched_journeys (
    id               text primary key,          -- journey id (client-generated)
    user_id          uuid not null references auth.users(id) on delete cascade,
    from_name        text not null,
    to_name          text not null,
    departure_time   text not null,             -- "HH:MM" local time
    arrival_time     text not null,
    line_summary     text not null default '',  -- "17 → 3955 → X30"
    duration_min     integer not null default 0,
    notified         boolean not null default false,
    created_at       timestamptz not null default now()
);

-- Only the owner can read/write their own rows
alter table public.watched_journeys enable row level security;

create policy "Own rows only"
    on public.watched_journeys for all
    using (auth.uid() = user_id);

-- Index for fast per-user queries
create index if not exists idx_wj_user_dep
    on public.watched_journeys (user_id, departure_time);
