-- =====================================================================
-- YouTube Dashboard (yt_*) — schema
--
-- Lives in the shared "zay-apps" Supabase project next to the other apps
-- (households/pa_*). Everything for this app is prefixed yt_.
--
-- Access model
--   * Every browser signs in anonymously (Supabase Auth).
--   * public.yt_owners lists the browsers allowed in. A row is added by the
--     yt-auth edge function after Google sign-in as the channel owner, or by
--     redeeming a one-time access code (public.yt_redeem_access_code).
--   * Stats tables are written only by the yt-sync edge function (service
--     role). Owners can read them; ideas are fully editable by owners.
--   * yt_private / yt_oauth_states / yt_access_codes are server-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.yt_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------
create table public.yt_owners (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  method       text not null check (method in ('google', 'access_code')),
  device       text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
comment on table public.yt_owners is
  'Browsers allowed to use the YouTube dashboard (one anonymous auth user per browser). Added by the yt-auth edge function (Google sign-in as the channel owner) or yt_redeem_access_code().';

create or replace function public.yt_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.yt_owners where user_id = (select auth.uid()));
$$;

create table public.yt_private (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
comment on table public.yt_private is
  'Server-only settings for the YouTube dashboard (Google OAuth client, refresh token, cron secret, owner channel id, allowed return origins). RLS on with no policies on purpose: only the service role (edge functions) and cron can read it.';

create table public.yt_oauth_states (
  state      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  return_to  text,
  created_at timestamptz not null default now()
);
comment on table public.yt_oauth_states is 'Short-lived Google OAuth state values (server-only).';

create table public.yt_access_codes (
  code_hash  text primary key,
  note       text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.yt_access_codes is
  'One-time access codes (sha256 of the code). Create with select public.yt_create_access_code(); a code lets one browser in and is then deleted.';

-- ---------------------------------------------------------------------
-- Channel + stats
-- ---------------------------------------------------------------------
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
  'One snapshot of the public channel counters per day (latest capture of that day wins). Use for subscriber/total-view growth over time.';

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
  'Channel-wide YouTube Studio numbers per day (YouTube Analytics API). Since 2026-08-27 YouTube counts views from the first frame (views ~1.7-1.9x higher than before on long-form); compare engaged_views across that date. Data lags ~2-3 days. likes can be negative (net).';
comment on column public.yt_analytics_daily.avg_view_pct is 'Average percentage viewed. Shorts can exceed 100 because of loops.';

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
  'Daily views split by format: short = Shorts, long = regular uploads (videoOnDemand), live = live streams and their VODs.';

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
  stats_updated_at     timestamptz,
  analytics_updated_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.yt_videos is
  'Every upload on the channel with its latest public stats (views/likes/comments) and lifetime Studio analytics (minutes_watched, avg view duration/percentage, subs_gained, shares). content_type: short | long | live. Prefer the yt_v_videos view for analysis.';
comment on column public.yt_videos.content_type_source is 'How content_type was decided: analytics | shorts_url | duration | live_details | vidiq | manual (manual is never overwritten).';
create index yt_videos_published_idx on public.yt_videos (published_at desc);
create index yt_videos_type_published_idx on public.yt_videos (content_type, published_at desc);

create table public.yt_video_daily (
  video_id text not null references public.yt_videos (id) on delete cascade,
  date     date not null,
  views    bigint,
  likes    bigint,
  comments bigint,
  primary key (video_id, date)
);
comment on table public.yt_video_daily is
  'Per-video public counters captured once per day (cumulative totals). Difference two dates to get views gained in between.';
create index yt_video_daily_date_idx on public.yt_video_daily (date);

create table public.yt_video_analytics_daily (
  video_id        text not null references public.yt_videos (id) on delete cascade,
  date            date not null,
  views           bigint,
  engaged_views   bigint,
  minutes_watched bigint,
  subs_gained     integer,
  primary key (video_id, date)
);
comment on table public.yt_video_analytics_daily is
  'Studio views gained per day for recent uploads (first weeks after publish). Use to compare a new upload''s first days with earlier ones.';

create table public.yt_reports (
  key          text primary key,
  period_start date,
  period_end   date,
  data         jsonb not null default '[]'::jsonb,
  fetched_at   timestamptz not null default now()
);
comment on table public.yt_reports is
  'Latest breakdown reports from YouTube Analytics; data is an array of row objects keyed by API column name. Keys: top_videos_28d, traffic_sources_28d, geography_28d, demographics_28d, devices_28d, content_type_28d.';

create table public.yt_sync_runs (
  id          bigint generated always as identity primary key,
  source      text not null,
  status      text not null default 'running' check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  summary     jsonb,
  error       text
);
comment on table public.yt_sync_runs is 'History of syncs from YouTube (source: cron | manual | connect | seed).';
create index yt_sync_runs_started_idx on public.yt_sync_runs (started_at desc);

-- ---------------------------------------------------------------------
-- Ideas
-- ---------------------------------------------------------------------
create table public.yt_ideas (
  id                uuid primary key default gen_random_uuid(),
  format            text not null default 'long' check (format in ('long', 'short')),
  status            text not null default 'idea'
                    check (status in ('idea', 'scripting', 'filming', 'editing', 'scheduled', 'published')),
  title             text not null,
  title_options     text[] not null default '{}',
  hook              text,
  concept           text,
  outline           text,
  thumbnail_concept text,
  target_length_s   integer,
  priority          smallint not null default 2 check (priority between 1 and 3),
  tags              text[] not null default '{}',
  target_date       date,
  inspiration       text,
  notes             text,
  video_id          text,
  parent_id         uuid references public.yt_ideas (id) on delete set null,
  sort_order        double precision not null default extract(epoch from now()),
  archived          boolean not null default false,
  source            text not null default 'dashboard',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.yt_ideas is
  'Video ideas and their production status. format: long | short. status: idea -> scripting -> filming -> editing -> scheduled -> published. priority 1 = high, 3 = low. parent_id links Shorts cut from a long-form idea. video_id = the YouTube video it became. source = dashboard | claude.';
create index yt_ideas_board_idx on public.yt_ideas (archived, status, sort_order);

create trigger yt_ideas_touch before update on public.yt_ideas
  for each row execute function public.yt_touch_updated_at();
create trigger yt_videos_touch before update on public.yt_videos
  for each row execute function public.yt_touch_updated_at();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.yt_owners                enable row level security;
alter table public.yt_private               enable row level security;
alter table public.yt_oauth_states          enable row level security;
alter table public.yt_access_codes          enable row level security;
alter table public.yt_channel               enable row level security;
alter table public.yt_channel_daily         enable row level security;
alter table public.yt_analytics_daily       enable row level security;
alter table public.yt_content_type_daily    enable row level security;
alter table public.yt_videos                enable row level security;
alter table public.yt_video_daily           enable row level security;
alter table public.yt_video_analytics_daily enable row level security;
alter table public.yt_reports               enable row level security;
alter table public.yt_sync_runs             enable row level security;
alter table public.yt_ideas                 enable row level security;

-- Nothing here is for signed-out (anon) visitors.
revoke all on public.yt_owners, public.yt_private, public.yt_oauth_states, public.yt_access_codes,
  public.yt_channel, public.yt_channel_daily, public.yt_analytics_daily, public.yt_content_type_daily,
  public.yt_videos, public.yt_video_daily, public.yt_video_analytics_daily, public.yt_reports,
  public.yt_sync_runs, public.yt_ideas
  from anon;

-- Server-only tables: no client access at all.
revoke all on public.yt_private, public.yt_oauth_states, public.yt_access_codes from authenticated;

-- Read-only stats for owners.
revoke insert, update, delete, truncate on public.yt_channel, public.yt_channel_daily, public.yt_analytics_daily,
  public.yt_content_type_daily, public.yt_videos, public.yt_video_daily, public.yt_video_analytics_daily,
  public.yt_reports, public.yt_sync_runs
  from authenticated;
revoke insert, update, truncate on public.yt_owners from authenticated;

create policy "Owners can see signed-in browsers" on public.yt_owners
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can sign out browsers" on public.yt_owners
  for delete to authenticated using ((select public.yt_is_owner()));

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

create policy "Owners can read ideas" on public.yt_ideas
  for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add ideas" on public.yt_ideas
  for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit ideas" on public.yt_ideas
  for update to authenticated using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
create policy "Owners can delete ideas" on public.yt_ideas
  for delete to authenticated using ((select public.yt_is_owner()));

-- ---------------------------------------------------------------------
-- RPCs for the app
-- ---------------------------------------------------------------------

-- Who am I? Also records that this browser was seen.
create or replace function public.yt_whoami()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.yt_owners;
begin
  update public.yt_owners set last_seen_at = now()
   where user_id = (select auth.uid())
  returning * into me;
  if me.user_id is null then
    return jsonb_build_object('owner', false);
  end if;
  return jsonb_build_object('owner', true, 'method', me.method, 'since', me.created_at);
end;
$$;

-- What the sign-in screen needs to know (safe to show anyone signed in anonymously).
create or replace function public.yt_public_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_configured', exists (select 1 from public.yt_private where key = 'google_client_id')
                     and exists (select 1 from public.yt_private where key = 'google_client_secret'),
    'youtube_connected', exists (select 1 from public.yt_private where key = 'google_refresh_token')
  );
$$;

-- Connection details for the settings screen (owners only).
create or replace function public.yt_connection()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'google_configured', bool_or(key = 'google_client_id') and bool_or(key = 'google_client_secret'),
    'google_client_id', max(value) filter (where key = 'google_client_id'),
    'youtube_connected', bool_or(key = 'google_refresh_token'),
    'connected_at', max(value) filter (where key = 'google_connected_at'),
    'connection_error', max(value) filter (where key = 'google_error'),
    'owner_channel_id', max(value) filter (where key = 'owner_channel_id')
  ) into result
  from public.yt_private;
  return result;
end;
$$;

-- One-time access codes. Callable from the SQL editor / Claude (no JWT) or by a
-- signed-in owner who wants to add another browser.
create or replace function public.yt_create_access_code(p_note text default null, p_ttl interval default interval '24 hours')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw  bytea := extensions.gen_random_bytes(10);
  code text := '';
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if (select auth.uid()) is null then
    if jwt_role not in ('', 'service_role') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_ttl > interval '7 days' then
    p_ttl := interval '7 days';
  end if;

  for i in 0..9 loop
    code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  end loop;

  delete from public.yt_access_codes where expires_at < now();
  insert into public.yt_access_codes (code_hash, note, expires_at)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), left(p_note, 200), now() + p_ttl);

  return substr(code, 1, 5) || '-' || substr(code, 6, 5);
