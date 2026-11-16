-- A views goal is for one kind of video. Shorts, long-form videos and streams get
-- views in such different amounts that a goal across all of them would always be
-- decided by the Shorts.
alter table public.yt_goals add column if not exists format text check (format in ('short', 'long', 'live'));

comment on table public.yt_goals is
  'The owner''s goals. kind: subscribers (channel reaches target), video_views (a video reaches target views), personal (anything else, such as a first sponsor; ticked off by hand). A video_views goal with a video_id is for that video; without one it is met by any video of its format (short | long | live; null on older goals = any format). start_value = the number when the goal was set. done_at set = reached. trashed_at set = in the bin.';
comment on column public.yt_goals.format is
  'For video_views goals with no video_id: which kind of video counts (short | long | live). Formats are never mixed, because their view counts are not comparable.';
