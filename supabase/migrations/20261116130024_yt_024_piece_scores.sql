-- YouTube Dashboard (yt_*) 24: two-way scores for an idea's titles, intro, script and thumbnails.
--
-- Each piece of a video gets two scores, the way an idea does: "Your history" (the owner's own
-- templates and how their past titles, thumbnails and scripts did) and "Recommended" (what is working
-- on YouTube now: the videos that broke out on the same idea and on their games). The AI reads words
-- and pictures, never video. Readings are written by the server; owners can read them.
--
-- The owner's own thumbnails (several versions per idea, to compare) live in their own table, framed
-- to a thumbnail in the browser like the reference screenshots. A past script can be tied to the video
-- it was for, so its numbers count when the owner's track record is read.

alter table public.yt_ideas add column if not exists title_check jsonb;
alter table public.yt_ideas add column if not exists script_check jsonb;
comment on column public.yt_ideas.title_check is
  'Two-way scores of the idea''s title and its other titles: {checked_at, key, titles: [{title, emotions[], yours: {score, parts[]}, recommended: {score, parts[]}, note}], missing[], better[], to_try: [{line}]}. key = textKey of the titles scored. Parts: {key, label, max, score 0-100, note}. Null = not scored.';
comment on column public.yt_ideas.script_check is
  'Two-way scores of the idea''s script (hook, what happens and outline together): {checked_at, key, yours: {score, parts[]}, recommended: {score, parts[]}, missing[], better[], to_try: [{instead_of, line}]}. key = textKey of the script scored. Null = not scored.';

alter table public.yt_scripts add column if not exists video_id text;
comment on column public.yt_scripts.video_id is
  'The upload this script was for (yt_videos.id), chosen by the owner, so how that video did counts when their past scripts and intros are read. Null = not tied to a video (an outline for one not made yet).';

create table if not exists public.yt_idea_thumbs (
  id          uuid primary key default gen_random_uuid(),
  idea_id     uuid not null references public.yt_ideas (id),
  name        text,
  image       text not null check (image like 'data:image/jpeg;base64,%' and length(image) <= 900000),
  image_small text not null check (image_small like 'data:image/jpeg;base64,%' and length(image_small) <= 120000),
  score       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_idea_thumbs is
  'The owner''s own thumbnails for a video idea, one row per version, to score and compare. image = the thumbnail as a JPEG (framed 16:9 in the browser by src/lib/pictures.ts), image_small = the same for lists. score = the AI''s two-way reading: {checked_at, yours: {score, parts[]}, recommended: {score, parts[]}, missing[], better[], to_try: [{line}]}, written by the server. Lists never select the two image columns. trashed_at set = in the bin.';
create index if not exists yt_idea_thumbs_idea_idx on public.yt_idea_thumbs (idea_id, created_at) where trashed_at is null;
create trigger yt_idea_thumbs_touch before update on public.yt_idea_thumbs
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_idea_thumbs enable row level security;
create policy "Owners can read idea thumbnails" on public.yt_idea_thumbs for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add idea thumbnails"  on public.yt_idea_thumbs for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit idea thumbnails" on public.yt_idea_thumbs for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_idea_thumbs from anon, authenticated;
grant select, insert, update on table public.yt_idea_thumbs to authenticated;
