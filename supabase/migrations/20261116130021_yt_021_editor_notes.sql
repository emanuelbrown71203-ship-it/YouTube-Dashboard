-- YouTube Dashboard (yt_*) 21: notes for the editor, from Premiere markers.
--
-- The owner drops markers with comments on their cut in Premiere Pro and exports them. The app reads
-- that export and keeps it with the video idea it belongs to, so it can hand the editor a clean list:
-- where each marker is, and what the owner wants done there. Read only by owners.

create table if not exists public.yt_editor_notes (
  id          uuid primary key default gen_random_uuid(),
  idea_id     uuid not null references public.yt_ideas (id),
  name        text not null check (length(btrim(name)) > 0),
  file_name   text,
  markers     jsonb not null default '[]'::jsonb check (jsonb_typeof(markers) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_editor_notes is
  'Notes for the owner''s editor, read from markers exported from Premiere Pro, kept with the video idea they belong to. name = which cut they are for ("Rough cut 1"), file_name = the exported file. markers = an array of {at, end, name, note, type}: at and end are timecodes (end null for a single point), name and note are what the owner typed on the marker, type is Premiere''s marker type (Comment, Chapter...). trashed_at set = in the bin.';
create index if not exists yt_editor_notes_idea_idx on public.yt_editor_notes (idea_id, created_at desc) where trashed_at is null;
create trigger yt_editor_notes_touch before update on public.yt_editor_notes
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_editor_notes enable row level security;
create policy "Owners can read editor notes" on public.yt_editor_notes for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add editor notes"  on public.yt_editor_notes for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit editor notes" on public.yt_editor_notes for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_editor_notes from anon, authenticated;
grant select, insert, update on table public.yt_editor_notes to authenticated;
