-- YouTube Dashboard (yt_*) 16: YouTube's category for found videos.
--
-- The searches for thumbnails outside the owner's games are limited to YouTube's Gaming category.
-- Keeping each video's category lets the thumbnail page show only gaming videos from outside the
-- owner's games, so a dance challenge or a fitness video that a broad search turned up never shows.

alter table public.yt_research_videos add column if not exists category text;
comment on column public.yt_research_videos.category is
  'YouTube''s category id for the video, as the uploader set it: 20 = Gaming. Null = found before it was recorded.';
