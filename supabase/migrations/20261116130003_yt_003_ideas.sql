-- YouTube Dashboard (yt_*) 3/6: video ideas. Owners read and write these directly.

create table public.yt_ideas (
  id                   uuid primary key default gen_random_uuid(),
  format               text not null default 'long' check (format in ('long', 'short')),
  status               text not null default 'idea'
                       check (status in ('idea', 'scripting', 'filming', 'editing', 'scheduled', 'published')),
  discovery            text check (discovery in ('recommended', 'search')),
  title                text not null,
  title_options        text[] not null default '{}',
  target_keyword       text,
  hook                 text,
  concept              text,
  outline              text,
  thumbnail_concept    text,
  target_length_s      integer,
  priority             smallint not null default 2 check (priority between 1 and 3),
  tags                 text[] not null default '{}',
  target_date          date,
  inspiration_url      text,
  inspiration_video_id text,
  notes                text,
  video_id             text,
  parent_id            uuid,
  sort_order           double precision not null default extract(epoch from now()),
  archived             boolean not null default false,
  source               text not null default 'dashboard',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  trashed_at           timestamptz
);
comment on table public.yt_ideas is
  'Video ideas and where each one is in production. format: long | short. status: idea > scripting > filming > editing > scheduled > published. discovery: recommended (made for the home feed, suggested and the Shorts feed) | search (made to rank for target_keyword). priority 1 = high, 3 = low. parent_id links a Short cut from a long-form idea. video_id = the upload it became. inspiration_video_id = a video saved from research (yt_research_videos). source: dashboard | claude | research. A row with trashed_at set is in the bin: hide it.';
create index yt_ideas_board_idx on public.yt_ideas (status, sort_order) where trashed_at is null;

create trigger yt_ideas_touch before update on public.yt_ideas
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_ideas enable row level security;

create policy "Owners can read ideas" on public.yt_ideas
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add ideas" on public.yt_ideas
  for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit ideas" on public.yt_ideas
  for update to authenticated using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
