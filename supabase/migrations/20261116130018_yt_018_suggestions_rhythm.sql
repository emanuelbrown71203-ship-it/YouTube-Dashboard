-- YouTube Dashboard (yt_*) 18: suggested ideas, and an upload rhythm.
--
-- Suggested ideas are written by the dashboard (a weekly batch, a batch on request, and follow-ups
-- to an upload that beat the usual). They are ideas like any other, so they get the same check
-- against YouTube and the same scores, but they wait in the Suggested tab until the owner keeps one:
-- only then does it join the board. "Not for me" bins it (trashed_at) and the next batch learns from it.
--
-- The upload rhythm is a target the owner sets per format (long, short, live: never across them):
-- "a long video every 14 days". Home shows how long it has been against it. No target, no card.

alter table public.yt_ideas
  add column if not exists in_suggested boolean not null default false,
  add column if not exists suggested_at timestamptz,
  add column if not exists suggestion jsonb;

comment on column public.yt_ideas.in_suggested is
  'True while a suggested idea waits in the Suggested tab: it is not on the board and not one of the owner''s ideas yet. Keeping it sets this to false. A suggestion the owner turned down has trashed_at set and stays true.';
comment on column public.yt_ideas.suggested_at is
  'When the dashboard suggested this idea. Null = the owner''s own idea (or one added by Claude or from research).';
comment on column public.yt_ideas.suggestion is
  'Why the dashboard suggested it: kind (follow_up | your_format | breakout | other_games | short_hint | comment), why (one plain sentence), follow_up_of (the upload it follows up), basis (the videos it rests on: video_id, title, views, times_usual, own), batch (when the batch was made). expired = true when it was retired unread after three weeks.';

create index if not exists yt_ideas_suggested_idx on public.yt_ideas (suggested_at desc) where in_suggested and trashed_at is null;

comment on table public.yt_ideas is
  'Video ideas and where each one is in production. format: long | short. status: idea > scripting > filming > editing > scheduled > published. discovery: recommended (made for the home feed, suggested and the Shorts feed) | search (made to rank for target_keyword). priority 1 = high, 3 = low. parent_id links a Short cut from a long-form idea. video_id = the upload it became. inspiration_video_id = a video saved from research (yt_research_videos). source: dashboard | claude | research | suggested. in_suggested = a suggestion still waiting in the Suggested tab (not on the board). A row with trashed_at set is in the bin: hide it.';

-- The board leaves suggestions that are still waiting out; everything that reads the ideas through
-- this view (the briefing among them) sees only the owner's ideas.
create or replace view public.yt_v_ideas
with (security_invoker = true) as
select
  i.id, i.format, i.status, i.discovery, i.priority, i.title, i.target_keyword, i.hook, i.concept,
  i.title_options, i.thumbnail_concept, i.target_length_s, i.target_date, i.tags, i.archived, i.source,
  i.inspiration_url, i.inspiration_video_id, r.title as inspiration_title, r.outlier_score as inspiration_outlier_score,
  i.parent_id, p.title as parent_title,
  i.video_id, v.title as video_title, v.views as video_views,
  i.created_at, i.updated_at,
  i.topic,
  i.picked_at,
  i.suggested_at
from public.yt_ideas i
left join public.yt_ideas p on p.id = i.parent_id
left join public.yt_videos v on v.id = i.video_id
left join public.yt_research_videos r on r.id = i.inspiration_video_id
where i.trashed_at is null and not i.in_suggested;
comment on view public.yt_v_ideas is
  'The owner''s ideas that are not in the bin (suggestions still waiting in the Suggested tab are left out), with the idea they were cut from, the research video that inspired them and the upload they became. topic = the game the idea sits under. picked_at set = the owner decided to make it (it is on the production board); null = still just an idea. suggested_at set = it began as a suggestion the owner kept.';

create table if not exists public.yt_rhythm (
  format     text primary key check (format in ('long', 'short', 'live')),
  every_days integer not null check (every_days between 1 and 90),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.yt_rhythm is
  'The owner''s upload rhythm, one target per format and never across them: post a format at least every every_days days. active = false switches a target off. Home shows the days since the last public upload of that format against it.';

create trigger yt_rhythm_touch before update on public.yt_rhythm
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_rhythm enable row level security;
create policy "Owners can read the rhythm" on public.yt_rhythm for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can set the rhythm" on public.yt_rhythm for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can change the rhythm" on public.yt_rhythm for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_rhythm from anon, authenticated;
grant select, insert, update on table public.yt_rhythm to authenticated;

-- The app learns when the last batch of suggestions was written (to say when the next is due) and
-- whether one is being written right now. Nothing secret: both are dates.
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
    'ai_error', nullif(max(value) filter (where key = 'ai_error'), ''),
    'suggest_batch_at', nullif(max(value) filter (where key = 'suggest_batch_at'), ''),
    'suggest_running_at', nullif(max(value) filter (where key = 'suggest_running_at'), '')
  ) into result
  from public.yt_private;
  return result;
end;
$$;
