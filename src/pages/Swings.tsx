// Daily idea swings (Ideas → Daily swings): the owner's 15-minute routine, one swing at a time, each with
// its own timer and the formula from their template. Three swings write a new idea onto the board; the
// upgrade swing takes one idea in the 70s and pushes it with one of their score levers.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../components/ui.tsx";
import { addSwing, getSwings, saveIdea } from "../lib/api.ts";
import { keys, useIdeas } from "../lib/hooks.ts";
import { bestScore, doneOn, localDay, parseSwings, pickUpgrade, streak, type SwingKind, type SwingPart } from "../lib/swings.ts";
import type { Idea } from "../lib/types.ts";
import { ScoreChips, useIdeaScores } from "./Pulse.tsx";
import { useTemplates } from "./Templates.tsx";

export const swingsKey = ["swings"];
export const useSwings = () => useQuery({ queryKey: swingsKey, queryFn: getSwings });
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
const SHORT: Record<SwingKind, string> = { full: "Full game", segment: "Segmented", short: "Short", upgrade: "Upgrade" };

/** The routine from the owner's own template (the active one with "swing" in its name), or as they first wrote it. */
export function useSwingGuide() {
  const templates = useTemplates();
  return useMemo(() => parseSwings((templates.data ?? []).find((t) => t.active && /swing/i.test(t.name))?.body), [templates.data]);
}

