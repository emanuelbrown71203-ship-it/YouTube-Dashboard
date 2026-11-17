// Idea scores, the first 48 hours of an upload, and the weekly note.

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useToast } from "../components/ui.tsx";
import { coverGame, getCoveredGames, getFoundVideos, suggestTitles, type TitleIdea } from "../lib/api.ts";
import { whole } from "../lib/format.ts";
import { goalProgress, useGoals } from "../lib/growth.ts";
import { useChannel, useDaily, useIdeas, useVideos } from "../lib/hooks.ts";
import { type IdeaScores, type Score, scoreIdea, scoreWord } from "../lib/ideaScore.ts";
import { first48, type Point, trackedUpload, TRACK_HOURS, useFirstDays, usePulse, weekNote, yardstickVideos } from "../lib/pulse.ts";
import type { Idea, IdeaDraft, Video } from "../lib/types.ts";

const todayIso = () => new Date().toISOString().slice(0, 10);

export const useFound = () => useQuery({ queryKey: ["found-videos"], queryFn: getFoundVideos, staleTime: 5 * 60_000 });
export const useCovered = () => useQuery({ queryKey: ["covered-games"], queryFn: getCoveredGames, staleTime: 5 * 60_000 });

// ---------------------------------------------------------------------------
// Outlier searches the dashboard runs by itself
// ---------------------------------------------------------------------------
//
// A score that waits for the owner to go and search is not a score. When an idea's game has no fresh
// breakout search, the dashboard runs one, a game at a time, and the scores fill in when it lands.
// Each game and format is tried once per visit, so a search that fails is not hammered.

const tried = new Set<string>();
type Need = { game: string; format: "long" | "short" };
const waiting: Need[] = [];
let now = null as Need | null;
let problem: string | null = null;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());
let snapshot: { now: Need | null; problem: string | null } = { now, problem };
const refresh = () => { snapshot = { now, problem }; tell(); };

async function work(queryClient: QueryClient) {
  if (now) return;
  while (waiting.length) {
    now = waiting.shift()!;
    refresh();
    try {
      const out = await coverGame(now.game, now.format);
      if (out.skipped) {
        // Out of lookups for the day: stop asking until the page is opened again.
        problem = out.skipped;
        waiting.length = 0;
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["found-videos"] }),
          queryClient.invalidateQueries({ queryKey: ["covered-games"] }),
          queryClient.invalidateQueries({ queryKey: ["research-runs"] }),
          queryClient.invalidateQueries({ queryKey: ["quota"] }),
        ]);
      }
    } catch (err) {
      problem = err instanceof Error ? err.message : "The check could not run. It will try again later.";
      waiting.length = 0;
    }
  }
  now = null;
  refresh();
}

