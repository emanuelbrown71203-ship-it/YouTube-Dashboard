// Two scores for a piece of a video (a title, the intro, the script, a thumbnail), the way an idea is
// scored: "Your history" (your own rules, and how your past ones did) and "Recommended" (what is working
// on YouTube now). Shared by every piece so they look and read the same.

import { type ReactNode, useState } from "react";
import type { PieceReading, PieceSide } from "../lib/api.ts";
import { ago } from "../lib/format.ts";

export const tone = (value: number | null | undefined) =>
  value === null || value === undefined ? "none" : value >= 75 ? "high" : value >= 55 ? "mid" : value >= 40 ? "even" : "low";

export const SIDES = [
  { key: "yours", title: "Your history", sub: "Your rules, and how yours have done" },
  { key: "recommended", title: "Recommended", sub: "What's working on YouTube now" },
] as const;

/** The two figures side by side. */
export function PieceFigures({ reading }: { reading: Pick<PieceReading, "yours" | "recommended"> }) {
  return (
    <div className="piece-figures">
      {SIDES.map((s) => (
        <div key={s.key} className="piece-figure">
          <div className={`score-figure fig ${tone(reading[s.key].score)}`}>{reading[s.key].score ?? "–"}</div>
          <div><div className="small" style={{ fontWeight: 650 }}>{s.title}</div><div className="small muted">{s.sub}</div></div>
        </div>
      ))}
    </div>
  );
}

/** Every part of both scores, folded: how each one was worked out. */
export function PieceParts({ reading, extra }: { reading: Pick<PieceReading, "yours" | "recommended">; extra?: ReactNode }) {
  return (
    <details className="intro-more">
      <summary>How it was scored</summary>
      {SIDES.map((s) => <SideParts key={s.key} title={s.title} side={reading[s.key]} />)}
      {extra}
    </details>
  );
}

function SideParts({ title, side }: { title: string; side: PieceSide }) {
  return (
    <div className="piece-side">
      <div className="small" style={{ fontWeight: 650, marginTop: 10 }}>{title}{side.score === null ? ": too little to go on yet" : ""}</div>
      <ul className="score-parts">
        {side.parts.map((p) => (
          <li key={p.key}>
            <div className="row between" style={{ gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span className="small muted fig">{p.score === null ? "not counted" : `${Math.round((p.score * p.max) / 100)} of ${p.max}`}</span>
            </div>
            <div className="score-bar"><i style={{ width: `${p.score ?? 0}%` }} /></div>
            {p.note ? <div className="small soft">{p.note}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What it is missing and what could be better: the part the owner acts on. Only the most important one
 * of each shows at first (the AI lists them most important first); the rest are a tap away, so it is
 * never a wall of advice.
 */
export function PieceAdvice({ reading }: { reading: Pick<PieceReading, "missing" | "better"> }) {
  const [all, setAll] = useState(false);
  const missing = all ? reading.missing : reading.missing.slice(0, 1);
  const better = all ? reading.better : reading.better.slice(0, 1);
  const hidden = reading.missing.length + reading.better.length - missing.length - better.length;
  return (
    <>
      {missing.length ? (
        <div className="intro-list">
          <div className="small" style={{ fontWeight: 650 }}>{all ? "What it's missing" : "Most missing"}</div>
          <ul className="small">{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      ) : null}
      {better.length ? (
        <div className="intro-list">
          <div className="small" style={{ fontWeight: 650 }}>{all ? "What could be better" : "Biggest win"}</div>
          <ul className="small">{better.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      ) : null}
      {hidden > 0 ? <button type="button" className="btn btn-quiet btn-small" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setAll(true)}>Show {hidden} more</button>
        : all && reading.missing.length + reading.better.length > 2 ? <button type="button" className="btn btn-quiet btn-small" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setAll(false)}>Show less</button> : null}
    </>
  );
}

/** Lines, titles or changes to try, folded; each one line by line. */
export function PieceTries(props: { label: string; items: { instead_of?: string; line: string }[]; action?: (line: string) => ReactNode }) {
  if (!props.items.length) return null;
  return (
    <details className="intro-more">
      <summary>{props.label} ({props.items.length})</summary>
      <ul className="intro-tries">
        {props.items.map((t, i) => (
          <li key={i}>
            {t.instead_of !== undefined ? <div className="small muted">{t.instead_of ? `Instead of "${t.instead_of}"` : "A new one"}</div> : null}
            <div className="intro-try">{t.line}</div>
            {props.action ? props.action(t.line) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The frame every piece's score sits in: a heading, the scores, a note when the piece changed since, and the button. */
export function PiecePanel(props: {
  title: string;
  sub: string;
  children?: ReactNode;
  changed?: boolean;
  checkedAt?: string | null;
  button: { label: string; busy: boolean; busyLabel: string; disabled: boolean; onClick: () => void };
  hint: string | null;
}) {
  return (
    <div className="score-block piece-score">
      <div style={{ fontWeight: 650 }}>{props.title}</div>
      <div className="small muted">{props.sub}</div>
      {props.changed ? <div className="small soft intro-changed">You changed it since this score. Score it again to see the new one.</div> : null}
      {props.children}
      <div className="row-wrap" style={{ marginTop: 10, gap: 10 }}>
        <button type="button" className="btn btn-small" disabled={props.button.busy || props.button.disabled} onClick={props.button.onClick}>
          {props.button.busy ? props.button.busyLabel : props.button.label}
        </button>
        <small className="muted grow" style={{ minWidth: 0 }}>
          {props.hint ?? (props.checkedAt && !props.changed ? `Scored ${ago(props.checkedAt)}. Estimates from your numbers and YouTube's, not promises.` : "Scored against your rules, your past videos and what is breaking out. It uses your Claude key.")}
        </small>
      </div>
    </div>
  );
}