/** A countdown for one swing. It only nudges: time's up never stops the owner from saving. */
function SwingTimer({ minutes }: { minutes: number }) {
  const [endAt, setEndAt] = useState<number | null>(null);
  const [left, setLeft] = useState(minutes * 60);
  useEffect(() => {
    if (endAt === null) return;
    const tick = () => setLeft(Math.max(0, Math.round((endAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [endAt]);
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  if (endAt === null) {
    return <button type="button" className="btn btn-small" onClick={() => { setLeft(minutes * 60); setEndAt(Date.now() + minutes * 60_000); }}>Start {minutes}:00</button>;
  }
  return left > 0
    ? <span className="swing-clock fig" role="timer" aria-live="off">{clock}</span>
    : <span className="small swing-up" role="status">Time's up. Save what you have.</span>;
}

export function DailySwings() {
  const guide = useSwingGuide();
  const swings = useSwings();
  const ideas = useIdeas();
  const today = localDay();
  const rows = swings.data ?? [];
  const done = doneOn(rows, today);
  const [chosen, setChosen] = useState<SwingKind | null>(null);
  const nextOpen = (after?: SwingKind) => {
    const order = guide.parts.map((p) => p.kind);
    const from = after ? order.indexOf(after) + 1 : 0;
    return [...order.slice(from), ...order.slice(0, from)].find((k) => !done.has(k) && k !== after) ?? null;
  };
  const active = chosen ?? nextOpen();
  const part = guide.parts.find((p) => p.kind === active) ?? null;
  const days = streak(rows, today);
  // The games offered for a new idea: the ones open ideas already sit under, most ideas first.
  const games = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of ideas.data ?? []) if (i.topic && i.status !== "published") count.set(i.topic, (count.get(i.topic) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 6);
  }, [ideas.data]);
  const total = guide.parts.reduce((n, p) => n + p.minutes, 0);

  return (
    <>
      <p className="soft" style={{ margin: "0 0 10px" }}>
        {total} minutes, four swings. <strong>{done.size} of 4</strong> done today{days > 1 ? `, ${days} days in a row` : ""}.
      </p>
      <div className="row-wrap swing-steps" role="group" aria-label="Swings">
        {guide.parts.map((p) => (
          <button key={p.kind} type="button" className="chip" aria-pressed={active === p.kind} onClick={() => setChosen(p.kind)}>
            {done.has(p.kind) ? "Done: " : ""}{SHORT[p.kind]} · {p.minutes} min
          </button>
        ))}
      </div>
      {part === null ? (
        <DoneToday rows={rows.filter((r) => r.day === today)} ideas={ideas.data ?? []} />
      ) : part.kind === "upgrade" ? (
        <UpgradeSwing key={`upgrade-${today}`} part={part} levers={guide.levers} today={today} again={done.has("upgrade")} onDone={() => setChosen(nextOpen("upgrade"))} />
      ) : (
        <WriteSwing key={part.kind} part={part} games={games} today={today} again={done.has(part.kind)} onDone={() => setChosen(nextOpen(part.kind))} />
      )}
    </>
  );
}

function SwingHead({ part, again }: { part: SwingPart; again: boolean }) {
  return (
    <>
      <div className="row between" style={{ gap: 10, alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{part.label}</h2>
        <SwingTimer minutes={part.minutes} />
      </div>
      {again ? <p className="small muted" style={{ margin: 0 }}>Done today already. Another one never hurts.</p> : null}
      <ul className="swing-lines">{part.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </>
  );
}

/** A full game, segmented or Short swing: write the idea, file it under its game, save it to the board. */
function WriteSwing(props: { part: SwingPart; games: string[]; today: string; again: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [game, setGame] = useState(() => { try { return localStorage.getItem("yt-ideas-game") ?? ""; } catch { return ""; } });
  const [twist, setTwist] = useState("");
  const [busy, setBusy] = useState(false);
  const extra = props.part.kind === "full" ? "The twist" : props.part.kind === "segment" ? "What makes it worse" : "What happened";
  const save = async () => {
    setBusy(true);
    try {
      const idea = await saveIdea({
        title, format: props.part.kind === "short" ? "short" : "long", status: "idea", priority: 2, title_options: [], discovery: null,
        topic: game.trim() || null, concept: twist.trim() ? `- ${twist.trim()}` : null, source: "swing",
      });
      await addSwing({ day: props.today, kind: props.part.kind, idea_id: idea.id });
      try { if (game.trim()) localStorage.setItem("yt-ideas-game", game.trim()); } catch { /* private mode */ }
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.ideas }), queryClient.invalidateQueries({ queryKey: swingsKey })]);
      toast(game.trim() ? `Saved under ${game.trim()}.` : "Saved to your ideas.");
      props.onDone();
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  return (
    <div className="panel panel-pad swing-card">
      <SwingHead part={props.part} again={props.again} />
      <label className="field">
        <span>{props.part.kind === "short" ? "The Short" : "The video"}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={props.part.kind === "short" ? "One moment, one story" : "Your title"} />
      </label>
      <div className="field">
        <span>Game</span>
        {props.games.length ? (
          <div className="row-wrap" style={{ gap: 6 }}>
            {props.games.map((g) => <button key={g} type="button" className="chip" aria-pressed={game === g} onClick={() => setGame(game === g ? "" : g)}>{g}</button>)}
          </div>
        ) : null}
        <input className="input" value={props.games.includes(game) ? "" : game} onChange={(e) => setGame(e.target.value)} maxLength={80} placeholder="Another game" aria-label="Another game" />
      </div>
      <label className="field">
        <span>{extra} (optional)</span>
        <input className="input" value={twist} onChange={(e) => setTwist(e.target.value)} maxLength={200} />
      </label>
      <div className="row-wrap" style={{ gap: 10 }}>
        <button type="button" className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? "Saving" : "Save to my ideas"}</button>
        <button type="button" className="btn btn-quiet" onClick={props.onDone}>Skip for now</button>
      </div>
    </div>
  );
}

/** The upgrade swing: one idea in the 70s, the owner's score levers, and a better title. */
function UpgradeSwing(props: { part: SwingPart; levers: string[]; today: string; again: boolean; onDone: () => void }) {
  const ideas = useIdeas();
  const scores = useIdeaScores(ideas.data ?? []);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [skip, setSkip] = useState<string[]>([]);
  const idea = useMemo(
    () => pickUpgrade(ideas.data ?? [], (id) => bestScore(scores.get(id)), props.today, skip),
    [ideas.data, scores, props.today, skip],
  );
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const newTitle = (title ?? idea?.title ?? "").trim();
  const swap = () => {
    if (idea) setSkip((s) => [...s, idea.id]);
    setTicked(new Set());
    setTitle(null);
    setChange("");
  };
  const save = async (it: Idea) => {
    setBusy(true);
    try {
      const names = [...ticked].sort().map((i) => props.levers[i].split(":")[0].trim());
      const note = `- Upgrade swing (${props.today}): ${names.length ? names.join("; ") : "a sharper title"}${change.trim() ? `. ${change.trim()}` : ""}`;
      const renamed = newTitle && newTitle !== it.title;
      // The old title is kept as an option, so nothing the owner wrote is lost.
      const options = renamed ? [it.title, ...(it.title_options ?? []).filter((o) => o !== it.title && o !== newTitle)].slice(0, 5) : it.title_options ?? [];
      await saveIdea({ id: it.id, title: renamed ? newTitle : it.title, title_options: options, notes: [it.notes?.trim(), note].filter(Boolean).join("\n") });
      await addSwing({ day: props.today, kind: "upgrade", idea_id: it.id, levers: names });
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.ideas }), queryClient.invalidateQueries({ queryKey: swingsKey })]);
      toast(renamed ? "Upgraded. Its scores update as it's checked again." : "Saved what you'd add.");
      props.onDone();
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  return (
    <div className="panel panel-pad swing-card">
      <SwingHead part={props.part} again={props.again} />
      {!idea ? (
        <p className="small muted" style={{ margin: 0 }}>None of your ideas has a score yet. Scores fill in as each idea is checked against YouTube; come back in a few minutes.</p>
      ) : (
        <>
          <div className="swing-idea">
            <a className="making-title" href={`#/ideas?edit=${idea.id}`}>{idea.title}</a>
            {idea.topic ? <div className="small muted">{idea.topic}</div> : null}
            <ScoreChips scores={scores.get(idea.id)} />
          </div>
          <div className="field">
            <span>Pick a lever</span>
            {props.levers.map((l, i) => (
              <label key={i} className="swing-lever">
                <input type="checkbox" checked={ticked.has(i)} onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                <span>{l}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>The upgraded title</span>
            <input className="input" value={title ?? idea.title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <small>The old title stays in Other titles.</small>
          </label>
          <label className="field">
            <span>What changes (optional)</span>
            <input className="input" value={change} onChange={(e) => setChange(e.target.value)} maxLength={200} placeholder="One wipe deletes the save" />
          </label>
          <div className="row-wrap" style={{ gap: 10 }}>
            <button type="button" className="btn btn-primary" disabled={busy || (!ticked.size && newTitle === idea.title)} onClick={() => void save(idea)}>{busy ? "Saving" : "Save the upgrade"}</button>
            <button type="button" className="btn btn-quiet" onClick={swap}>Pick another idea</button>
          </div>
        </>
      )}
    </div>
  );
}

function DoneToday({ rows, ideas }: { rows: { kind: SwingKind; idea_id: string | null }[]; ideas: Idea[] }) {
  return (
    <div className="panel panel-pad swing-card">
      <h2 style={{ margin: 0, fontSize: 18 }}>Done for today</h2>
      <p className="small muted" style={{ margin: 0 }}>Four swings in. See you tomorrow.</p>
      <ul className="swing-lines">
        {rows.map((r, i) => {
          const idea = ideas.find((x) => x.id === r.idea_id);
          return <li key={i}>{SHORT[r.kind]}: {idea ? <a href={`#/ideas?edit=${idea.id}`}>{idea.title}</a> : "saved"}</li>;
        })}
      </ul>
    </div>
  );
}

/** One line on Home until today's swings are done; then it is left out. */
export function SwingsLine() {
  const swings = useSwings();
  if (swings.isLoading || swings.error) return null;
  const done = doneOn(swings.data ?? [], localDay()).size;
  if (done >= 4) return null;
  return (
    <a className="swings-line" href="#/ideas/swings">
      <span><strong>Daily idea swings</strong> <span className="muted">· {done} of 4 today</span></span>
      <span className="btn btn-small">{done ? "Keep going" : "Swing"}</span>
    </a>
  );
}
