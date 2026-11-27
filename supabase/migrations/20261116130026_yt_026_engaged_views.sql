-- YouTube Dashboard (yt_*) 26: engaged views on each upload.
--
-- Since 2026-08-27 YouTube counts a view from the first frame, so a video's view count includes people
-- who scrolled straight past. YouTube Studio's engaged views leave them out. The sync already keeps each
-- upload's lifetime engaged views in yt_videos.engaged_views; this adds them to yt_v_videos, so the
-- video's details can show them next to its views.
--
-- The view is the one from 008, unchanged, with engaged_views added at the end (the live definition was
-- read first and matches 008). Nothing is removed.

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
  v.feeders,
  v.engaged_views
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
  'One row per upload with derived numbers: watch_hours, views_per_day, engagement_pct ((likes + comments) / views), typical_views (median views of the 20 previous public uploads in the same format), vs_typical (views / typical_views, so 2.0 = twice the usual; this is my own outlier score), search_pct and recommended_pct (share of views from YouTube search vs. home, suggested and the Shorts feed), discovery (search | recommended | mixed), estimated_revenue (US dollars, YouTube''s estimate), revenue_per_1000_views, and engaged_views (lifetime engaged views from YouTube Studio, a day or two behind: views without the people who scrolled past in the first moment; since 2026-08-27 views count from the first frame, so compare engaged_views across that date).';
