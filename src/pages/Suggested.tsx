// Ideas, Suggested tab: ideas the dashboard wrote from what is working for the owner, waiting to be
// kept or turned down. Each is checked against YouTube like any idea, so it shows the same scores.
// The newest batch is on top; older ones wait in a closed "Earlier suggestions" section, so the
// owner never has to turn ideas down just to clear them. Kept ones join the board under their game;
// turned-down ones steer the next batch (the dashboard's own suggestions only, never YouTube).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { EmotionTags, Fold, Icon, Loading, ErrorNote, useToast } from "../components/ui.tsx";
import { askForSuggestions, dismissSuggestion, getSuggestions, keepSuggestion } from "../lib/api.ts";
import { compact, multiple } from "../lib/format.ts";
import { keys, useConnection } from "../lib/hooks.ts";
import type { IdeaScores } from "../lib/ideaScore.ts";
import { splitByBatch } from "../lib/suggestions.ts";
import type { Idea, Suggestion } from "../lib/types.ts";
import { ScoreChips, useIdeaChecking, useIdeaScores } from "./Pulse.tsx";

export const suggestionsKey = ["suggestions"];
// Always fresh: follow-ups and the weekly batch arrive in the background, between visits.
export const useSuggestions = () => useQuery({ queryKey: suggestionsKey, queryFn: getSuggestions, staleTime: 0 });

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  follow_up: "Follow-up",
  your_format: "Your winning format",
  breakout: "Breaking out in your games",
  other_games: "Working on other games",
  short_hint: "From a Short that did well",
  comment: "Asked for in comments",
};

/** A suggestion this weak on YouTube right now goes in the "weaker" fold. */
const WEAK = 40;
const BATCH_EVERY_DAYS = 7;
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");

/** Best first: the Recommended score, then Your history; ones not checked yet go last. */
function byScore(scores: Map<string, IdeaScores>) {
  return (a: Idea, b: Idea) => {
    const x = scores.get(a.id), y = scores.get(b.id);
    return (y?.recommended.value ?? -1) - (x?.recommended.value ?? -1) || (y?.history.value ?? -1) - (x?.history.value ?? -1);
  };
}

