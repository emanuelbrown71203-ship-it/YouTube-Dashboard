-- YouTube Dashboard (yt_*) 2/6: the channel and its stats.
-- Written only by the yt-sync edge function (service role); owners can read.

create table public.yt_channel (
  id                  text primary key,
  title               text,
  handle              text,
  description         text,
  thumbnail_url       text,
  country             text,
  published_at        timestamptz,
  uploads_playlist_id text,
  subscribers         bigint,
  views               bigint,
  videos              integer,
  updated_at          timestamptz not null default now()
);
comment on table public.yt_channel is 'The connected YouTube channel and its current public counters.';

create table public.yt_channel_daily (
  date        date primary key,
  subscribers bigint,
  views       bigint,
  videos      integer,
  captured_at timestamptz not null default now()
);
comment on table public.yt_channel_daily is
  'One snapshot of the public channel counters per day (last capture of the day wins). Use for subscriber and total-view growth over time.';

create table public.yt_analytics_daily (
  date                date primary key,
  views               bigint,
  engaged_views       bigint,
  minutes_watched     bigint,
  avg_view_duration_s numeric,
  avg_view_pct        numeric,
  subs_gained         integer,
  subs_lost           integer,
  likes               integer,
  comments            integer,
  shares              integer,
  updated_at          timestamptz not null default now()
);
comment on table public.yt_analytics_daily is
  'Channel-wide YouTube Studio numbers per day. Data lags YouTube by 2-3 days. Since 2026-08-27 YouTube counts a view from the first frame (views run ~1.7-1.9x higher on long-form), so compare engaged_views across that date. likes is net and can be negative.';
comment on column public.yt_analytics_daily.avg_view_pct is 'Average percentage viewed. Shorts can exceed 100 because they loop.';

create table public.yt_content_type_daily (
  date            date not null,
  content_type    text not null check (content_type in ('short', 'long', 'live', 'other')),
  views           bigint,
  engaged_views   bigint,
  minutes_watched bigint,
  updated_at      timestamptz not null default now(),
  primary key (date, content_type)
);
comment on table public.yt_content_type_daily is
  'Daily views split by format: short = Shorts, long = regular uploads, live = live streams and their replays.';

create table public.yt_videos (
  id                   text primary key,
  title                text,
  description          text,
  published_at         timestamptz,
  duration_s           integer,
  content_type         text check (content_type in ('short', 'long', 'live')),
  content_type_source  text,
  privacy              text,
  thumbnail_url        text,
  tags                 text[],
  views                bigint,
  likes                bigint,
  comments             bigint,
  engaged_views        bigint,
  minutes_watched      bigint,
  avg_view_duration_s  numeric,
  avg_view_pct         numeric,
  subs_gained          integer,
  shares               integer,
  traffic              jsonb,
  traffic_updated_at   timestamptz,
  stats_updated_at     timestamptz,
  analytics_updated_at timestamptz,
  removed_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.yt_videos is
  'Every upload on the channel: latest public stats (views, likes, comments) plus lifetime Studio numbers (minutes_watched, avg_view_duration_s, avg_view_pct, subs_gained, shares). content_type: short | long | live. removed_at is set when a video is no longer on the channel. Prefer the yt_v_videos view for analysis.';
comment on column public.yt_videos.content_type_source is
  'How content_type was decided: playlist | duration | live_details | seed | manual (a manual choice is never overwritten by sync).';
comment on column public.yt_videos.traffic is
  'Lifetime views by where they came from: {search, suggested, browse, shorts_feed, channel_pages, playlists, notifications, external, other, total}.';
create index yt_videos_published_idx on public.yt_videos (published_at desc);
create index yt_videos_type_published_idx on public.yt_videos (content_type, published_at desc);

create table public.yt_video_daily (
  video_id text not null,
  date     date not null,
  views    bigint,
  likes    bigint,
  comments bigint,
  primary key (video_id, date)
);
comment on table public.yt_video_daily is
  'Per-video public counters captured once a day (running totals). Subtract two dates to get views gained in between.';
create index yt_video_daily_date_idx on public.yt_video_daily (date);

create table public.yt_video_analytics_daily (
  video_id        text not null,
  date            date not null,
  views           bigint,
  engaged_views   bigint,
  minutes_watched bigint,
  subs_gained     integer,
  primary key (video_id, date)
);
comment on table public.yt_video_analytics_daily is
  'Studio views gained per day for recent uploads (their first weeks). Use to compare how a new upload starts against earlier ones.';

create table public.yt_reports (
  key          text primary key,
  period_start date,
  period_end   date,
  data         jsonb not null default '[]'::jsonb,
  fetched_at   timestamptz not null default now()
);
comment on table public.yt_reports is
  'Latest 28-day breakdowns from YouTube Analytics. data is an array of row objects. Keys: traffic_sources_28d, geography_28d, demographics_28d, devices_28d, top_videos_28d.';

create table public.yt_sync_runs (
  id          bigint generated always as identity primary key,
  source      text not null,
  status      text not null default 'running' check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  summary     jsonb,
  error       text
);
comment on table public.yt_sync_runs is 'History of syncs from YouTube. source: cron | manual | connect | seed.';
create index yt_sync_runs_started_idx on public.yt_sync_runs (started_at desc);

create trigger yt_videos_touch before update on public.yt_videos
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_channel               enable row level security;
alter table public.yt_channel_daily         enable row level security;
alter table public.yt_analytics_daily       enable row level security;
alter table public.yt_content_type_daily    enable row level security;
alter table public.yt_videos                enable row level security;
alter table public.yt_video_daily           enable row level security;
alter table public.yt_video_analytics_daily enable row level security;
alter table public.yt_reports               enable row level security;
alter table public.yt_sync_runs             enable row level security;

create policy "Owners can read" on public.yt_channel
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_channel_daily
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_analytics_daily
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_content_type_daily
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_videos
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_video_daily
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_video_analytics_daily
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_reports
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_sync_runs
  for select to authenticated using ((select public.yt_is_owner()));