end;
$$;

create or replace function public.yt_redeem_access_code(p_code text, p_device text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  used text;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  delete from public.yt_access_codes
   where code_hash = encode(extensions.digest(normalized, 'sha256'), 'hex')
     and expires_at > now()
  returning code_hash into used;

  if used is null then
    perform pg_sleep(1); -- slow down guessing
    return false;
  end if;

  insert into public.yt_owners (user_id, method, device)
  values ((select auth.uid()), 'access_code', left(p_device, 160))
  on conflict (user_id) do update set last_seen_at = now();
  return true;
end;
$$;

create or replace function public.yt_sign_out(p_everywhere boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.yt_is_owner() then
    return;
  end if;
  if p_everywhere then
    delete from public.yt_owners where true;
  else
    delete from public.yt_owners where user_id = (select auth.uid());
  end if;
end;
$$;

-- Fix a video's format by hand (sync never overwrites a manual choice).
create or replace function public.yt_set_video_type(p_video_id text, p_type text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_type not in ('short', 'long', 'live') then
    raise exception 'format must be short, long or live';
  end if;
  update public.yt_videos
     set content_type = p_type, content_type_source = 'manual'
   where id = p_video_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Views for analysis (security_invoker so RLS still applies to app users)
-- ---------------------------------------------------------------------
create or replace view public.yt_v_videos
with (security_invoker = true)
as
select
  v.id,
  v.title,
  v.content_type,
  v.privacy,
  v.published_at,
  v.duration_s,
  v.views,
  v.likes,
  v.comments,
  v.shares,
  v.subs_gained,
  round(v.minutes_watched / 60.0, 1) as watch_hours,
  round(v.avg_view_duration_s) as avg_view_duration_s,
  round(v.avg_view_pct, 1) as avg_view_pct,
  greatest(0, current_date - (v.published_at at time zone 'utc')::date) as age_days,
  round(v.views::numeric / greatest(1, extract(epoch from (now() - v.published_at)) / 86400.0), 1) as views_per_day,
  case when v.views > 0
       then round(100.0 * (coalesce(v.likes, 0) + coalesce(v.comments, 0)) / v.views, 2) end as engagement_pct,
  round(m.median_views) as typical_views,
  case when m.median_views > 0 then round(v.views / m.median_views, 2) end as vs_typical,
  'https://www.youtube.com/' || case when v.content_type = 'short' then 'shorts/' else 'watch?v=' end || v.id as url,
  v.thumbnail_url,
  v.tags,
  v.stats_updated_at
from public.yt_videos v
left join lateral (
  select (percentile_cont(0.5) within group (order by prev.views))::numeric as median_views
  from (
    select x.views
    from public.yt_videos x
    where x.content_type is not distinct from v.content_type
      and x.privacy = 'public'
      and x.published_at < v.published_at
      and x.views is not null
    order by x.published_at desc
    limit 20
  ) prev
) m on true;
comment on view public.yt_v_videos is
  'One row per upload with derived metrics: watch_hours, views_per_day, engagement_pct ((likes+comments)/views), typical_views (median views of the 20 previous public uploads of the same format) and vs_typical (views / typical_views; 2.0 = twice the usual).';

create or replace view public.yt_v_ideas
with (security_invoker = true)
as
select
  i.id, i.format, i.status, i.priority, i.title, i.hook, i.concept, i.title_options,
  i.thumbnail_concept, i.target_length_s, i.target_date, i.tags, i.archived, i.source,
  i.parent_id, p.title as parent_title,
  i.video_id, v.title as video_title, v.views as video_views,
  i.created_at, i.updated_at
from public.yt_ideas i
left join public.yt_ideas p on p.id = i.parent_id
left join public.yt_videos v on v.id = i.video_id;
comment on view public.yt_v_ideas is 'Ideas with their parent idea title and the published video they became (if any).';

-- ---------------------------------------------------------------------
-- One-call briefing for Claude:  select public.yt_claude_context();
-- ---------------------------------------------------------------------
create or replace function public.yt_claude_context()
returns jsonb
language sql
stable
set search_path = ''
as $$
with
ch as (
  select * from public.yt_channel order by updated_at desc limit 1
),
bounds as (
  select max(date) as d from public.yt_analytics_daily
),
cur as (
  select count(*) as days, sum(a.views) as views, sum(a.engaged_views) as engaged_views,
         round(sum(a.minutes_watched) / 60.0, 1) as watch_hours,
         sum(a.subs_gained) as subs_gained, sum(a.subs_lost) as subs_lost,
         sum(a.likes) as likes, sum(a.comments) as comments, sum(a.shares) as shares,
         min(a.date) as from_date, max(a.date) as to_date
  from public.yt_analytics_daily a, bounds b
  where a.date > b.d - 28 and a.date <= b.d
),
prev as (
  select count(*) as days, sum(a.views) as views, sum(a.engaged_views) as engaged_views,
         round(sum(a.minutes_watched) / 60.0, 1) as watch_hours,
         sum(a.subs_gained) as subs_gained, sum(a.subs_lost) as subs_lost,
         min(a.date) as from_date, max(a.date) as to_date
  from public.yt_analytics_daily a, bounds b
  where a.date > b.d - 56 and a.date <= b.d - 28
),
fmt as (
  select c.content_type, sum(c.views) as views, sum(c.engaged_views) as engaged_views,
         round(sum(c.minutes_watched) / 60.0, 1) as watch_hours
  from public.yt_content_type_daily c, bounds b
  where c.date > b.d - 28 and c.date <= b.d
  group by c.content_type
),
uploads as (
  select
    count(*) filter (where privacy = 'public') as public_videos_tracked,
    count(*) filter (where privacy = 'public' and content_type = 'short') as shorts,
    count(*) filter (where privacy = 'public' and content_type = 'long') as long_form,
    count(*) filter (where privacy = 'public' and content_type = 'live') as live,
    count(*) filter (where privacy = 'public' and published_at > now() - interval '28 days') as uploads_last_28d,
    max(published_at) filter (where privacy = 'public') as last_upload_at
  from public.yt_videos
),
recent as (
  select id, title, content_type, published_at::date as published, views, likes, comments,
         views_per_day, vs_typical
  from public.yt_v_videos
  where privacy = 'public'
  order by published_at desc nulls last
  limit 10
),
top_all as (
  select id, title, content_type, published_at::date as published, views, likes, watch_hours, subs_gained
  from public.yt_v_videos
  order by views desc nulls last
  limit 10
),
ideas as (
  select
    count(*) filter (where not archived and status <> 'published') as open_ideas,
    count(*) filter (where not archived and status <> 'published' and format = 'long') as open_long,
    count(*) filter (where not archived and status <> 'published' and format = 'short') as open_short,
    count(*) filter (where status = 'published') as published
  from public.yt_ideas
),
next_up as (
  select id, format, status, priority, title, hook, target_date
  from public.yt_ideas
  where not archived and status <> 'published'
  order by priority, target_date nulls last, sort_order
  limit 10
),
last_sync as (
  select source, status, started_at, finished_at, error
  from public.yt_sync_runs
  order by started_at desc
  limit 1
)
select jsonb_build_object(
  'generated_at', now(),
  'channel', (select jsonb_build_object(
      'id', id, 'title', title, 'handle', handle, 'subscribers', subscribers,
      'total_views', views, 'videos', videos, 'country', country,
      'created', published_at::date, 'counters_updated_at', updated_at) from ch),
  'last_28_days', (select to_jsonb(cur) from cur),
  'previous_28_days', (select to_jsonb(prev) from prev),
  'views_change_pct', (select round(100.0 * (cur.views - prev.views) / nullif(prev.views, 0), 1) from cur, prev),
  'engaged_views_change_pct', (select round(100.0 * (cur.engaged_views - prev.engaged_views) / nullif(prev.engaged_views, 0), 1) from cur, prev),
  'by_format_last_28_days', (select coalesce(jsonb_agg(to_jsonb(fmt) order by fmt.views desc), '[]'::jsonb) from fmt),
  'uploads', (select to_jsonb(uploads) from uploads),
  'recent_uploads', (select coalesce(jsonb_agg(to_jsonb(recent) order by recent.published desc), '[]'::jsonb) from recent),
  'top_videos_all_time', (select coalesce(jsonb_agg(to_jsonb(top_all) order by top_all.views desc), '[]'::jsonb) from top_all),
  'reports', (select coalesce(jsonb_object_agg(key, jsonb_build_object('from', period_start, 'to', period_end, 'rows', data)), '{}'::jsonb) from public.yt_reports),
  'ideas', (select to_jsonb(ideas) from ideas),
  'next_up_ideas', (select coalesce(jsonb_agg(to_jsonb(next_up)), '[]'::jsonb) from next_up),
  'last_sync', (select to_jsonb(last_sync) from last_sync),
  'notes', jsonb_build_array(
    'Analytics lag YouTube by ~2-3 days; last_28_days ends at the latest day with data.',
    'Since 2026-08-27 YouTube counts views from the first frame (views ~1.7-1.9x higher on long-form). Use engaged_views for comparisons across that date.',
    'content_type/format: short = Shorts, long = regular uploads, live = live streams and their VODs.',
    'vs_typical = views divided by the median of the 20 previous public uploads of the same format.'
  )
);
$$;
comment on function public.yt_claude_context() is
  'Everything Claude needs to answer questions about the channel in one JSON document. Run: select public.yt_claude_context();';

-- ---------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------
revoke all on function public.yt_is_owner() from public, anon;
revoke all on function public.yt_whoami() from public, anon;
revoke all on function public.yt_public_status() from public, anon;
revoke all on function public.yt_connection() from public, anon;
revoke all on function public.yt_create_access_code(text, interval) from public, anon;
revoke all on function public.yt_redeem_access_code(text, text) from public, anon;
revoke all on function public.yt_sign_out(boolean) from public, anon;
revoke all on function public.yt_set_video_type(text, text) from public, anon;
revoke all on function public.yt_claude_context() from public, anon;
revoke all on function public.yt_touch_updated_at() from public, anon;

grant execute on function public.yt_is_owner() to authenticated, service_role;
grant execute on function public.yt_whoami() to authenticated;
grant execute on function public.yt_public_status() to authenticated;
grant execute on function public.yt_connection() to authenticated;
grant execute on function public.yt_create_access_code(text, interval) to authenticated, service_role;
grant execute on function public.yt_redeem_access_code(text, text) to authenticated;
grant execute on function public.yt_sign_out(boolean) to authenticated;
grant execute on function public.yt_set_video_type(text, text) to authenticated;
grant execute on function public.yt_claude_context() to authenticated, service_role;

revoke all on public.yt_v_videos, public.yt_v_ideas from anon;
grant select on public.yt_v_videos, public.yt_v_ideas to authenticated;

-- ---------------------------------------------------------------------
-- Config + schedule
-- ---------------------------------------------------------------------
insert into public.yt_private (key, value) values
  ('owner_channel_id', 'UChsuiSVwIF3O23DdjL907jg'),
  ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('allowed_origins', '["http://localhost:5173","http://localhost:4173"]')
on conflict (key) do nothing;

-- Sync from YouTube every 6 hours (no-op until YouTube is connected).
select cron.schedule(
  'yt-sync',
  '23 */6 * * *',
  $cron$
  select net.http_post(
    url := 'https://nivsnjvrsqekyocvtema.supabase.co/functions/v1/yt-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.yt_private where key = 'cron_secret')
    ),
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
