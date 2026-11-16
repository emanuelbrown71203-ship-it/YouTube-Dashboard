-- YouTube Dashboard (yt_*) 4/6: research on the rest of YouTube (public data only).
-- Written by the yt-research and yt-sync edge functions; owners can read.

create table public.yt_research_channels (
  id                 text primary key,
  title              text,
  handle             text,
  thumbnail_url      text,
  country            text,
  published_at       timestamptz,
  subscribers        bigint,
  subscribers_hidden boolean not null default false,
  views              bigint,
  videos             integer,
  watched            boolean not null default false,
  watched_at         timestamptz,
  typical_long       numeric,
  typical_short      numeric,
  uploads_30d_long   integer,
  uploads_30d_short  integer,
  recent_long        jsonb not null default '[]'::jsonb,
  recent_short       jsonb not null default '[]'::jsonb,
  baseline_long_at   timestamptz,
  baseline_short_at  timestamptz,
  stats_at           timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.yt_research_channels is
  'Other YouTube channels seen in research. watched = on the "channels I watch" list (compared against my channel and refreshed by sync). typical_long / typical_short = median views of the channel''s last ~30 regular uploads / Shorts. recent_long / recent_short = those uploads as [{id, title, views, likes, comments, published_at, duration_s}]; baseline_long_at / baseline_short_at = when each was last fetched.';
create index yt_research_channels_watched_idx on public.yt_research_channels (watched) where watched;

create table public.yt_research_channel_daily (
  channel_id  text not null,
  date        date not null,
  subscribers bigint,
  views       bigint,
  videos      integer,
  primary key (channel_id, date)
);
comment on table public.yt_research_channel_daily is 'Daily public counters for watched channels, for growth comparisons.';

create table public.yt_research_videos (
  id                  text primary key,
  channel_id          text,
  channel_title       text,
  channel_subscribers bigint,
  title               text,
  thumbnail_url       text,
  published_at        timestamptz,
  duration_s          integer,
  format              text check (format in ('short', 'long', 'live')),
  views               bigint,
  likes               bigint,
  comments            bigint,
  tags                text[],
  typical_views       numeric,
  outlier_score       numeric,
  views_per_day       numeric,
  saved               boolean not null default false,
  saved_at            timestamptz,
  note                text,
  first_seen_at       timestamptz not null default now(),
  fetched_at          timestamptz not null default now()
);
comment on table public.yt_research_videos is
  'Videos from other channels found by the outlier finder. outlier_score = views divided by typical_views (the median views of that channel''s recent uploads in the same format); 5 means five times the channel''s usual. saved = kept in my swipe file.';
create index yt_research_videos_saved_idx on public.yt_research_videos (saved_at desc) where saved;
create index yt_research_videos_outlier_idx on public.yt_research_videos (outlier_score desc nulls last);

create table public.yt_research_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('outliers', 'keyword', 'suggest')),
  query       text not null,
  params      jsonb not null default '{}'::jsonb,
  results     jsonb not null default '[]'::jsonb,
  summary     jsonb not null default '{}'::jsonb,
  quota_units integer not null default 0,
  created_at  timestamptz not null default now()
);
comment on table public.yt_research_runs is
  'Every research run with a snapshot of what it found. kind: outliers (results = scored videos) | keyword (results = top search results) | suggest (results = search phrases people type).';
create index yt_research_runs_recent_idx on public.yt_research_runs (kind, created_at desc);

create table public.yt_keywords (
  keyword           text primary key,
  volume_score      integer,
  competition_score integer,
  overall_score     integer,
  signals           jsonb not null default '{}'::jsonb,
  results           jsonb not null default '[]'::jsonb,
  my_rank           integer,
  my_video_id       text,
  saved             boolean not null default false,
  saved_at          timestamptz,
  analyzed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
comment on table public.yt_keywords is
  'Latest analysis of each search phrase (lower case). Scores are 0-100 estimates built from the top search results, not real search volumes: volume_score = how many views the ranking videos earn per day, competition_score = how big and how optimised the ranking channels are, overall_score = the opportunity (higher is better). my_rank = position of my best video in the top results, null if absent.';
create index yt_keywords_saved_idx on public.yt_keywords (saved_at desc) where saved;

create table public.yt_quota_usage (
  day        date primary key,
  units      integer not null default 0,
  calls      integer not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.yt_quota_usage is
  'YouTube Data API units spent per Pacific-time day. Google allows 10,000 a day for free; a search costs 100, most other calls 1.';

create trigger yt_research_channels_touch before update on public.yt_research_channels
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_research_channels      enable row level security;
alter table public.yt_research_channel_daily enable row level security;
alter table public.yt_research_videos        enable row level security;
alter table public.yt_research_runs          enable row level security;
alter table public.yt_keywords               enable row level security;
alter table public.yt_quota_usage            enable row level security;

create policy "Owners can read" on public.yt_research_channels
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_research_channel_daily
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_research_videos
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_research_runs
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_keywords
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_quota_usage
  for select to authenticated using ((select public.yt_is_owner()));
