-- YouTube Dashboard (yt_*) 1/6: who is allowed in.
--
-- The app lives in the shared "zay-apps" project next to other apps, so every
-- object is prefixed yt_. Each browser signs in anonymously (Supabase Auth)
-- and is let in only if it has a live row in yt_owners. A row is added by the
-- yt-auth edge function (Google sign-in as the channel owner) or by redeeming
-- a one-time access code. Nothing here is ever removed by the app: rows are
-- switched off with a timestamp instead (revoked_at / used_at).

create or replace function public.yt_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.yt_owners (
  user_id      uuid primary key,
  method       text not null check (method in ('google', 'access_code')),
  device       text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);
comment on table public.yt_owners is
  'Browsers allowed into the YouTube dashboard: one anonymous auth user per browser, live while revoked_at is null. No foreign key to auth.users on purpose (shared project).';

create or replace function public.yt_is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.yt_owners
    where user_id = (select auth.uid()) and revoked_at is null
  );
$$;

create table public.yt_private (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
comment on table public.yt_private is
  'Server-only settings (Google OAuth client, refresh token, cron secret, owner channel id, allowed app origins). Row level security is on with no policies on purpose: only edge functions (service role) and cron read it.';

create table public.yt_oauth_states (
  state      text primary key,
  user_id    uuid not null,
  return_to  text,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
comment on table public.yt_oauth_states is 'Short-lived Google sign-in state values (server-only).';

create table public.yt_access_codes (
  code_hash  text primary key,
  note       text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    uuid
);
comment on table public.yt_access_codes is
  'One-time access codes, stored as sha256. Make one with: select public.yt_create_access_code(); each code lets one browser in.';

alter table public.yt_owners       enable row level security;
alter table public.yt_private      enable row level security;
alter table public.yt_oauth_states enable row level security;
alter table public.yt_access_codes enable row level security;

create policy "Owners can see signed-in browsers" on public.yt_owners
  for select to authenticated using ((select public.yt_is_owner()));
