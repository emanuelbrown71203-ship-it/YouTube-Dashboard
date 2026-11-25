// "Making now": the videos the owner decided to make, each with the one next step and a button that
// takes them straight there. It opens Home and the Ideas board, because the owner asked the app to
// "show me what's next": everything else waits until they ask for it.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/ui.tsx";
import { getPieceCounts, saveIdea } from "../lib/api.ts";
import { keys, useIdeas } from "../lib/hooks.ts";
import { dueWord, makingOrder, nextStage, nextStep, stageLabel } from "../lib/nextStep.ts";
import type { Idea } from "../lib/types.ts";

export const pieceCountsKey = ["piece-counts"];
export const usePieceCounts = () => useQuery({ queryKey: pieceCountsKey, queryFn: getPieceCounts });
const todayIso = () => new Date().toISOString().slice(0, 10);
/** Decided to make, and not out yet. */
export const inMaking = (idea: Pick<Idea, "picked_at" | "status">) => (Boolean(idea.picked_at) || idea.status !== "idea") && idea.status !== "published";

/** Where "Do it" takes the owner: the idea editor, with the part the step is about open. */
export const stepHref = (id: string, place: string | null) => `#/ideas?edit=${id}${place ? `&open=${place}` : ""}`;

export function MakingNow({ where }: { where: "home" | "ideas" }) {
  const ideas = useIdeas();
  const counts = usePieceCounts();
  const queryClient = useQueryClient();
  const toast = useToast();
  if (ideas.isLoading) return null;
  const list = makingOrder((ideas.data ?? []).filter(inMaking));
  const today = todayIso();

  const advance = async (idea: Idea) => {
    const to = nextStage(idea.status);
    if (!to) return;
    try {
      await saveIdea({ id: idea.id, title: idea.title, status: to.key, picked_at: idea.picked_at ?? new Date().toISOString() });
      await queryClient.invalidateQueries({ queryKey: keys.ideas });
      toast(`Moved to ${to.label}.`, {
        action: { label: "Undo", run: () => void saveIdea({ id: idea.id, title: idea.title, status: idea.status, picked_at: idea.picked_at }).then(() => queryClient.invalidateQueries({ queryKey: keys.ideas })) },
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not move the video. Try again.", { error: true });
    }
  };

  return (
    <section className="making" aria-label="Making now">
      <div className="section-head">
        <h2>Making now</h2>
        {where === "home" ? <a href="#/ideas">All ideas</a> : null}
      </div>
      {list.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <h3>You're not making a video right now</h3>
            <p>{where === "home" ? "Pick one from your ideas and tap Make this one." : "Open a game below, find one you want to do, and tap Make this one."}</p>
            {where === "home" ? <p style={{ marginTop: 10 }}><a href="#/ideas">Open your ideas</a></p> : null}
          </div>
        </div>
      ) : (
        <div className="making-list">
          {list.map((idea) => {
            const step = nextStep(idea, counts.data?.get(idea.id) ?? { cuts: 0, thumbs: 0 });
            const due = dueWord(idea.target_date, today);
            const soon = Boolean(due && (due.endsWith("late") || due === "Due today" || due === "Due tomorrow" || /^Due in [2-3] /.test(due)));
            const to = nextStage(idea.status);
            if (where === "ideas") {
              // On the board it stays small, so the box for a new idea is still on the first screen.
              return (
                <article key={idea.id} className="making-card compact">
                  <a className="making-title" href={stepHref(idea.id, null)}>{idea.title}</a>
                  <div className="making-meta small">
                    <span className="tag">{stageLabel(idea.status)}</span>
                    {due ? <span className={soon ? "making-due soon" : "making-due"}>{due}</span> : null}
                  </div>
                  {step.advance && to ? (
                    <button type="button" className="btn btn-quiet btn-small making-next-link" onClick={() => void advance(idea)}>Next: move to {to.label}</button>
                  ) : (
                    <a className="making-next-link small" href={stepHref(idea.id, step.place)}>Next: {step.text}</a>
                  )}
                </article>
              );
            }
            return (
              <article key={idea.id} className="making-card">
                <a className="making-title" href={stepHref(idea.id, null)}>{idea.title}</a>
                <div className="making-meta small">
                  <span className="tag">{stageLabel(idea.status)}</span>
                  {due ? <span className={soon ? "making-due soon" : "making-due"}>{due}</span> : null}
                </div>
                <div className="making-next">
                  <span className="small muted">Next{step.fromList ? ", from your list" : ""}</span>
                  <span>{step.text}</span>
                </div>
                <div>
                  {step.advance && to ? (
                    <button type="button" className="btn btn-primary btn-small" onClick={() => void advance(idea)}>Move to {to.label}</button>
                  ) : (
                    <a className="btn btn-primary btn-small" href={stepHref(idea.id, step.place)}>{step.place ? "Do it" : "Open it"}</a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
