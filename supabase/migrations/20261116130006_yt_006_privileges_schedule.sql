-- YouTube Dashboard (yt_*) 6/6: least-privilege grants, config rows and the sync schedule.
-- Row level security already keeps strangers out; this narrows the table and
-- function grants to exactly what the app uses.

-- Signed-out visitors get nothing. Signed-in browsers get read access to
-- stats and research (still filtered to owners by row level security) and can
-- add and edit ideas.
revoke all on table
  public.yt_owners, public.yt_private, public.yt_oauth_states, public.yt_access_codes,
  public.yt_channel, public.yt_channel_daily, public.yt_analytics_daily, public.yt_content_type_daily,
  public.yt_videos, public.yt_video_daily, public.yt_video_analytics_daily, public.yt_reports,
  public.yt_sync_runs, public.yt_ideas,
  public.yt_research_channels, public.yt_research_channel_daily, public.yt_research_videos,
  public.yt_research_runs, public.yt_keywords, public.yt_quota_usage,
  public.yt_v_videos, public.yt_v_ideas, public.yt_v_my_formats
from anon, authenticated;

grant select on table
  public.yt_owners,
  public.yt_channel, public.yt_channel_daily, public.yt_analytics_daily, public.yt_content_type_daily,
  public.yt_videos, public.yt_video_daily, public.yt_video_analytics_daily, public.yt_reports,
  public.yt_sync_runs,
  public.yt_research_channels, public.yt_research_channel_daily, public.yt_research_videos,
  public.yt_research_runs, public.yt_keywords, public.yt_quota_usage,
  public.yt_v_videos, public.yt_v_ideas, public.yt_v_my_formats
to authenticated;

grant select, insert, update on table public.yt_ideas to authenticated;

revoke all on function
  public.yt_touch_updated_at(), public.yt_is_owner(), public.yt_whoami(), public.yt_public_status(),
  public.yt_connection(), public.yt_create_access_code(text, interval),
  public.yt_redeem_access_code(text, text), public.yt_sign_out(boolean),
  public.yt_set_video_type(text, text), public.yt_save_research_video(text, boolean, text),
  public.yt_save_keyword(text, boolean), public.yt_watch_channel(text, boolean),
  public.yt_quota_day(), public.yt_quota_add(integer, integer), public.yt_claude_context()
from public, anon, authenticated;

grant execute on function
  public.yt_is_owner(), public.yt_whoami(), public.yt_public_status(), public.yt_connection(),
  public.yt_create_access_code(text, interval), public.yt_redeem_access_code(text, text),
  public.yt_sign_out(boolean), public.yt_set_video_type(text, text),
  public.yt_save_research_video(text, boolean, text), public.yt_save_keyword(text, boolean),
  public.yt_watch_channel(text, boolean), public.yt_quota_day(), public.yt_claude_context()
to authenticated;

grant execute on function
  public.yt_is_owner(), public.yt_create_access_code(text, interval), public.yt_quota_day(),
  public.yt_quota_add(integer, integer), public.yt_claude_context()
to service_role;

-- Config. The cron secret is generated here and never leaves the database.
insert into public.yt_private (key, value) values
  ('owner_channel_id', 'UChsuiSVwIF3O23DdjL907jg'),
  ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('allowed_origins', '["http://localhost:5173","http://localhost:4173"]')
on conflict (key) do nothing;

-- Sync from YouTube every 6 hours. Does nothing until YouTube is connected.
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
