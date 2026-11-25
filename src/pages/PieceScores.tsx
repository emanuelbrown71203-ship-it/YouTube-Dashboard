// The title and script scores in the idea editor: each scored two ways, "Your history" and
// "Recommended", by the AI with the owner's rules, their past videos and what is breaking out.
// Nothing here rewrites what the owner wrote: titles to try can be kept as options, nothing more.

import { useState } from "react";
import { EmotionTags, useToast } from "../components/ui.tsx";
import { textKey } from "../../supabase/functions/yt-api/scoring.ts";
import { type PieceReading, scoreScript, scoreTitles, type TitleCheck, type TitleReading } from "../lib/api.ts";
import { useConnection } from "../lib/hooks.ts";
import type { IdeaDraft } from "../lib/types.ts";
import { PieceAdvice, PieceFigures, PieceParts, PiecePanel, PieceTries, tone } from "./PieceScore.tsx";

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** The titles that get scored: the title, then the other titles, each once. */
export function titlesOf(form: Pick<IdeaDraft, "title" | "title_options">): string[] {
  const seen = new Set<string>();
  return [form.title ?? "", ...(form.title_options ?? [])].map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 6);
}

/** What the script score reads: the hook, what happens and the outline together. */
export const scriptText = (form: Pick<IdeaDraft, "hook" | "concept" | "outline">) =>
  [form.hook, form.concept, form.outline].map((t) => (t ?? "").trim()).join("\n---\n");

const both = (t: TitleReading) => (t.yours.score ?? 0) + (t.recommended.score ?? 0);

export function TitleScore(props: { form: IdeaDraft; kept: string[]; onScored: (check: TitleCheck) => void; onKeep: (title: string) => void }) {
  const connection = useConnection();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ai = Boolean(connection.data?.ai);
  const titles = titlesOf(props.form);
  const check = props.form.title_check ?? null;
  const changed = Boolean(check && check.key !== textKey(titles.join("\n")));
  const best = check && check.titles.length > 1 ? [...check.titles].sort((a, b) => both(b) - both(a))[0].title : null;

  const run = async () => {
    setBusy(true);
    try {
      const { idea_id: _id, ...result } = await scoreTitles({
        idea_id: props.form.id, title: props.form.title, game: props.form.topic ?? null, format: props.form.format ?? "long",
        titles, thumbnail: props.form.thumbnail_concept ?? null, concept: props.form.concept ?? null,
      });
      props.onScored(result);
    } catch (err) {
      toast(message(err, "The titles could not be scored. Try again."), { error: true });
    }
    setBusy(false);
  };

  return (
    <PiecePanel
      title="Title scores" sub="Your title and your other titles, each scored two ways"
      changed={changed} checkedAt={check?.checked_at}
      button={{ label: check ? "Score them again" : titles.length > 1 ? `Score my ${titles.length} titles` : "Score my title", busy, busyLabel: "Scoring", disabled: !ai || titles.length === 0, onClick: () => void run() }}
      hint={!ai ? "Add your Claude API key in Settings to switch this on." : titles.length === 0 ? "Write a title first." : null}
    >
      {check ? (
        <>
          <ul className="piece-titles">
            {check.titles.map((t) => (
              <li key={t.title} className={`piece-title${t.title === best ? " best" : ""}`}>
                <div className="piece-title-text">{t.title}</div>
                <div className="score-chips" style={{ marginTop: 6 }}>
                  <span className={`score-chip ${tone(t.yours.score)}`}><b className="fig">{t.yours.score ?? "–"}</b>Your history</span>
                  <span className={`score-chip ${tone(t.recommended.score)}`}><b className="fig">{t.recommended.score ?? "–"}</b>Recommended</span>
                </div>
                <EmotionTags emotions={t.emotions} />
                {t.title === best ? <div className="small" style={{ fontWeight: 650, marginTop: 4 }}>Strongest of these</div> : null}
                {t.note ? <div className="small soft" style={{ marginTop: 2 }}>{t.note}</div> : null}
                <PieceParts reading={t} />
              </li>
            ))}
          </ul>
          <div className="small muted" style={{ marginTop: 6 }}>Your history: your title rules and how your titles have done. Recommended: next to what is breaking out on YouTube.</div>
          <PieceAdvice reading={check} />
          <PieceTries
            label="Titles to try" items={check.to_try}
            action={(line) => (
              <button type="button" className="btn btn-quiet btn-small" disabled={props.kept.includes(line) || titles.length >= 6} onClick={() => props.onKeep(line)}>
                {props.kept.includes(line) ? "Kept" : "Keep as an option"}
              </button>
            )}
          />
        </>
      ) : null}
    </PiecePanel>
  );
}

export function ScriptScore(props: { form: IdeaDraft; onScored: (check: PieceReading) => void }) {
  const connection = useConnection();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ai = Boolean(connection.data?.ai);
  const written = Boolean((props.form.concept ?? "").trim() || (props.form.outline ?? "").trim());
  const check = props.form.script_check ?? null;
  const changed = Boolean(check && check.key !== textKey(scriptText(props.form)));

  const run = async () => {
    setBusy(true);
    try {
      const { idea_id: _id, ...result } = await scoreScript({
        idea_id: props.form.id, title: props.form.title, game: props.form.topic ?? null, format: props.form.format ?? "long",
        hook: props.form.hook ?? null, concept: props.form.concept ?? null, outline: props.form.outline ?? null,
      });
      props.onScored(result);
    } catch (err) {
      toast(message(err, "The script could not be scored. Try again."), { error: true });
    }
    setBusy(false);
  };

  return (
    <PiecePanel
      title="Script score" sub="The hook, what happens and the outline, scored two ways"
      changed={changed} checkedAt={check?.checked_at}
      button={{ label: check ? "Score it again" : "Score my script", busy, busyLabel: "Scoring", disabled: !ai || !written, onClick: () => void run() }}
      hint={!ai ? "Add your Claude API key in Settings to switch this on." : !written ? "Write what happens or an outline first." : null}
    >
      {check ? (
        <>
          <PieceFigures reading={check} />
          <PieceAdvice reading={check} />
          <PieceParts reading={check} />
          <PieceTries label="Lines and beats to try" items={check.to_try} />
        </>
      ) : null}
    </PiecePanel>
  );
}
