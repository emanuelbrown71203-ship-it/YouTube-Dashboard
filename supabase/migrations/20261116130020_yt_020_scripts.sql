-- YouTube Dashboard (yt_*) 20: the owner's own scripts.
--
-- Scripts the owner has written for past videos (their intros, the beats they hand their editor, the
-- voiceover they write against the cut). They are kept so the script starter can write the way the
-- owner writes: their voice, their habits, their directions for the editor. Read only by owners.

create table if not exists public.yt_scripts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) > 0),
  body        text not null check (length(btrim(body)) > 0),
  topic       text,
  source_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_scripts is
  'Scripts the owner wrote for past videos: intros written in full, the beats they hand their editor (with directions in brackets), and voiceover written against the cut. title = what it was for, topic = the game (spelled like yt_videos.topic), body = the script as plain text ("- " lines are bullets), source_url = where the original lives. The script starter reads the closest ones to write in the owner''s voice. trashed_at set = in the bin.';
create index if not exists yt_scripts_recent_idx on public.yt_scripts (created_at desc) where trashed_at is null;
create trigger yt_scripts_touch before update on public.yt_scripts
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_scripts enable row level security;
create policy "Owners can read scripts" on public.yt_scripts for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add scripts"  on public.yt_scripts for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit scripts" on public.yt_scripts for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_scripts from anon, authenticated;
grant select, insert, update on table public.yt_scripts to authenticated;
