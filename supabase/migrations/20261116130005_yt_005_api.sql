-- YouTube Dashboard (yt_*) 5/6: what the app and Claude call (functions and views).
-- Every security definer function checks the caller itself, so it stays safe
-- whatever the table grants are.

-- ---------------------------------------------------------------------
-- Signing in and out
-- ---------------------------------------------------------------------

-- Who am I? Also records that this browser was seen.
create or replace function public.yt_whoami()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.yt_owners;
begin
  update public.yt_owners set last_seen_at = now()
   where user_id = (select auth.uid()) and revoked_at is null
  returning * into me;
  if me.user_id is null then
    return jsonb_build_object('owner', false);
  end if;
  return jsonb_build_object('owner', true, 'method', me.method, 'since', me.created_at);
end;
$$;

-- What the sign-in screen needs (two yes/no facts, safe to show any visitor).
create or replace function public.yt_public_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'google_configured',
      exists (select 1 from public.yt_private where key = 'google_client_id' and value <> '')
      and exists (select 1 from public.yt_private where key = 'google_client_secret' and value <> ''),
    'youtube_connected',
      exists (select 1 from public.yt_private where key = 'google_refresh_token' and value <> '')
  );
$$;

-- Connection details for the settings screen (owners only, never any secret).
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
    'owner_channel_id', max(value) filter (where key = 'owner_channel_id')
  ) into result
  from public.yt_private;
  return result;
end;
$$;

-- One-time access codes. Run from the SQL editor or by Claude (no web session),
-- or by a signed-in owner who wants to let another browser in.
create or replace function public.yt_create_access_code(p_note text default null, p_ttl interval default interval '24 hours')
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw      bytea := extensions.gen_random_bytes(10);
  code     text := '';
  caller   uuid := (select auth.uid());
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if caller is null then
    if jwt_role not in ('', 'service_role') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for i in 0..9 loop
    code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  end loop;

  insert into public.yt_access_codes (code_hash, note, expires_at)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), left(p_note, 200),
          now() + least(coalesce(p_ttl, interval '24 hours'), interval '7 days'));

  return substr(code, 1, 5) || '-' || substr(code, 6, 5);
end;
$$;

