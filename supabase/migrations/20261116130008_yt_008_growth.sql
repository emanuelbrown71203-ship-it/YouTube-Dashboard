-- YouTube Dashboard (yt_*) 8: goals, title and thumbnail tests, a change log,
-- comments, what feeds the long videos, the game each video is about, and
-- plain-English notes on research videos. Nothing here removes anything.

-- What each video is about (usually the game), so videos can be grouped.
alter table public.yt_videos add column if not exists topic text;
alter table public.yt_videos add column if not exists topic_source text;
alter table public.yt_videos add column if not exists feeders jsonb;
alter table public.yt_videos add column if not exists feeders_updated_at timestamptz;
comment on column public.yt_videos.topic is
  'What the video is about, usually the game ("Elden Ring"). topic_source: guess (from hashtags and tags) | ai | manual. A manual choice is never overwritten.';
comment on column public.yt_videos.feeders is
  'For long videos: the videos that sent viewers here through YouTube''s suggestions, as [{video_id, views}], most first. Used to see which Shorts feed long videos.';

-- Plain-English notes on a video found in research.
alter table public.yt_research_videos add column if not exists language text;
alter table public.yt_research_videos add column if not exists description text;
alter table public.yt_research_videos add column if not exists explanation jsonb;
alter table public.yt_research_videos add column if not exists explained_at timestamptz;
comment on column public.yt_research_videos.explanation is
  'Written by the AI from the title, description, tags and top comments (it cannot watch the video): {title_en, what_happens, why_it_worked, your_version, confidence}.';

create table public.yt_video_changes (
  id         bigint generated always as identity primary key,
  video_id   text not null,
  field      text not null check (field in ('title', 'thumbnail')),
  old_value  text,
  new_value  text,
  changed_at timestamptz not null default now()
);
comment on table public.yt_video_changes is
  'Title and thumbnail changes the sync noticed on the owner''s videos, newest last. changed_at is when the sync saw it, so up to six hours after the real change.';
create index yt_video_changes_video_idx on public.yt_video_changes (video_id, changed_at);

create table public.yt_tests (
  id          uuid primary key default gen_random_uuid(),
  video_id    text not null,
  kind        text not null default 'thumbnail' check (kind in ('thumbnail', 'title', 'both', 'other')),
  what        text not null,
  why         text,
  started_on  date not null default current_date,
  ended_on    date,
  ctr_before  numeric,
  ctr_after   numeric,
  verdict     text check (verdict in ('better', 'worse', 'same')),
  learned     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_tests is
  'The owner''s title and thumbnail tests. what = what was changed, why = what they expected. The stats before and after come from yt_video_analytics_daily around started_on. ctr_before / ctr_after are typed in from YouTube Studio because YouTube does not share click-through rate with apps. verdict and learned are the owner''s conclusion. trashed_at set = in the bin.';
create trigger yt_tests_touch before update on public.yt_tests
  for each row execute function public.yt_touch_updated_at();

create table public.yt_goals (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('subscribers', 'video_views', 'personal')),
  title       text not null,
  target      numeric,
  start_value numeric,
  video_id    text,
  due_on      date,
  notes       text,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_goals is
  'The owner''s goals. kind: subscribers (channel reaches target), video_views (video_id reaches target views), personal (anything else, such as a first sponsor; ticked off by hand). start_value = the number when the goal was set. done_at set = reached. trashed_at set = in the bin.';
create trigger yt_goals_touch before update on public.yt_goals
  for each row execute function public.yt_touch_updated_at();

create table public.yt_comments (
  id           text primary key,
  video_id     text,
  author       text,
  text         text not null,
  likes        integer not null default 0,
  published_at timestamptz,
  sentiment    text check (sentiment in ('positive', 'neutral', 'negative')),
  theme        text,
  is_question  boolean,
  pinned       boolean not null default false,
  hidden       boolean not null default false,
  fetched_at   timestamptz not null default now()
);
comment on table public.yt_comments is
  'Recent comments on the owner''s videos. sentiment and theme are the AI''s reading (null until it has read them). pinned = the owner keeps it on the front page. hidden = the owner took it off the front page.';
create index yt_comments_recent_idx on public.yt_comments (published_at desc);

alter table public.yt_video_changes enable row level security;
alter table public.yt_tests         enable row level security;
alter table public.yt_goals         enable row level security;
alter table public.yt_comments      enable row level security;

create policy "Owners can read" on public.yt_video_changes for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read" on public.yt_comments      for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can read tests" on public.yt_tests for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add tests"  on public.yt_tests for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit tests" on public.yt_tests for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
create policy "Owners can read goals" on public.yt_goals for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add goals"  on public.yt_goals for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit goals" on public.yt_goals for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));

