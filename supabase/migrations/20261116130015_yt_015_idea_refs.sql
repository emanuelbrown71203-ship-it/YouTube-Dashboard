-- YouTube Dashboard (yt_*) 15: thumbnail references kept with an idea.
--
-- Other people's thumbnails the owner wants in front of them while making their own: picked from
-- the thumbnail references in Research, from the videos an idea's check found, or a pasted link.
-- What the video was is copied in, so the reference stays readable whatever happens to it later.

create table public.yt_idea_refs (
  id                  uuid primary key default gen_random_uuid(),
  idea_id             uuid not null references public.yt_ideas (id),
  video_id            text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title               text,
  channel_title       text,
  channel_subscribers bigint,
  views               bigint,
  outlier_score       numeric,
  published_at        timestamptz,
  note                text,
  created_at          timestamptz not null default now(),
  trashed_at          timestamptz
);
comment on table public.yt_idea_refs is
  'Thumbnail references for an idea: other people''s videos whose thumbnail the owner wants to use as a reference or a starting place. The picture is https://i.ytimg.com/vi/<video_id>/mqdefault.jpg (hq720.jpg or maxresdefault.jpg for a large one). title, channel_title, channel_subscribers, views and outlier_score (views against that channel''s usual) are copied in when it is added. note = what the owner wants to take from it. trashed_at set = removed from the idea.';
create unique index yt_idea_refs_once on public.yt_idea_refs (idea_id, video_id) where trashed_at is null;
create index yt_idea_refs_idea on public.yt_idea_refs (idea_id) where trashed_at is null;

alter table public.yt_idea_refs enable row level security;
create policy "Owners can read references" on public.yt_idea_refs for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add references"  on public.yt_idea_refs for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit references" on public.yt_idea_refs for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_idea_refs from anon, authenticated;
grant select, insert, update on table public.yt_idea_refs to authenticated;

-- The thumbnail page lists recent videos that beat their channel's usual.
create index if not exists yt_research_videos_recent_idx on public.yt_research_videos (published_at desc) where outlier_score >= 2;
