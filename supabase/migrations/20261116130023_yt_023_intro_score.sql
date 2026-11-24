-- YouTube Dashboard (yt_*) 23: an idea's intro score.
--
-- The owner writes an intro in the idea's hook box and has the AI score it the way their own intro
-- template asks (premise, problem, plug, payoff), with the emotions each spoken line sparks, the way
-- their titles are colour-coded, its hooks and what it shows. The reading is kept with the idea.
-- Written only by the server; owners can already read and edit ideas.

alter table public.yt_ideas add column if not exists intro_check jsonb;
alter table public.yt_ideas add column if not exists intro_checked_at timestamptz;
comment on column public.yt_ideas.intro_check is
  'The AI''s score of the idea''s intro: {score 0-100, parts: [{key premise|problem|plug|payoff|emotions|hooks|show, score 0-100, note}], lines: [{n, emotions: curiosity|desire|fear}] (n counts spoken lines, leaving out [directions]), missing[], better[], to_try: [{instead_of, line}], intro = the text that was scored}. Parts are worth 20, 20, 5, 15, 20, 10 and 10 of the score. Null = not scored. intro_checked_at = when; the hook may have changed since.';
comment on column public.yt_ideas.intro_checked_at is 'When intro_check was made.';
