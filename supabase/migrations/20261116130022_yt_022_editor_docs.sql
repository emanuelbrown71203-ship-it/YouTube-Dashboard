-- YouTube Dashboard (yt_*) 22: notes for the editor as a Google Doc.
--
-- Each video idea with notes for the editor gets one Google Doc in the owner's Drive, with every cut in
-- order. Sending again updates the same doc, so the editor keeps one link per video. The dashboard only
-- ever touches docs it made itself (Google's drive.file permission, optional, asked for at sign-in).

create table if not exists public.yt_editor_docs (
  idea_id     uuid primary key references public.yt_ideas (id),
  doc_id      text not null check (length(btrim(doc_id)) > 0),
  doc_url     text not null check (doc_url like 'https://%'),
  pushed_at   timestamptz not null default now()
);
comment on table public.yt_editor_docs is
  'The Google Doc that holds a video idea''s notes for the editor (every cut in yt_editor_notes, in order). doc_id = the Drive file, doc_url = its link, pushed_at = when it was last written. Written only by the server; owners can read it.';

alter table public.yt_editor_docs enable row level security;
create policy "Owners can read editor docs" on public.yt_editor_docs for select to authenticated using ((select public.yt_is_owner()));
revoke all on table public.yt_editor_docs from anon, authenticated;
grant select on table public.yt_editor_docs to authenticated;

-- The app learns whether the Google Docs permission was granted, beside earnings and comments.
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
    'docs', coalesce(bool_or(key = 'google_scopes' and value like '%auth/drive.file%'), false),
    'ai', coalesce(bool_or(key = 'anthropic_api_key' and value <> ''), false),
    'ai_error', nullif(max(value) filter (where key = 'ai_error'), ''),
    'suggest_batch_at', nullif(max(value) filter (where key = 'suggest_batch_at'), ''),
    'suggest_running_at', nullif(max(value) filter (where key = 'suggest_running_at'), '')
  ) into result
  from public.yt_private;
  return result;
end;
$$;
