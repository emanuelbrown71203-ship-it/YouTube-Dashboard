-- YouTube Dashboard (yt_*) 17: screenshots as thumbnail references.
--
-- A reference can now be a picture the owner adds themselves (a screenshot from their phone, cropped
-- to the thumbnail) as well as a YouTube video. A picture has no video_id, so that column may now be
-- empty; every row still needs one or the other. Nothing is removed: existing rows keep their video.

alter table public.yt_idea_refs alter column video_id drop not null;

alter table public.yt_idea_refs
  add column image       text,
  add column image_small text;

alter table public.yt_idea_refs
  add constraint yt_idea_refs_video_or_picture check (video_id is not null or (image is not null and image_small is not null)),
  add constraint yt_idea_refs_image_jpeg check (image is null or (image like 'data:image/jpeg;base64,%' and length(image) <= 900000)),
  add constraint yt_idea_refs_image_small_jpeg check (image_small is null or (image_small like 'data:image/jpeg;base64,%' and length(image_small) <= 120000));

comment on column public.yt_idea_refs.video_id is
  'The YouTube video whose thumbnail is the reference. Empty for a picture the owner added themselves (image, image_small).';
comment on column public.yt_idea_refs.image is
  'A picture the owner added (usually a screenshot cropped to the thumbnail), as a JPEG data URL, at most 1280 pixels on its longest side. Read one row at a time: lists leave it out.';
comment on column public.yt_idea_refs.image_small is
  'The same picture at most 320 pixels on its longest side, for cards and lists.';
comment on table public.yt_idea_refs is
  'Thumbnail references for an idea: other people''s videos whose thumbnail the owner wants to use as a reference or a starting place, or a picture the owner added themselves (video_id empty, image and image_small set). For a video the picture is https://i.ytimg.com/vi/<video_id>/mqdefault.jpg (hq720.jpg or maxresdefault.jpg for a large one). title, channel_title, channel_subscribers, views and outlier_score (views against that channel''s usual) are copied in when a video is added. note = what the owner wants to take from it. trashed_at set = removed from the idea.';
