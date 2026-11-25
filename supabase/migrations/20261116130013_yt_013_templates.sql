-- YouTube Dashboard (yt_*) 13: the owner's own templates, and how an idea measures up to them.

create table public.yt_templates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('title', 'thumbnail', 'intro', 'other')),
  name        text not null check (length(btrim(name)) > 0),
  body        text not null check (length(btrim(body)) > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);
comment on table public.yt_templates is
  'The owner''s own templates: what a title, a thumbnail or an intro of theirs should have. kind: title | thumbnail | intro | other. body = the template in the owner''s words, usually one rule per line. active = ideas are checked against it. trashed_at set = in the bin.';
create trigger yt_templates_touch before update on public.yt_templates
  for each row execute function public.yt_touch_updated_at();

alter table public.yt_templates enable row level security;
create policy "Owners can read templates" on public.yt_templates for select to authenticated using ((select public.yt_is_owner()));
create policy "Owners can add templates"  on public.yt_templates for insert to authenticated with check ((select public.yt_is_owner()));
create policy "Owners can edit templates" on public.yt_templates for update to authenticated
  using ((select public.yt_is_owner())) with check ((select public.yt_is_owner()));
revoke all on table public.yt_templates from anon, authenticated;
grant select, insert, update on table public.yt_templates to authenticated;

-- The AI's reading of an idea against those templates, kept with the idea.
alter table public.yt_ideas add column if not exists template_check jsonb;
alter table public.yt_ideas add column if not exists template_checked_at timestamptz;
comment on column public.yt_ideas.template_check is
  'How the idea measures up to the owner''s templates, as read by the AI: {score, checks: [{template_id, name, kind, score 0-100, met[], missing[], fix}]}. Null = not checked. template_checked_at = when; the idea may have changed since.';
