// The intro score under the hook box: the AI reads the intro the way the owner's intro template asks
// (premise, problem, plug, payoff), marks the emotions each spoken line sparks the way their titles are
// colour-coded, and says what is missing and what could be better. It never rewrites the hook itself.

import { useState } from "react";
import { useToast } from "../components/ui.tsx";
import { INTRO_PARTS, introLines } from "../../supabase/functions/yt-api/scoring.ts";
import { type IntroCheck, scoreIntro } from "../lib/api.ts";
import { EMOTION_LABEL } from "../lib/emotions.ts";
import { ago } from "../lib/format.ts";
import { useConnection } from "../lib/hooks.ts";
import { emotionCounts, emotionSummary, introChanged, scoredLines } from "../lib/intro.ts";
import type { IdeaDraft } from "../lib/types.ts";
import { PieceFigures, PieceParts } from "./PieceScore.tsx";

const band = (score: number) => (score >= 75 ? "high" : score >= 55 ? "mid" : score >= 40 ? "even" : "low");

export function IntroScore(props: { form: IdeaDraft; onScored: (check: IntroCheck, at: string) => void }) {
  const connection = useConnection();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ai = Boolean(connection.data?.ai);
  const hook = props.form.hook ?? "";
  const written = introLines(hook).length > 0;
  const check = props.form.intro_check ?? null;
  const changed = check ? introChanged(check, hook) : false;

  const run = async () => {
    setBusy(true);
    try {
      const { idea_id: _id, checked_at, ...result } = await scoreIntro({
        idea_id: props.form.id, intro: hook, title: props.form.title, game: props.form.topic ?? null,
        format: props.form.format ?? "long", thumbnail: props.form.thumbnail_concept ?? null,
      });
      props.onScored(result, checked_at);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The intro could not be scored. Try again.", { error: true });
    }
    setBusy(false);
  };

  const counts = check ? emotionCounts(check) : null;
  return (
    <div className="score-block intro-score">
      <div className="row between" style={{ alignItems: "flex-end", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 650 }}>Intro score</div>
          <div className="small muted">{check?.yours ? "Scored two ways, with the emotions each line sparks, like a title" : "Your intro formula, and the emotions each line sparks, like a title"}</div>
        </div>
        {check && !check.yours ? (
          <div style={{ textAlign: "right", flex: "none" }}>
            <div className={`score-figure fig ${band(check.score)}`}>{check.score}</div>
            <div className="small muted">out of 100</div>
          </div>
        ) : null}
      </div>

      {check && counts ? (
        <>
          {changed ? <div className="small soft intro-changed">You changed the intro since this score. Score it again to see the new one.</div> : null}
          {check.yours && check.recommended ? <PieceFigures reading={{ yours: check.yours, recommended: check.recommended }} /> : null}
          <div className="intro-emotions small">
            {(["curiosity", "desire", "fear"] as const).map((e) => (
              <span key={e} className="tag emotion"><span className={`dot emo-${e}`} />{EMOTION_LABEL[e]} {counts[e]}</span>
            ))}
            {counts.none ? <span className="tag emotion"><span className="dot emo-none" />No emotion {counts.none}</span> : null}
          </div>
          <div className="small soft">{emotionSummary(counts)}</div>

          {check.yours && check.recommended ? <PieceParts reading={{ yours: check.yours, recommended: check.recommended }} /> : null}
          <div className="small" style={{ fontWeight: 650, marginTop: 10 }}>Your intro formula: {check.score} of 100</div>
          <ul className="score-parts">
            {INTRO_PARTS.map((p) => {
              const part = check.parts.find((x) => x.key === p.key);
              const score = part?.score ?? 0;
              return (
                <li key={p.key}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                    <span className="small muted fig">{Math.round((score * p.max) / 100)} of {p.max}</span>
                  </div>
                  <div className="score-bar"><i style={{ width: `${score}%` }} /></div>
                  {part?.note ? <div className="small soft">{part.note}</div> : null}
                </li>
              );
            })}
          </ul>

          {check.missing.length ? (
            <div className="intro-list">
              <div className="small" style={{ fontWeight: 650 }}>What it's missing</div>
              <ul className="small">{check.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          ) : null}
          {check.better.length ? (
            <div className="intro-list">
              <div className="small" style={{ fontWeight: 650 }}>What could be better</div>
              <ul className="small">{check.better.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          ) : null}

          <details className="intro-more">
            <summary>Emotions line by line</summary>
            <div className="intro-lines">
              {scoredLines(check).map((l, i) => l.n === null ? (
                <div key={i} className="intro-dir small muted">{l.text}</div>
              ) : (
                <div key={i} className="intro-line">
                  <span className="intro-dots" aria-label={l.emotions.length ? `Sparks ${l.emotions.join(" and ")}` : "Sparks no emotion"}>
                    {l.emotions.length ? l.emotions.map((e) => <span key={e} className={`dot emo-${e}`} title={EMOTION_LABEL[e]} />) : <span className="dot emo-none" title="No emotion" />}
                  </span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </details>

          {check.to_try.length ? (
            <details className="intro-more">
              <summary>Lines to try ({check.to_try.length})</summary>
              <ul className="intro-tries">
                {check.to_try.map((t, i) => (
                  <li key={i}>
                    <div className="small muted">{t.instead_of ? `Instead of "${t.instead_of}"` : "A new line"}</div>
                    <div className="intro-try">{t.line}</div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      <div className="row-wrap" style={{ marginTop: 10, gap: 10 }}>
        <button type="button" className="btn btn-small" disabled={busy || !ai || !written} onClick={() => void run()}>
          {busy ? "Scoring" : check ? "Score it again" : "Score my intro"}
        </button>
        <small className="muted grow" style={{ minWidth: 0 }}>
          {!ai ? "Add your Claude API key in Settings to switch this on."
            : !written ? "Write the intro in the hook box first, one line at a time."
            : check && props.form.intro_checked_at && !changed ? `Scored ${ago(props.form.intro_checked_at)}. The AI reads only the words, never the video.`
            : "The AI reads only the words, against your intro template. It uses your Claude key."}
        </small>
      </div>
    </div>
  );
}
