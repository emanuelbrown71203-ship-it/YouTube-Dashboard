-- YouTube Dashboard (yt_*) 25: daily idea swings.
--
-- The owner's 15-minute routine (their "Daily idea swings" template): a full game swing, a segmented
-- game swing and a Short swing each write a new idea; an upgrade swing pushes one idea already on the
-- board higher with one of their score levers. Each swing done is one row, so "2 of 4 done today" is
-- the same on every device. Owners read and write them; nothing here is ever removed.

create table if not exists public.yt_swings (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  kind        text not null check (kind in ('full', 'segment', 'short', 'upgrade')),
  idea_id     uuid references public.yt_ideas (id),
  levers      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_swings is
  'Daily idea swings the owner did. day = their own date (from their device), kind = full (a whole game) | segment (one act, area or boss) | short (one moment) | upgrade (an idea already on the board, pushed higher), idea_id = the idea it wrote or upgraded, levers = the score levers ticked on an upgrade. trashed_at set = undone.';
create index if not exists yt_swings_day_idx on public.yt_swings (day desc) where trashed_at is null;

alter table public.yt_swings enable row level security;
create policy "Owners can read swings" on public.yt_swings for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add swings"  on public.yt_swings for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit swings" on public.yt_swings for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_swings from anon, authenticated;
grant select, insert, update on table public.yt_swings to authenticated;