/** Queues a breakout search for each game that needs one, and says what is being checked right now. */
export function useAutoResearch(needs: { game: string; format: "long" | "short" }[]) {
  const queryClient = useQueryClient();
  const key = needs.map((n) => `${n.format}:${n.game.toLowerCase()}`).join("|");
  useEffect(() => {
    for (const need of needs) {
      const id = `${need.format}:${need.game.toLowerCase()}`;
      // A handful per visit is plenty; the sync covers the rest in the background.
      if (tried.has(id) || tried.size >= 8) continue;
      tried.add(id);
      waiting.push(need);
    }
    void work(queryClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, queryClient]);
  return useSyncExternalStore((w) => { watchers.add(w); return () => void watchers.delete(w); }, () => snapshot);
}

/** One line saying a check is running, or why it could not. */
export function ResearchStatus({ state }: { state: { now: { game: string; format: string } | null; problem: string | null } }) {
  if (state.now) {
    return <p className="small muted row" style={{ gap: 8, margin: 0 }}><span className="spin" />Checking what YouTube is pushing for {state.now.game} {state.now.format === "short" ? "Shorts" : "videos"}. The scores fill in when it is done.</p>;
  }
  return state.problem ? <p className="small muted" style={{ margin: 0 }}>The check on what YouTube is pushing could not run: {state.problem}</p> : null;
}

/** Scores for every idea on the board, worked out once. */
export function useIdeaScores(ideas: Pick<Idea, "id" | "title" | "format" | "target_keyword" | "concept" | "hook" | "topic">[]): Map<string, IdeaScores> {
  const videos = useVideos();
  const found = useFound();
  const covered = useCovered();
  return useMemo(() => {
    const today = todayIso();
    return new Map(ideas.map((i) => [i.id, scoreIdea(i, videos.data ?? [], found.data ?? [], today, covered.data ?? [])]));
  }, [ideas, videos.data, found.data, covered.data]);
}

function tone(value: number | null): string {
  return value === null ? "none" : value >= 75 ? "high" : value >= 55 ? "mid" : value >= 40 ? "even" : "low";
}

/** Two small figures on an idea card. */
export function ScoreChips({ scores, templates = null }: { scores: IdeaScores | undefined; templates?: number | null }) {
  if (!scores) return null;
  const chip = (label: string, s: Score) => (
    <span className={`score-chip ${tone(s.value)}`} title={`${label}: ${scoreWord(s.value)}`}>
      <b className="fig">{s.value ?? "–"}</b>{label}
    </span>
  );
  return (
    <div className="score-chips">
      {chip("Your history", scores.history)}{chip("Recommended", scores.recommended)}
      {templates === null ? null : chip("Your templates", { value: templates, parts: [] })}
    </div>
  );
}

function ScoreBlock({ title, sub, score }: { title: string; sub: string; score: Score }) {
  return (
    <div className="score-block">
      <div className="row between" style={{ alignItems: "flex-end", gap: 10 }}>
        <div><div style={{ fontWeight: 650 }}>{title}</div><div className="small muted">{sub}</div></div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div className={`score-figure fig ${tone(score.value)}`}>{score.value ?? "–"}</div>
          <div className="small muted">{scoreWord(score.value)}</div>
        </div>
      </div>
      <ul className="score-parts">
        {score.parts.map((p) => (
          <li key={p.label}>
            <div className="row between" style={{ gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span className="small muted fig">{p.points === null ? "not counted" : `${p.points} of ${p.max}`}</span>
            </div>
            <div className="score-bar"><i style={{ width: `${p.points === null ? 0 : (100 * p.points) / p.max}%` }} /></div>
            <div className="small soft">{p.why}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The full reading of one idea, inside the editor. It follows the title as it is typed. */
export function ScorePanel({ draft }: { draft: IdeaDraft }) {
  const videos = useVideos();
  const found = useFound();
  const covered = useCovered();
  const scores = useMemo(
    () => scoreIdea({ title: draft.title ?? "", format: draft.format ?? "long", target_keyword: draft.target_keyword ?? null, concept: draft.concept ?? null, hook: draft.hook ?? null, topic: draft.topic ?? null }, videos.data ?? [], found.data ?? [], todayIso(), covered.data ?? []),
    [draft.title, draft.format, draft.target_keyword, draft.concept, draft.hook, draft.topic, videos.data, found.data, covered.data],
  );
  // The game changes with every letter while a title is being typed; wait until it has settled before searching for it.
  const want = scores.search && covered.data ? `${draft.format === "short" ? "short" : "long"}\n${scores.search}` : "";
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(want), 1500);
    return () => window.clearTimeout(timer);
  }, [want]);
  const research = useAutoResearch(settled && settled === want ? [{ format: settled.split("\n")[0] as "long" | "short", game: settled.split("\n")[1] }] : []);
  if (!(draft.title ?? "").trim()) return null;
  const kind = draft.format === "short" ? "Shorts" : "long-form videos";
  return (
    <div className="score-panel">
      <div className="small muted" style={{ marginBottom: 8 }}>
        {scores.game ? `Read as a ${draft.format === "short" ? "Short" : "long-form video"} about ${scores.game}. ` : ""}
        Scored against your {kind} only. These are estimates to help you choose between ideas, not predictions.
      </div>
      <ScoreBlock title="Your history" sub="Has this kind of video worked for you before?" score={scores.history} />
      <ScoreBlock title="Recommended" sub="Is YouTube likely to put it in front of new people?" score={scores.recommended} />
      <ResearchStatus state={research} />
    </div>
  );
}

/** Asks the AI for titles in the owner's own style and lets them keep the ones they like. */
export function TitleHelper(props: { draft: IdeaDraft; game: string | null; onUse: (title: string) => void; onKeep: (title: string) => void; kept: string[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<TitleIdea[] | null>(null);
  const ask = async () => {
    setBusy(true);
    try {
      const out = await suggestTitles({ title: props.draft.title ?? "", concept: [props.draft.hook, props.draft.concept].filter(Boolean).join(" "), format: props.draft.format ?? "long", game: props.game });
      setIdeas(out.titles);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not get titles. Try again.", { error: true });
    }
    setBusy(false);
  };
  return (
    <div className="field">
      <span>Title helper</span>
      <div>
        <button type="button" className="btn btn-small" disabled={busy || !((props.draft.title ?? "").trim() || (props.draft.concept ?? "").trim())} onClick={() => void ask()}>
          {busy ? "Writing titles" : ideas ? "Write six more" : "Suggest titles in my style"}
        </button>
      </div>
      <small>The AI reads your own titles that beat your usual video, and the ones that fell flat, then writes new ones for this idea. It uses your Claude key.</small>
      {ideas ? (
        <div className="stack" style={{ gap: 8, marginTop: 4 }}>
          {ideas.map((t) => (
            <div key={t.title} className="title-idea">
              <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{t.title}</div>
              <div className="small soft">{t.why}</div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <button type="button" className="btn btn-small" onClick={() => props.onUse(t.title)}>Use as the title</button>
                <button type="button" className="btn btn-quiet btn-small" disabled={props.kept.includes(t.title) || props.kept.length >= 5} onClick={() => props.onKeep(t.title)}>
                  {props.kept.includes(t.title) ? "Kept" : "Keep as an option"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The first 48 hours
// ---------------------------------------------------------------------------

function Curves({ mine, usual, format }: { mine: Point[]; usual: Point[]; format: string | null }) {
  const W = 320, H = 120, pad = { l: 6, r: 6, t: 8, b: 18 };
  const top = Math.max(1, ...mine.map((p) => p.views), ...usual.map((p) => p.views)) * 1.08;
  const x = (h: number) => pad.l + ((W - pad.l - pad.r) * h) / TRACK_HOURS;
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / top;
  const path = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${x(p.h).toFixed(1)} ${y(p.views).toFixed(1)}`).join(" ");
  const last = mine[mine.length - 1];
  const colour = format === "short" ? "var(--s-short)" : format === "live" ? "var(--s-live)" : "var(--s-long)";
  return (
    <svg className="curves" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Views so far against your usual at the same age">
      {[24, 48, 72].map((h) => (
        <g key={h}>
          <line x1={x(h)} x2={x(h)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeWidth="1" />
          <text x={x(h)} y={H - 4} textAnchor={h === 72 ? "end" : "middle"} fontSize="10" fill="var(--ink-3)">{h}h</text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-2)" strokeWidth="1" />
      {usual.length >= 2 ? <path d={path(usual)} fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" /> : null}
      {mine.length >= 2 ? <path d={path(mine)} fill="none" stroke={colour} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {last && last.h > 0 ? <circle cx={x(last.h)} cy={y(last.views)} r="4" fill={colour} stroke="var(--surface)" strokeWidth="2" /> : null}
    </svg>
  );
}

const KIND = { long: "long-form video", short: "Short", live: "stream" } as const;

/** One upload's first three days against the owner's usual video of the same kind. */
export function First48({ video, heading }: { video: Video; heading?: boolean }) {
  const videos = useVideos();
  const pulse = usePulse();
  const yard = useMemo(() => yardstickVideos(video, videos.data ?? []).map((v) => v.id), [video, videos.data]);
  const days = useFirstDays(yard);
  const read = useMemo(() => first48(video, videos.data ?? [], pulse.data ?? [], days.data ?? []), [video, videos.data, pulse.data, days.data]);
  if (pulse.isLoading || read.mine.length < 2 || !read.now) return null;
  const kind = KIND[(video.content_type ?? "long") as keyof typeof KIND];
  const hours = Math.floor(read.now.h);
  const verdict = read.now.times === null ? null
    : read.now.times >= 1.25 ? "ahead of" : read.now.times <= 0.8 ? "behind" : "level with";
  return (
    <div className="panel panel-pad first48">
      {heading ? <div className="small muted" style={{ marginBottom: 2 }}>First 48 hours</div> : null}
      {heading ? <a className="clip" style={{ fontWeight: 650, display: "block", color: "var(--ink)" }} href={`#/videos?v=${video.id}`}>{video.title}</a> : null}
      <div className="row-wrap" style={{ alignItems: "flex-end", gap: "6px 18px", margin: "8px 0 4px" }}>
        <div><span className="fig" style={{ fontSize: 28 }}>{whole(read.now.views)}</span> <span className="soft">views after {hours < 1 ? "under an hour" : `${hours} hour${hours === 1 ? "" : "s"}`}</span></div>
        {verdict ? (
          <div className="soft">
            <strong style={{ color: "var(--ink)" }}>{read.now.times}x</strong>, {verdict} your usual {kind} at this age ({whole(read.now.usual ?? 0)})
          </div>
        ) : null}
      </div>
      <Curves mine={read.mine} usual={read.usual} format={video.content_type} />
      <div className="small muted">
        {read.usual.length
          ? `Solid line: this ${kind}. Dashed: the middle of your ${read.from} ${kind}s before it at the same age.`
          : `Nothing to compare with yet: fewer than three earlier ${kind}s have their first days in. The next syncs fetch them.`}
        {read.olderCounting ? " Most of those went up before YouTube started counting a view from the first frame in August 2026, so your usual reads low and this one reads high." : ""}
        {read.now.h < 48 ? " Updates about once an hour." : ""}
      </div>
    </div>
  );
}

/** On the front page: the newest video or Short while it is still in its first three days. */
export function NewUpload() {
  const videos = useVideos();
  const video = useMemo(() => trackedUpload(videos.data ?? [], Date.now()), [videos.data]);
  return video ? <div style={{ marginBottom: 22 }}><First48 video={video} heading /></div> : null;
}

// ---------------------------------------------------------------------------
// The weekly note
// ---------------------------------------------------------------------------

export function WeekCard() {
  const videos = useVideos();
  const daily = useDaily();
  const ideas = useIdeas();
  const goals = useGoals();
  const channel = useChannel();
  const open = useMemo(() => (ideas.data ?? []).filter((i) => i.status !== "published"), [ideas.data]);
  const scores = useIdeaScores(open);
  const lines = useMemo(() => {
    const today = todayIso();
    const ctx = { subscribers: channel.data?.subscribers ?? null, videos: videos.data ?? [], daily: daily.data ?? [], today };
    const best = open.map((i) => ({ i, s: scores.get(i.id)?.history.value ?? null })).filter((x) => x.s !== null).sort((a, b) => (b.s ?? 0) - (a.s ?? 0))[0];
    return weekNote({
      videos: videos.data ?? [], daily: daily.data ?? [], ideas: ideas.data ?? [], today,
      goals: (goals.data ?? []).map((g) => ({ title: g.title, progress: goalProgress(g, ctx) })),
      topIdea: best ? { title: best.i.title, id: best.i.id, score: best.s! } : null,
    });
  }, [videos.data, daily.data, ideas.data, goals.data, channel.data, open, scores]);
  if (videos.isLoading || daily.isLoading || lines.length === 0) return null;
  return (
    <section className="week-card" aria-label="This week">
      <h2>This week</h2>
      <ul>
        {lines.map((line) => <li key={line.text}>{line.href ? <a href={line.href}>{line.text}</a> : line.text}</li>)}
      </ul>
    </section>
  );
}
