-- YouTube Dashboard (yt_*) 11: the first 48 hours of an upload.
--
-- YouTube's analytics arrive two to three days late and only by the day, so they
-- cannot show how a new upload is doing right now. The public view count is live,
-- so an hourly "pulse" writes it down for every upload in its first days.

create table public.yt_video_pulse (
  video_id    text not null,
  captured_at timestamptz not null default now(),
  views       bigint not null,
  likes       bigint,
  comments    bigint,
  primary key (video_id, captured_at)
);
comment on table public.yt_video_pulse is
  'The live public view count of each upload, written down about once an hour during its first 3 days (and at every sync). Hours since publishing = captured_at - yt_videos.published_at. Used to compare a new upload with earlier uploads of the same format at the same age. Only exists for uploads published after 2026-11-17.';

alter table public.yt_video_pulse enable row level security;
create policy "Owners can read" on public.yt_video_pulse for select to authenticated using ((select public.yt_is_owner()));
revoke all on table public.yt_video_pulse from anon, authenticated;
grant select on table public.yt_video_pulse to authenticated;

-- Older uploads have no pulse, so their first days come from the daily analytics instead.
-- This marks which ones have been asked for, so none is asked for twice.
alter table public.yt_videos add column if not exists first_days_at timestamptz;
comment on column public.yt_videos.first_days_at is
  'When the sync fetched this upload''s first days from YouTube Analytics into yt_video_analytics_daily (the baseline for the first 48 hours tracker). Null = not fetched yet.';

-- Every hour: look for a new upload and note the view count of recent ones.
-- Costs two of the day''s 10,000 lookups each time. Does nothing until YouTube is connected.
select cron.schedule(
  'yt-pulse',
  '41 * * * *',
  $cron$
  select net.http_post(
    url := 'https://nivsnjvrsqekyocvtema.supabase.co/functions/v1/yt-api/sync/pulse',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.yt_private where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
