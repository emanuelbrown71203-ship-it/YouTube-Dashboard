// The overview's main chart: a measure over time, stacked by format, with a
// pin under every day something was uploaded. Subscribers get their own mode
// (gained above the line, lost below). Hover, touch or arrow keys read a day.

import { useEffect, useMemo, useRef, useState } from "react";
import { compact, day as formatDay, FORMAT_PLURAL } from "../lib/format.ts";
import type { SeriesKey, TimelinePoint } from "../lib/stats.ts";
import type { Format } from "../lib/types.ts";

export interface UploadPin {
  date: string;
  title: string;
  format: Format | null;
}

interface Props {
  points: TimelinePoint[];
  mode: "stack" | "subs";
  series: SeriesKey[];
  /** What one unit is called in the tooltip and table: "views", "hours". */
  unit: string;
  uploads: UploadPin[];
  weekly: boolean;
  value: (n: number) => string;
}

const seriesLabel = (key: SeriesKey, series: SeriesKey[]) => (key === "other" ? (series.length > 1 ? "Other" : "All formats") : FORMAT_PLURAL[key]);

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  const unit = n / pow;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * pow;
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function Timeline({ points, mode, series, unit, uploads, weekly, value }: Props) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const n = points.length;

  const height = width < 560 ? 236 : 292;
  const pad = { left: 46, right: 14, top: 14, bottom: 50 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const scale = useMemo(() => {
    if (mode === "subs") {
      const up = niceCeil(Math.max(1, ...points.map((p) => p.gained)));
      const down = niceCeil(Math.max(1, ...points.map((p) => p.lost)));
      return { max: up, min: -down };
    }
    return { max: niceCeil(Math.max(1, ...points.map((p) => p.total))), min: 0 };
  }, [points, mode]);

  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v: number) => pad.top + plotH * (1 - (v - scale.min) / (scale.max - scale.min));

  const pins = useMemo(() => {
    const byIndex = new Map<number, UploadPin[]>();
    for (const u of uploads) {
      const i = points.findIndex((p) => u.date >= p.date && u.date <= p.end);
      if (i < 0) continue;
      const list = byIndex.get(i);
      if (list) list.push(u);
      else byIndex.set(i, [u]);
    }
    return byIndex;
  }, [uploads, points]);

  const bands = useMemo(() => {
    if (mode !== "stack" || n === 0) return [];
    const base = new Array(n).fill(0);
    return series.map((key) => {
      const lower = [...base];
      points.forEach((p, i) => (base[i] += p[key]));
      const upper = [...base];
      return { key, lower, upper };
    });
  }, [points, series, mode, n]);

  const ticks = mode === "subs" ? [scale.min, 0, scale.max] : [0, scale.max / 2, scale.max];
  const labelEvery = Math.max(1, Math.ceil(n / (width < 560 ? 4 : 7)));
  const label = (p: TimelinePoint) => (weekly && p.end !== p.date ? `${formatDay(p.date)} to ${formatDay(p.end)}` : formatDay(p.date));

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || n === 0) return;
    const ratio = (clientX - box.left - pad.left) / plotW;
    setActive(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
  };

  const current = active !== null ? points[active] : null;
  const tipLeft = active !== null ? x(active) : 0;
  const tipOnLeft = tipLeft > width * 0.6;
  const barW = Math.max(1, Math.min(24, plotW / Math.max(n, 1) - 2));

  if (n === 0) {
    return <div className="empty"><h3>Nothing to chart yet</h3><p>Numbers appear here after the first sync from YouTube.</p></div>;
  }

  return (
    <div>
      <div className="chart-head">
        <div className="legend">
          {mode === "stack"
            ? series.map((key) => (
              <span className="key" key={key}><span className="swatch" style={{ background: `var(--s-${key})` }} />{seriesLabel(key, series)}</span>
            ))
            : (
              <>
                <span className="key"><span className="swatch" style={{ background: "var(--s-short)" }} />Gained</span>
                <span className="key"><span className="swatch" style={{ background: "var(--bad)" }} />Lost</span>
              </>
            )}
          {pins.size > 0 ? <span className="key"><span className="pin" style={{ background: "var(--ink-2)" }} />Upload</span> : null}
          {weekly ? <span className="muted">per week</span> : null}
        </div>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {asTable ? (
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{weekly ? "Week" : "Day"}</th>
                {mode === "stack"
                  ? <>{series.length > 1 ? <th className="num">Total</th> : null}{series.map((k) => <th className="num" key={k}>{seriesLabel(k, series)}</th>)}</>
                  : <><th className="num">Gained</th><th className="num">Lost</th></>}
                <th>Uploads</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => {
                const i = points.indexOf(p);
                return (
                  <tr key={p.date}>
                    <td>{label(p)}</td>
                    {mode === "stack"
                      ? <>{series.length > 1 ? <td className="num">{value(p.total)}</td> : null}{series.map((k) => <td className="num" key={k}>{value(p[k])}</td>)}</>
                      : <><td className="num">{p.gained}</td><td className="num">{p.lost}</td></>}
                    <td className="small soft">{(pins.get(i) ?? []).map((u) => u.title).join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" ref={ref}>
          {width > 0 ? (
            <svg
              height={height}
              role="img"
              tabIndex={0}
              aria-label={`${unit} ${weekly ? "per week" : "per day"} from ${formatDay(points[0].date)} to ${formatDay(points[n - 1].end)}. Use the left and right arrow keys to read each point.`}
              onPointerMove={(e) => pick(e.clientX)}
              onPointerDown={(e) => pick(e.clientX)}
              onPointerLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
                else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
                else if (e.key === "Escape") setActive(null);
                else return;
                e.preventDefault();
              }}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line className={t === 0 ? "axis" : "grid"} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
                  <text x={pad.left - 8} y={y(t) + 4} textAnchor="end">{t < 0 ? `−${compact(-t)}` : compact(t)}</text>
                </g>
              ))}
              {points.map((p, i) => (i % labelEvery === 0 && x(i) < width - 30
                ? <text key={p.date} x={x(i)} y={pad.top + plotH + 17} textAnchor={i === 0 ? "start" : "middle"}>{formatDay(p.date)}</text>
                : null))}

              {mode === "stack" && n > 1
                ? bands.map((b) => {
                  const top = b.upper.map((v, i) => `${x(i)},${y(v)}`);
                  const bottom = b.lower.map((v, i) => `${x(i)},${y(v)}`).reverse();
                  return <polygon key={b.key} points={[...top, ...bottom].join(" ")} fill={`var(--s-${b.key})`} opacity={0.17} />;
                })
                : null}
              {/* Edges are drawn top band first, so where a small format adds nothing the line shown is the big one's. */}
              {mode === "stack" && n > 1
                ? [...bands].reverse().map((b) => (
                  <polyline
                    key={b.key} points={b.upper.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none"
                    stroke={`var(--s-${b.key})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  />
                ))
                : null}
              {mode === "stack" && n === 1
                ? <circle cx={x(0)} cy={y(points[0].total)} r={5} fill="var(--s-short)" stroke="var(--surface)" strokeWidth={2} />
                : null}
              {mode === "subs"
                ? points.map((p, i) => (
                  <g key={p.date}>
                    {p.gained > 0 ? <rect x={x(i) - barW / 2} width={barW} y={y(p.gained)} height={y(0) - y(p.gained)} fill="var(--s-short)" rx={Math.min(4, barW / 2)} /> : null}
                    {p.lost > 0 ? <rect x={x(i) - barW / 2} width={barW} y={y(0)} height={y(-p.lost) - y(0)} fill="var(--bad)" rx={Math.min(4, barW / 2)} /> : null}
                  </g>
                ))
                : null}

              {[...pins.entries()].map(([i, list]) => {
                const formats = new Set(list.map((u) => u.format));
                return (
                  <circle
                    key={i} cx={x(i)} cy={pad.top + plotH + 36} r={active === i ? 6 : 4.5}
                    fill={formats.size === 1 && list[0].format ? `var(--s-${list[0].format})` : "var(--ink-2)"}
                    stroke="var(--surface)" strokeWidth={2}
                  />
                );
              })}

              {active !== null ? (
                <g>
                  <line className="cross" x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotH} />
                  {mode === "stack" && n > 1
                    ? bands.map((b) => (
                      <circle key={b.key} cx={x(active)} cy={y(b.upper[active])} r={4} fill={`var(--s-${b.key})`} stroke="var(--surface)" strokeWidth={2} />
                    ))
                    : null}
                </g>
              ) : null}
            </svg>
          ) : <div style={{ height }} />}

          {current && active !== null ? (
            <div className="tooltip" style={{ top: 6, ...(tipOnLeft ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }) }}>
              <div className="t-head">{label(current)}</div>
              {mode === "stack" ? (
                <>
                  {series.length > 1 ? (
                    <div className="t-row"><span className="t-key">Total</span><span className="t-val">{value(current.total)} {unit}</span></div>
                  ) : null}
                  {series.map((key) => (
                    <div className="t-row" key={key}>
                      <span className="t-key"><i style={{ background: `var(--s-${key})` }} />{seriesLabel(key, series)}</span>
                      <span className="t-val">{value(current[key])}{series.length === 1 ? ` ${unit}` : ""}</span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="t-row"><span className="t-key"><i style={{ background: "var(--s-short)" }} />Gained</span><span className="t-val">{current.gained}</span></div>
                  <div className="t-row"><span className="t-key"><i style={{ background: "var(--bad)" }} />Lost</span><span className="t-val">{current.lost}</span></div>
                </>
              )}
              {pins.get(active)?.length ? (
                <div className="t-note">
                  {pins.get(active)!.slice(0, 3).map((u) => <div key={u.title + u.date} className="clip2">Uploaded: {u.title}</div>)}
                  {pins.get(active)!.length > 3 ? <div>and {pins.get(active)!.length - 3} more</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** A bare trend line for a headline number. Decorative: the number beside it says the same. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 120, h = 28;
  const pts = values.map((v, i) => `${(w * i) / (values.length - 1)},${h - 2 - ((h - 4) * v) / max}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true" style={{ maxWidth: 140 }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Ranked horizontal bars: one hue, biggest first. */
export function BarList({ rows, value }: { rows: { label: string; value: number; hint?: string }[]; value: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <span className="clip" title={r.label}>{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ display: "block", width: `${(100 * r.value) / max}%` }} /></span>
          <span className="bar-val">{value(r.value)}{r.hint ? <span className="muted" style={{ fontWeight: 500 }}> {r.hint}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
