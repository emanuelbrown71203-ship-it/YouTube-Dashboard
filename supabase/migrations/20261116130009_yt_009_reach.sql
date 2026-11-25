-- YouTube Dashboard (yt_*) 9: impressions and click-through rate.
--
-- YouTube only publishes these through its daily bulk "reach" report, which the
-- sync asks for once the YouTube Reporting API is switched on in Google Cloud.

create table public.yt_video_reach_daily (
  video_id    text not null,
  date        date not null,
  impressions bigint not null default 0,
  ctr         numeric,
  primary key (video_id, date)
);
comment on table public.yt_video_reach_daily is
  'Per video and day: how many times the thumbnail was shown (impressions) and the share of those that were clicked, in percent (ctr). From YouTube''s bulk reach report, which arrives a day or two behind. Empty until the YouTube Reporting API is switched on.';
create index yt_video_reach_daily_date_idx on public.yt_video_reach_daily (date);

alter table public.yt_video_reach_daily enable row level security;
create policy "Owners can read" on public.yt_video_reach_daily for select to authenticated using ((select public.yt_is_owner()));
revoke all on table public.yt_video_reach_daily from anon, authenticated;
grant select on table public.yt_video_reach_daily to authenticated;

create or replace view public.yt_v_video_reach
with (security_invoker = true) as
select
  r.video_id,
  sum(r.impressions) as impressions_28d,
  case when sum(r.impressions) > 0
       then round(sum(r.impressions * r.ctr) / sum(r.impressions), 2) end as ctr_28d,
  max(r.date) as last_day
from public.yt_video_reach_daily r
where r.date > (select max(date) from public.yt_video_reach_daily) - 28
group by r.video_id;
comment on view public.yt_v_video_reach is
  'Per video: impressions and click-through rate (percent, weighted by impressions) over the newest 28 days of reach data.';
revoke all on table public.yt_v_video_reach from anon, authenticated;
grant select on table public.yt_v_video_reach to authenticated;