create or replace function public.yt_redeem_access_code(p_code text, p_device text default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  caller     uuid := (select auth.uid());
  normalized text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  hit        text;
begin
  if caller is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  update public.yt_access_codes
     set used_at = now(), used_by = caller
   where code_hash = encode(extensions.digest(normalized, 'sha256'), 'hex')
     and used_at is null
     and expires_at > now()
  returning code_hash into hit;

  if hit is null then
    perform pg_sleep(1); -- slows guessing down
    return false;
  end if;

  insert into public.yt_owners (user_id, method, device)
  values (caller, 'access_code', left(p_device, 160))
  on conflict (user_id) do update
    set revoked_at = null, method = 'access_code', device = excluded.device, last_seen_at = now();
  return true;
end;
$$;

create or replace function public.yt_sign_out(p_everywhere boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.yt_is_owner() then
    return;
  end if;
  update public.yt_owners
     set revoked_at = now()
   where revoked_at is null
     and (p_everywhere or user_id = (select auth.uid()));
end;
$$;

-- ---------------------------------------------------------------------
-- Small edits owners make from the app
-- ---------------------------------------------------------------------

-- Fix a video's format by hand (sync never overwrites a manual choice).
create or replace function public.yt_set_video_type(p_video_id text, p_type text)
returns void language plpgsql volatile security definer set search_path = '' as $$
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

create or replace function public.yt_save_research_video(p_video_id text, p_saved boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.yt_research_videos
     set saved = p_saved,
         saved_at = case when p_saved then coalesce(saved_at, now()) end,
         note = coalesce(p_note, note)
   where id = p_video_id;
end;
$$;

create or replace function public.yt_save_keyword(p_keyword text, p_saved boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.yt_keywords
     set saved = p_saved,
         saved_at = case when p_saved then coalesce(saved_at, now()) end
   where keyword = lower(btrim(p_keyword));
end;
$$;

create or replace function public.yt_watch_channel(p_channel_id text, p_watched boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.yt_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.yt_research_channels
     set watched = p_watched,
         watched_at = case when p_watched then coalesce(watched_at, now()) end
   where id = p_channel_id;
end;
$$;

-- ---------------------------------------------------------------------
-- YouTube API budget (edge functions only)
-- ---------------------------------------------------------------------
create or replace function public.yt_quota_day()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

create or replace function public.yt_quota_add(p_units integer, p_calls integer default 1)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
  total    integer;
begin
  if jwt_role <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.yt_quota_usage as q (day, units, calls)
  values (public.yt_quota_day(), greatest(p_units, 0), greatest(p_calls, 0))
  on conflict (day) do update
    set units = q.units + excluded.units, calls = q.calls + excluded.calls, updated_at = now()
  returning q.units into total;
  return total;
end;
$$;

-- ---------------------------------------------------------------------
-- Views for analysis (security_invoker: the reader's own access applies)
-- ---------------------------------------------------------------------
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
  v.stats_updated_at
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
comment on view public.yt_v_videos is
  'One row per upload with derived numbers: watch_hours, views_per_day, engagement_pct ((likes + comments) / views), typical_views (median views of the 20 previous public uploads in the same format), vs_typical (views / typical_views, so 2.0 = twice the usual; this is my own outlier score), search_pct and recommended_pct (share of views from YouTube search vs. home, suggested and the Shorts feed) and discovery (search | recommended | mixed).';

create or replace view public.yt_v_ideas
with (security_invoker = true) as
select
  i.id, i.format, i.status, i.discovery, i.priority, i.title, i.target_keyword, i.hook, i.concept,
  i.title_options, i.thumbnail_concept, i.target_length_s, i.target_date, i.tags, i.archived, i.source,
  i.inspiration_url, i.inspiration_video_id, r.title as inspiration_title, r.outlier_score as inspiration_outlier_score,
  i.parent_id, p.title as parent_title,
  i.video_id, v.title as video_title, v.views as video_views,
  i.created_at, i.updated_at
from public.yt_ideas i
left join public.yt_ideas p on p.id = i.parent_id
left join public.yt_videos v on v.id = i.video_id
left join public.yt_research_videos r on r.id = i.inspiration_video_id
where i.trashed_at is null;
comment on view public.yt_v_ideas is
  'Ideas that are not in the bin, with the idea they were cut from, the research video that inspired them and the upload they became.';

create or replace view public.yt_v_my_formats
with (security_invoker = true) as
select
  f.content_type,
  count(*) as public_videos,
  count(*) filter (where v.published_at > now() - interval '30 days') as uploads_30d,
  count(*) filter (where v.published_at > now() - interval '90 days') as uploads_90d,
  max(v.published_at) as last_upload_at,
  (select round((percentile_cont(0.5) within group (order by r.views))::numeric)
     from (select x.views
             from public.yt_videos x
            where x.content_type = f.content_type and x.privacy = 'public'
              and x.removed_at is null and x.views is not null
            order by x.published_at desc
            limit 30) r) as typical_views
from (select distinct content_type from public.yt_videos where content_type is not null) f
join public.yt_videos v
  on v.content_type = f.content_type and v.privacy = 'public' and v.removed_at is null
group by f.content_type;
comment on view public.yt_v_my_formats is
  'My channel per format (short | long | live): public uploads, uploads in the last 30 and 90 days, last upload, and typical_views (median views of the last 30). Same method as yt_research_channels.typical_long / typical_short, so the two compare directly.';

-- ---------------------------------------------------------------------
-- One-call briefing for Claude:  select public.yt_claude_context();
-- ---------------------------------------------------------------------
create or replace function public.yt_claude_context()
returns jsonb language sql stable set search_path = '' as $$
with
ch as (select * from public.yt_channel order by updated_at desc limit 1),
bounds as (select max(date) as d from public.yt_analytics_daily),
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
recent as (
  select id, title, content_type, published_at::date as published, views, likes, comments,
         views_per_day, vs_typical, discovery
  from public.yt_v_videos
  where privacy = 'public'
  order by published_at desc nulls last
  limit 10
),
top_all as (
  select id, title, content_type, published_at::date as published, views, likes, watch_hours,
         subs_gained, discovery
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
  from public.yt_v_ideas
),
next_up as (
  select id, format, status, discovery, priority, title, target_keyword, hook, target_date
  from public.yt_v_ideas
  where not archived and status <> 'published'
  order by priority, target_date nulls last, created_at
  limit 10
),
watched as (
  select id, title, handle, subscribers, typical_long, typical_short, uploads_30d_long, uploads_30d_short
  from public.yt_research_channels
  where watched
  order by subscribers desc nulls last
  limit 25
),
kw as (
  select keyword, overall_score, volume_score, competition_score, my_rank, analyzed_at::date as analyzed
  from public.yt_keywords
  where saved
  order by overall_score desc nulls last
  limit 25
),
swipe as (
  select id, title, channel_title, format, views, outlier_score, published_at::date as published
  from public.yt_research_videos
  where saved
  order by saved_at desc
  limit 25
),
runs as (
  select kind, query, created_at, jsonb_array_length(results) as results
  from public.yt_research_runs
  order by created_at desc
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
  'my_formats', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.yt_v_my_formats f),
  'recent_uploads', (select coalesce(jsonb_agg(to_jsonb(recent) order by recent.published desc), '[]'::jsonb) from recent),
  'top_videos_all_time', (select coalesce(jsonb_agg(to_jsonb(top_all) order by top_all.views desc), '[]'::jsonb) from top_all),
  'reports', (select coalesce(jsonb_object_agg(key, jsonb_build_object('from', period_start, 'to', period_end, 'rows', data)), '{}'::jsonb) from public.yt_reports),
  'ideas', (select to_jsonb(ideas) from ideas),
  'next_up_ideas', (select coalesce(jsonb_agg(to_jsonb(next_up)), '[]'::jsonb) from next_up),
  'research', jsonb_build_object(
    'channels_i_watch', (select coalesce(jsonb_agg(to_jsonb(watched)), '[]'::jsonb) from watched),
    'saved_keywords', (select coalesce(jsonb_agg(to_jsonb(kw)), '[]'::jsonb) from kw),
    'saved_outlier_videos', (select coalesce(jsonb_agg(to_jsonb(swipe)), '[]'::jsonb) from swipe),
    'recent_runs', (select coalesce(jsonb_agg(to_jsonb(runs)), '[]'::jsonb) from runs)
  ),
  'last_sync', (select to_jsonb(last_sync) from last_sync),
  'notes', jsonb_build_array(
    'Analytics lag YouTube by 2-3 days; last_28_days ends at the latest day with data.',
    'Since 2026-08-27 YouTube counts a view from the first frame (views ~1.7-1.9x higher on long-form). Use engaged_views to compare across that date.',
    'Formats: short = Shorts, long = regular uploads, live = live streams and their replays.',
    'vs_typical / outlier_score = views divided by the median views of that channel''s recent uploads in the same format.',
    'Keyword scores are 0-100 estimates from the top search results, not real search volumes.',
    'For anything not in this briefing, query the yt_ tables and views directly; every table has a comment explaining it.'
  )
);
$$;
comment on function public.yt_claude_context() is
  'Everything Claude needs to answer questions about the channel, the ideas and the research in one JSON document. Run: select public.yt_claude_context();';