export function Suggested() {
  const list = useSuggestions();
  const connection = useConnection();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const ideas = list.data ?? [];
  const scores = useIdeaScores(ideas);
  const checking = useIdeaChecking(ideas);

  const groups = useMemo(() => {
    const { fresh, earlier } = splitByBatch(ideas);
    const follow = new Map<string, Idea[]>();
    const rest: Idea[] = [];
    for (const i of fresh) {
      const of = i.suggestion?.follow_up_of;
      if (of) follow.set(of, [...(follow.get(of) ?? []), i]);
      else rest.push(i);
    }
    const sort = byScore(scores);
    const ranked = rest.sort(sort);
    return {
      follow: [...follow.values()].map((g) => g.sort(sort)),
      strong: ranked.filter((i) => (scores.get(i.id)?.recommended.value ?? WEAK) >= WEAK),
      weak: ranked.filter((i) => (scores.get(i.id)?.recommended.value ?? WEAK) < WEAK),
      earlier,
    };
  }, [ideas, scores]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: suggestionsKey });
    await queryClient.invalidateQueries({ queryKey: keys.ideas });
    await queryClient.invalidateQueries({ queryKey: keys.connection });
  };
  const more = async () => {
    setWriting(true);
    try {
      const out = await askForSuggestions();
      if (out.running) toast("A batch is already being written. It shows up here in a minute or so.");
      else toast(out.added.length ? `${out.added.length} new ${out.added.length === 1 ? "idea" : "ideas"}. Their scores fill in over the next few minutes.` : "No new ideas came out of that one that are not repeats. Try again in a while.");
      await refresh();
    } catch (err) {
      toast(message(err), { error: true });
    }
    setWriting(false);
  };

  if (list.isLoading) return <Loading label="Loading suggestions" />;
  if (list.error) return <ErrorNote error={list.error} retry={() => void list.refetch()} />;
  const c = connection.data;
  const last = c?.suggest_batch_at ? Date.parse(c.suggest_batch_at) : null;
  const daysToNext = last === null ? null : Math.max(0, Math.ceil((last + BATCH_EVERY_DAYS * 86_400_000 - Date.now()) / 86_400_000));
  const busy = writing || Boolean(c?.suggest_running_at && Date.now() - Date.parse(c.suggest_running_at) < 4 * 60_000);
  const nextLine = daysToNext === null ? "The first batch arrives within the hour." : daysToNext === 0 ? "The next batch arrives within the hour." : `Next batch in ${daysToNext} ${daysToNext === 1 ? "day" : "days"}.`;

  return (
    <>
      <p className="soft" style={{ margin: "0 0 12px", maxWidth: "68ch" }}>
        Ideas written from what is working for you, newest batch first. Keep the ones you like: they go to your board.
        Older ones move down to Earlier suggestions and go away after three weeks, so there is nothing to clear. Not for me only steers these suggestions, never YouTube.
      </p>
      <div className="row-wrap" style={{ gap: 10, marginBottom: 14, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" disabled={busy || !c?.ai} onClick={() => void more()}>
          <Icon name="plus" />{busy ? "Writing ideas" : "Give me more"}
        </button>
        <span className="small muted">{c?.ai ? nextLine : "Add your Claude API key in Settings to switch suggestions on."}</span>
      </div>
      {busy ? <p className="small muted row" style={{ gap: 8, margin: "0 0 12px" }}><span className="spin" />Writing 10 ideas. This takes about a minute.</p> : null}
      {checking.waiting > 0 ? (
        <p className="small muted row" style={{ gap: 8, margin: "0 0 12px" }}>
          {checking.problem ? null : <span className="spin" />}
          {checking.problem ?? `Checking ${checking.waiting} against YouTube. Scores fill in as each lands.`}
        </p>
      ) : null}

      {ideas.length === 0 ? (
        <div className="panel"><div className="empty">
          <h3>No suggestions waiting</h3>
          <p>{c?.ai ? `Tap Give me more for a batch now. ${nextLine}` : "Suggestions are written by the AI helper. Add your Claude API key in Settings, then come back."}</p>
        </div></div>
      ) : null}

      {groups.follow.map((group) => {
        const basis = group[0].suggestion?.basis?.[0];
        return (
          <section key={group[0].suggestion?.follow_up_of} className="section" style={{ marginTop: 0 }}>
            <div className="section-head"><h2 className="clip">Follow-ups to {basis ? `"${basis.title}"` : "your upload"}</h2></div>
            {basis?.times_usual ? <p className="small muted" style={{ margin: "-4px 0 10px" }}>It got {multiple(basis.times_usual)} your usual views. Strike while it is hot.</p> : null}
            <div className="stack" style={{ gap: 10 }}>{group.map((i) => <SuggestionCard key={i.id} idea={i} scores={scores.get(i.id)} onDone={refresh} />)}</div>
          </section>
        );
      })}
      {groups.strong.length ? (
        <section className="section" style={{ marginTop: groups.follow.length ? undefined : 0 }}>
          {groups.follow.length || groups.earlier.length ? <div className="section-head"><h2>Newest ideas</h2></div> : null}
          <div className="stack" style={{ gap: 10 }}>{groups.strong.map((i) => <SuggestionCard key={i.id} idea={i} scores={scores.get(i.id)} onDone={refresh} />)}</div>
        </section>
      ) : null}
      {groups.weak.length ? (
        <div style={{ marginTop: 16 }}>
          <Fold title={`${groups.weak.length} weaker on YouTube right now`} summary="Low Recommended score">
            <div className="stack" style={{ gap: 10 }}>{groups.weak.map((i) => <SuggestionCard key={i.id} idea={i} scores={scores.get(i.id)} onDone={refresh} />)}</div>
          </Fold>
        </div>
      ) : null}
      {groups.earlier.length ? (
        <div style={{ marginTop: 16 }}>
          <Fold title="Earlier suggestions" summary={`${groups.earlier.length} from earlier batches`}>
            <p className="small muted" style={{ margin: 0 }}>Newest first. Ones you leave here go away three weeks after they were suggested, without counting against anything.</p>
            <div className="stack" style={{ gap: 10 }}>{groups.earlier.map((i) => <SuggestionCard key={i.id} idea={i} scores={scores.get(i.id)} onDone={refresh} />)}</div>
          </Fold>
        </div>
      ) : null}
    </>
  );
}

function SuggestionCard({ idea, scores, onDone }: { idea: Idea; scores: IdeaScores | undefined; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"keep" | "no" | null>(null);
  // The owner can pick one of the other titles before keeping it.
  const [title, setTitle] = useState(idea.title);
  const others = [idea.title, ...idea.title_options].filter((t) => t !== title);
  const s = idea.suggestion;
  const basis = s?.basis?.[0];
  const keep = async () => {
    setBusy("keep");
    try {
      await keepSuggestion(idea.id, title === idea.title ? undefined : { title, title_options: others });
      toast(`Kept. It is on your board under ${idea.topic ?? "its game"}.`);
      await onDone();
    } catch (err) {
      toast(message(err), { error: true });
      setBusy(null);
    }
  };
  const turnDown = async () => {
    setBusy("no");
    try {
      await dismissSuggestion(idea.id);
      toast("Got it. The next batch stays away from ideas like this.");
      await onDone();
    } catch (err) {
      toast(message(err), { error: true });
      setBusy(null);
    }
  };
  return (
    <article className="panel panel-pad suggestion">
      <div className="row-wrap" style={{ gap: 6 }}>
        {s ? <span className={`tag${s.kind === "follow_up" ? " tag-strong" : ""}`}>{KIND_LABEL[s.kind] ?? "Suggested"}</span> : null}
        <span className="tag"><span className="dot" style={{ background: idea.format === "short" ? "var(--s-short)" : "var(--s-long)" }} />{idea.format === "short" ? "Short" : "Long-form"}</span>
        {idea.topic ? <span className="tag">{idea.topic}</span> : null}
      </div>
      <h3 className="suggestion-title">{title}</h3>
      {title === idea.title ? <EmotionTags emotions={s?.emotions} /> : null}
      {others.length ? (
        <div className="suggestion-others">
          <span className="small muted">Or:</span>
          {others.map((t) => (
            <button key={t} type="button" className="link-button small" onClick={() => setTitle(t)} aria-label={`Use the title "${t}"`}>{t}</button>
          ))}
        </div>
      ) : null}
      {idea.concept ? <p className="suggestion-challenge">{idea.concept}</p> : null}
      {s?.why ? (
        <p className="small muted" style={{ margin: 0 }}>
          {s.why}
          {basis && !s.follow_up_of ? (
            <>
              {" "}
              {basis.video_id
                ? <a href={`https://www.youtube.com/watch?v=${basis.video_id}`} target="_blank" rel="noreferrer">Watch it</a>
                : basis.channel ? <span>({basis.channel}{basis.views ? `, ${compact(basis.views)} views` : ""})</span> : null}
            </>
          ) : null}
        </p>
      ) : null}
      <ScoreChips scores={scores} />
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => void keep()}>{busy === "keep" ? "Keeping" : "Keep"}</button>
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void turnDown()}>{busy === "no" ? "Turning down" : "Not for me"}</button>
      </div>
    </article>
  );
}

/** Home: follow-ups waiting for an upload that beat its usual. Nothing when there are none. */
export function FollowUpsWaiting() {
  const list = useSuggestions();
  const groups = useMemo(() => {
    const by = new Map<string, Idea[]>();
    for (const i of list.data ?? []) {
      const of = i.suggestion?.follow_up_of;
      if (of) by.set(of, [...(by.get(of) ?? []), i]);
    }
    return [...by.values()];
  }, [list.data]);
  if (groups.length === 0) return null;
  return (
    <div className="panel panel-pad stack" style={{ gap: 6, marginBottom: 22 }}>
      {groups.slice(0, 2).map((g) => {
        const basis = g[0].suggestion?.basis?.[0];
        return (
          <div key={g[0].id}>
            <strong>{g.length} {g.length === 1 ? "follow-up" : "follow-ups"} waiting</strong>
            <div className="soft">
              {basis ? <>Your "{basis.title}" got {multiple(basis.times_usual)} your usual views. </> : null}
              Next up: {g[0].title}
            </div>
          </div>
        );
      })}
      <div><a href="#/ideas/suggested">See them in Suggested</a></div>
    </div>
  );
}
