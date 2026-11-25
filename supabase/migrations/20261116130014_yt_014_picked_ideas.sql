-- YouTube Dashboard (yt_*) 14: the ideas the owner has decided to make.
--
-- The owner writes an idea most days. They all live under their game; only the ones picked to be
-- made go on the production board, so that board is not buried under every passing thought.

alter table public.yt_ideas add column if not exists picked_at timestamptz;
comment on column public.yt_ideas.picked_at is
  'When the owner decided to make this idea. Null = still just an idea, kept under its game. Set = on the production board, where status says how far along it is (idea = picked but not started).';

-- Ideas already past the first stage were clearly picked.
update public.yt_ideas set picked_at = coalesce(updated_at, created_at) where picked_at is null and status <> 'idea';

create or replace view public.yt_v_ideas
with (security_invoker = true) as
select
  i.id, i.format, i.status, i.discovery, i.priority, i.title, i.target_keyword, i.hook, i.concept,
  i.title_options, i.thumbnail_concept, i.target_length_s, i.target_date, i.tags, i.archived, i.source,
  i.inspiration_url, i.inspiration_video_id, r.title as inspiration_title, r.outlier_score as inspiration_outlier_score,
  i.parent_id, p.title as parent_title,
  i.video_id, v.title as video_title, v.views as video_views,
  i.created_at, i.updated_at,
  i.topic,
  i.picked_at
from public.yt_ideas i
left join public.yt_ideas p on p.id = i.parent_id
left join public.yt_videos v on v.id = i.video_id
left join public.yt_research_videos r on r.id = i.inspiration_video_id
where i.trashed_at is null;
comment on view public.yt_v_ideas is
  'Ideas that are not in the bin, with the idea they were cut from, the research video that inspired them and the upload they became. topic = the game the idea sits under. picked_at set = the owner decided to make it (it is on the production board); null = still just an idea.';
