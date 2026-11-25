-- YouTube Dashboard (yt_*) 19: every goal carries its plan.
--
-- A goal says where the owner wants to get; its plan says how: steps written as checkboxes the owner
-- ticks off as they go ("- [ ] Turn on memberships in Studio"), grouped under plain heading lines.
-- The app counts the ticked steps, shows the next one, and for a goal of the owner's own (no number to
-- reach) the steps are how far along it is. notes stays for why the goal matters.

alter table public.yt_goals add column if not exists plan text;

comment on column public.yt_goals.plan is
  'How the owner gets there: one step per line, written "- [ ] step" (ticked: "- [x] step"), optionally grouped under plain heading lines. The app shows how many steps are done and the next one; a personal goal''s progress is its ticked steps. Null or empty = no plan yet.';
comment on column public.yt_goals.notes is
  'Why the goal matters, or anything else the owner wants to keep with it. The steps live in plan.';
