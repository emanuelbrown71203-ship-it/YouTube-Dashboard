// Upload rhythm: the owner's target per format, set on the Goals page and shown on Home. Each format
// stands on its own; nothing here ever adds Shorts, long-form videos and streams together.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/ui.tsx";
import { getRhythm, setRhythm } from "../lib/api.ts";
import { useVideos } from "../lib/hooks.ts";
import { daysSince, rhythmStatus, targetChoices, usualGap } from "../lib/rhythm.ts";
import type { Format } from "../lib/types.ts";

export const rhythmKey = ["rhythm"];
export const useRhythm = () => useQuery({ queryKey: rhythmKey, queryFn: getRhythm });

const FORMATS: { key: Format; label: string; one: string }[] = [
  { key: "long", label: "Long-form", one: "long video" },
  { key: "short", label: "Shorts", one: "Short" },
  { key: "live", label: "Streams", one: "stream" },
];
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

/** Home, inside This week: each format with a target, against how long it has been. Nothing when no target is set. */
export function RhythmRows() {
  const rhythm = useRhythm();
  const videos = useVideos();
  const targets = (rhythm.data ?? []).filter((r) => r.active);
  if (targets.length === 0 || !videos.data) return null;
  const now = Date.now();
  return (
    <div className="rhythm-rows">
      {FORMATS.filter((f) => targets.some((t) => t.format === f.key)).map((f) => {
        const target = targets.find((t) => t.format === f.key)!;
        const s = rhythmStatus(target, videos.data!, now);
        return (
          <div key={f.key} className="rhythm-line">
            <div className="row between" style={{ gap: 8 }}>
              <span className="rhythm-name">{f.label}</span>
              <span className="small muted">{s.since === null ? `No ${f.one} yet` : `${s.since} ${s.since === 1 ? "day" : "days"} since the last`}, target {target.every_days}</span>
            </div>
            <div className="meter thin" role="img" aria-label={`${s.since ?? "No"} days since the last one, target every ${target.every_days} days`}>
              <i style={{ width: `${Math.round(s.share * 100)}%`, background: s.late ? "var(--bad)" : "var(--accent)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
