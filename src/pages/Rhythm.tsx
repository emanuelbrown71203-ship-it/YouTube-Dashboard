// Upload rhythm: the owner's target per format, set on the Goals page and shown on Home. Each format
// stands on its own; nothing here ever adds Shorts, long-form videos and streams together.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useToast } from "../components/ui.tsx";
import { getRhythm, setRhythm } from "../lib/api.ts";
import { useIdeas, useVideos } from "../lib/hooks.ts";
import { daysSince, rhythmStatus, targetChoices, usualGap } from "../lib/rhythm.ts";
import type { Format } from "../lib/types.ts";

export const rhythmKey = ["rhythm"];
export const useRhythm = () => useQuery({ queryKey: rhythmKey, queryFn: getRhythm });

const FORMATS: { key: Format; label: string; one: string }[] = [
  { key: "long", label: "Long-form", one: "long video" },
  { key: "short", label: "Shorts", one: "Short" },
  { key: "live", label: "Streams", one: "stream" },
];
const STAGE: Record<string, string> = { idea: "picked", scripting: "scripting", filming: "filming", editing: "editing", scheduled: "scheduled" };
const ago = (days: number | null, one: string) => (days === null ? `No ${one} yet` : days === 0 ? `Last ${one} today` : `Last ${one} ${days} ${days === 1 ? "day" : "days"} ago`);

/** Goals page: a target per format, with the owner's own pace as a guide. */
export function RhythmSettings() {
  const rhythm = useRhythm();
  const videos = useVideos();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = Date.now();
  const save = async (format: Format, value: string) => {
    try {
      await setRhythm(format, value === "" ? null : Number(value));
      await queryClient.invalidateQueries({ queryKey: rhythmKey });
      toast(value === "" ? "Target switched off." : "Target saved. Home shows how you are doing against it.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "The target could not be saved. Try again.", { error: true });
    }
  };
  return (
    <div className="section" style={{ marginTop: 20 }}>
      <div className="section-head"><h2>Upload rhythm</h2></div>
      <p className="soft" style={{ margin: "0 0 10px", maxWidth: "70ch" }}>
        How often you want to post each kind of video. Home shows how long it has been against it.
      </p>
      <div className="panel">
        {FORMATS.map((f) => {
          const target = (rhythm.data ?? []).find((r) => r.format === f.key && r.active);
          const usual = usualGap(videos.data ?? [], f.key, now);
          return (
            <div key={f.key} className="item rhythm-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">{f.label}</div>
                <div className="meta">
                  {ago(daysSince(videos.data ?? [], f.key, now), f.one)}.
                  {usual ? ` Over the last year you posted one about every ${usual} ${usual === 1 ? "day" : "days"}.` : ""}
                </div>
              </div>
              <select
                className="select input" aria-label={`${f.label} target`} value={target ? String(target.every_days) : ""}
                onChange={(e) => void save(f.key, e.target.value)} disabled={rhythm.isLoading}
              >
                <option value="">No target</option>
                {targetChoices(usual).concat(target && !targetChoices(usual).includes(target.every_days) ? [target.every_days] : []).map((d) => (
                  <option key={d} value={d}>Every {d} days{d === usual ? " (your usual)" : ""}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Home: each format with a target, against how long it has been. Nothing when no target is set. */
export function RhythmCard() {
  const rhythm = useRhythm();
  const videos = useVideos();
  const ideas = useIdeas();
  const targets = (rhythm.data ?? []).filter((r) => r.active);
  const now = Date.now();
  const next = useMemo(() => {
    // The furthest-along idea the owner is making, per format.
    const order = ["scheduled", "editing", "filming", "scripting", "idea"];
    const by = new Map<string, { title: string; status: string }>();
    for (const i of [...(ideas.data ?? [])].filter((i) => i.picked_at && i.status !== "published").sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))) {
      if (!by.has(i.format)) by.set(i.format, { title: i.title, status: i.status });
    }
    return by;
  }, [ideas.data]);
  if (targets.length === 0 || !videos.data) return null;
  return (
    <div className="panel panel-pad stack rhythm-card" style={{ gap: 12, marginBottom: 22 }}>
      <div className="row between" style={{ gap: 8 }}>
        <strong>Upload rhythm</strong>
        <a className="small" href="#/goals">Change</a>
      </div>
      {FORMATS.filter((f) => targets.some((t) => t.format === f.key)).map((f) => {
        const target = targets.find((t) => t.format === f.key)!;
        const s = rhythmStatus(target, videos.data!, now);
        const up = next.get(f.key);
        return (
          <div key={f.key} className="stack" style={{ gap: 4 }}>
            <div className="row between" style={{ gap: 8 }}>
              <span style={{ fontWeight: 650 }}>{f.label}</span>
              <span className="small muted">Every {target.every_days} days</span>
            </div>
            <div className="meter" role="img" aria-label={`${s.since ?? "No"} days since the last one, target every ${target.every_days} days`}>
              <i style={{ width: `${Math.round(s.share * 100)}%`, background: s.late ? "var(--bad)" : "var(--accent)" }} />
            </div>
            <div className="small">
              <span className={s.late ? "rhythm-late" : undefined}>{ago(s.since, f.one)}. {s.words}</span>
              {up ? <span className="muted"> Next up: {up.title} ({STAGE[up.status] ?? up.status}).</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