revoke all on table public.yt_video_changes, public.yt_tests, public.yt_goals, public.yt_comments from anon, authenticated;
grant select on table public.yt_video_changes, public.yt_comments to authenticated;
grant select, insert, update on table public.yt_tests, public.yt_goals to authenticated;

-- Small owner actions that touch tables the browser cannot write directly.
create or replace function public.yt_set_video_topic(p_video_id text, p_topic text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.yt_is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.yt_videos
     set topic = nullif(btrim(p_topic), ''), topic_source = case when nullif(btrim(p_topic), '') is null then null else 'manual' end
   where id = p_video_id;
end;
$$;

create or replace function public.yt_mark_comment(p_comment_id text, p_pinned boolean, p_hidden boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.yt_is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.yt_comments
     set pinned = coalesce(p_pinned, pinned), hidden = coalesce(p_hidden, hidden)
   where id = p_comment_id;
end;
$$;

revoke all on function public.yt_set_video_topic(text, text), public.yt_mark_comment(text, boolean, boolean) from public, anon;
grant execute on function public.yt_set_video_topic(text, text), public.yt_mark_comment(text, boolean, boolean) to authenticated;

-- What is switched on, for the Settings screen.
create or replace function public.yt_connection()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'google_configured', coalesce(bool_or(key = 'google_client_id' and value <> ''), false)
                     and coalesce(bool_or(key = 'google_client_secret' and value <> ''), false),
    'google_client_id', max(value) filter (where key = 'google_client_id'),
    'youtube_connected', coalesce(bool_or(key = 'google_refresh_token' and value <> ''), false),
    'connected_at', max(value) filter (where key = 'google_connected_at'),
    'connection_error', nullif(max(value) filter (where key = 'google_error'), ''),
    'owner_channel_id', max(value) filter (where key = 'owner_channel_id'),
    'earnings', coalesce(bool_or(key = 'google_scopes' and value like '%yt-analytics-monetary.readonly%'), false),
    'comments', coalesce(bool_or(key = 'google_scopes' and value like '%youtube.force-ssl%'), false),
    'ai', coalesce(bool_or(key = 'anthropic_api_key' and value <> ''), false),
    'ai_error', nullif(max(value) filter (where key = 'ai_error'), '')
  ) into result
  from public.yt_private;
  return result;
end;
$$;

-- The view gains the topic and what feeds each video.
create or replace view public.yt_v_videos
with (security_invoker = true) as
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
  case when t.total > 0 then round(100 * t.search / t.total) end as search_pct,
  case when t.total > 0 then round(100 * t.recommended / t.total) end as recommended_pct,
  case when t.total is null or t.total < 50 then null
       when t.search / t.total >= 0.4 then 'search'
       when t.recommended / t.total >= 0.5 then 'recommended'
       else 'mixed' end as discovery,
  'https://www.youtube.com/' || case when v.content_type = 'short' then 'shorts/' else 'watch?v=' end || v.id as url,
  v.thumbnail_url,
  v.tags,
  v.traffic,
  v.stats_updated_at,
  round(v.estimated_revenue, 2) as estimated_revenue,
  case when v.views > 0 and v.estimated_revenue is not null
       then round(1000 * v.estimated_revenue / v.views, 2) end as revenue_per_1000_views,
  v.topic,
  v.feeders
from public.yt_videos v
left join lateral (
  select (percentile_cont(0.5) within group (order by prev.views))::numeric as median_views
  from (
    select x.views
    from public.yt_videos x
    where x.content_type is not distinct from v.content_type
      and x.privacy = 'public'
      and x.removed_at is null
      and x.published_at < v.published_at
      and x.views is not null
    order by x.published_at desc
    limit 20
  ) prev
) m on true
left join lateral (
  select (v.traffic ->> 'total')::numeric as total,
         coalesce((v.traffic ->> 'search')::numeric, 0) as search,
         coalesce((v.traffic ->> 'suggested')::numeric, 0)
           + coalesce((v.traffic ->> 'browse')::numeric, 0)
           + coalesce((v.traffic ->> 'shorts_feed')::numeric, 0) as recommended
) t on true
where v.removed_at is null;
