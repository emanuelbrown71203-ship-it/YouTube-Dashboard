-- YouTube Dashboard (yt_*) 12: a game for every idea, and lines worth remembering.

-- Ideas sit under a game or topic, the same names the videos use, so the board can be grouped by it.
alter table public.yt_ideas add column if not exists topic text;
comment on column public.yt_ideas.topic is
  'The game or topic this idea sits under ("Elden Ring"), chosen by the owner; the same names as yt_videos.topic. Null = not filed yet.';
create index if not exists yt_ideas_topic_idx on public.yt_ideas (topic) where trashed_at is null;

create or replace view public.yt_v_ideas
with (security_invoker = true) as
select
  i.id, i.format, i.status, i.discovery, i.priority, i.title, i.target_keyword, i.hook, i.concept,
  i.title_options, i.thumbnail_concept, i.target_length_s, i.target_date, i.tags, i.archived, i.source,
  i.inspiration_url, i.inspiration_video_id, r.title as inspiration_title, r.outlier_score as inspiration_outlier_score,
  i.parent_id, p.title as parent_title,
  i.video_id, v.title as video_title, v.views as video_views,
  i.created_at, i.updated_at,
  i.topic
from public.yt_ideas i
left join public.yt_ideas p on p.id = i.parent_id
left join public.yt_videos v on v.id = i.video_id
left join public.yt_research_videos r on r.id = i.inspiration_video_id
where i.trashed_at is null;
comment on view public.yt_v_ideas is
  'Ideas that are not in the bin, with the idea they were cut from, the research video that inspired them and the upload they became. topic = the game the idea sits under.';

-- Lines the owner heard or read and wants to keep in front of them.
create table public.yt_notes (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (length(btrim(text)) > 0),
  source      text,
  source_url  text,
  topic       text,
  on_front    boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_notes is
  'Lines worth remembering: something the owner heard in a podcast or a video, or thought of, and wants to keep seeing. text = the line. source = where it came from ("Colin and Samir podcast"), source_url = a link to it. topic = an optional game or subject. on_front = shown on the front page. trashed_at set = in the bin.';
create index yt_notes_recent_idx on public.yt_notes (created_at desc) where trashed_at is null;
create trigger yt_notes_touch before update on public.yt_notes
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_notes enable row level security;
create policy "Owners can read notes" on public.yt_notes for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add notes"  on public.yt_notes for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit notes" on public.yt_notes for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_notes from anon, authenticated;
grant select, insert, update on table public.yt_notes to authenticated;
