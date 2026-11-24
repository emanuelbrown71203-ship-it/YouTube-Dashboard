// The owner's own scripts, kept so the script starter writes the way they write: their intros, the beats
// they hand their editor and the voiceover they write against the cut.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RichNote } from "../components/notes.tsx";
import { Drawer, ErrorNote, Icon, Loading, useToast } from "../components/ui.tsx";
import { ApiError, fail } from "../lib/api.ts";
import { ago, multiple, whole } from "../lib/format.ts";
import { useVideos } from "../lib/hooks.ts";
import { guessVideo, scriptVideos } from "../lib/scriptMatch.ts";
import { supabase } from "../lib/supabase.ts";
import type { Video } from "../lib/types.ts";

export interface Script {
  id: string;
  title: string;
  body: string;
  topic: string | null;
  source_url: string | null;
  /** The upload it was for, so how that video did counts when the AI reads the owner's track record. */
  video_id: string | null;
  created_at: string;
}
type ScriptDraft = Partial<Script> & { title: string; body: string };

const COLUMNS = "id, title, body, topic, source_url, video_id, created_at";
const scriptsKey = ["scripts"];
/** Long enough for an hour-long video's script. */
const MAX_LENGTH = 60000;

async function getScripts(): Promise<Script[]> {
  const { data, error } = await supabase.from("yt_scripts").select(COLUMNS).is("trashed_at", null).order("created_at", { ascending: false }).limit(200);
  fail(error);
  return (data ?? []) as unknown as Script[];
}

async function saveScript(draft: ScriptDraft): Promise<void> {
  const title = draft.title.trim(), body = draft.body.trim();
  if (!title) throw new ApiError("Give the script a name first, such as the video it was for.", "bad_request");
  if (!body) throw new ApiError("Paste the script in first.", "bad_request");
  const url = draft.source_url?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new ApiError("The link should start with https://", "bad_request");
  const fields = { title, body: body.slice(0, MAX_LENGTH), topic: draft.topic?.trim() || null, source_url: url, video_id: draft.video_id || null };
  const { error } = draft.id
    ? await supabase.from("yt_scripts").update(fields).eq("id", draft.id)
    : await supabase.from("yt_scripts").insert(fields);
  fail(error);
}

async function binScript(id: string): Promise<void> {
  const { error } = await supabase.from("yt_scripts").update({ trashed_at: new Date().toISOString() }).eq("id", id);
  fail(error);
}

const useScripts = () => useQuery({ queryKey: scriptsKey, queryFn: getScripts });
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** "For: <title>, 9.2x your usual" for a script tied to an upload. */
function forVideo(id: string | null, videos: Video[]): string | null {
  const v = id ? videos.find((x) => x.id === id) : null;
  return v ? `For "${v.title}"${v.vs_typical !== null ? `, ${multiple(v.vs_typical)} your usual` : ""}` : null;
}

export function Scripts() {
  const scripts = useScripts();
  const videos = useVideos();
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<Script | null>(null);
  const [editing, setEditing] = useState<ScriptDraft | null>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey: scriptsKey });
  if (scripts.isLoading) return <Loading label="Loading your scripts" />;
  if (scripts.error) return <ErrorNote error={scripts.error} retry={() => void scripts.refetch()} />;
  const list = scripts.data ?? [];
  return (
    <>
      <div className="row-wrap between" style={{ marginBottom: 14, gap: 10 }}>
        <p className="soft grow" style={{ maxWidth: "70ch", margin: 0 }}>
          Scripts you wrote for past videos. Draft a script, in the idea editor, reads the closest ones (the same game first) so the draft sounds like you. Say which video each was for, and how that video did counts when your intros and scripts are scored. Paste in each new one after the video goes up.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ title: "", body: "" })}><Icon name="plus" />Add a script</button>
      </div>
      <div className="panel">
        {list.length === 0 ? (
          <div className="empty"><h3>No scripts yet</h3><p>Paste in a script you wrote for a past video and the script starter will learn how you write.</p></div>
        ) : list.map((s) => (
          <button key={s.id} type="button" className="item script-row" onClick={() => setReading(s)}>
            <span className="grow" style={{ minWidth: 0, textAlign: "left" }}>
              <span className="title clip" style={{ display: "block", fontWeight: 600 }}>{s.title}</span>
              <span className="meta row-wrap small muted">
                {s.topic ? <span className="tag">{s.topic}</span> : null}
                <span>{whole(words(s.body))} words</span>
                {s.video_id ? <span className="clip">{forVideo(s.video_id, videos.data ?? [])}</span> : <span>Not tied to a video</span>}
                <span>Added {ago(s.created_at)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {reading ? (
        <ScriptReader
          script={reading} onClose={() => setReading(null)}
          onEdit={() => { setEditing(reading); setReading(null); }}
          onBinned={() => { setReading(null); reload(); }}
        />
      ) : null}
      {editing ? <ScriptEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </>
  );
}

function ScriptReader(props: { script: Script; onClose: () => void; onEdit: () => void; onBinned: () => void }) {
  const toast = useToast();
  const videos = useVideos();
  const s = props.script;
  const bin = async () => {
    try {
      await binScript(s.id);
      toast("Moved to the bin.");
      props.onBinned();
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  return (
    <Drawer
      title={s.title} onClose={props.onClose}
      footer={(
        <>
          <button type="button" className="btn btn-danger" onClick={() => void bin()}>Move to bin</button>
          <button type="button" className="btn btn-primary" onClick={props.onEdit}>Edit</button>
        </>
      )}
    >
      <p className="small muted" style={{ margin: 0 }}>
        {[s.topic, `${whole(words(s.body))} words`, forVideo(s.video_id, videos.data ?? [])].filter(Boolean).join(", ")}
        {s.source_url ? <> · <a href={s.source_url} target="_blank" rel="noreferrer">Open the original</a></> : null}
      </p>
      <div className="script-body"><RichNote text={s.body} /></div>
    </Drawer>
  );
}

function ScriptEditor(props: { draft: ScriptDraft; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const videos = useVideos();
  const [form, setForm] = useState<ScriptDraft>(props.draft);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ScriptDraft>(key: K, value: ScriptDraft[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      await saveScript(form);
      toast("Script saved.");
      props.onSaved();
    } catch (err) {
      toast(message(err), { error: true });
    }
    setSaving(false);
  };
  return (
    <Drawer
      title={form.id ? "Edit script" : "Add a script"} onClose={props.onClose}
      footer={(
        <>
          <span />
          <button type="button" className="btn btn-primary" disabled={saving || !form.title.trim() || !form.body.trim()} onClick={() => void save()}>{saving ? "Saving" : "Save script"}</button>
        </>
      )}
    >
      <label className="field">
        <span>What it was for</span>
        <input className="input" value={form.title} maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder="Cuphead 1 HP" />
      </label>
      <label className="field">
        <span>Game</span>
        <input className="input" value={form.topic ?? ""} maxLength={80} onChange={(e) => set("topic", e.target.value)} placeholder="Elden Ring" />
      </label>
      <label className="field">
        <span>The script</span>
        <textarea className="textarea" style={{ minHeight: 280 }} value={form.body} maxLength={MAX_LENGTH} onChange={(e) => set("body", e.target.value)} placeholder="Paste it here: the intro, the beats, the voiceover, your notes for the editor" />
      </label>
      <VideoPicker form={form} videos={videos.data ?? []} onPick={(id) => set("video_id", id)} />
      <label className="field">
        <span>Link to the original (optional)</span>
        <input className="input" type="url" value={form.source_url ?? ""} onChange={(e) => set("source_url", e.target.value)} placeholder="https://docs.google.com/..." />
      </label>
    </Drawer>
  );
}

/** Which upload the script was for: a list of long-form videos (same game first), with the likely one offered, never chosen for them. */
function VideoPicker(props: { form: ScriptDraft; videos: Video[]; onPick: (id: string | null) => void }) {
  const list = scriptVideos(props.videos, props.form.topic);
  const guess = props.form.video_id ? null : guessVideo({ title: props.form.title, topic: props.form.topic }, props.videos);
  return (
    <label className="field">
      <span>The video it was for</span>
      <select className="select input" value={props.form.video_id ?? ""} onChange={(e) => props.onPick(e.target.value || null)}>
        <option value="">Not tied to a video</option>
        {list.map((v) => <option key={v.id} value={v.id}>{v.title}{v.vs_typical !== null ? ` (${multiple(v.vs_typical)} your usual)` : ""}</option>)}
      </select>
      {guess ? (
        <small>
          Looks like "{guess.title}". <button type="button" className="btn btn-quiet btn-small" onClick={() => props.onPick(guess.id)}>That's the one</button>
        </small>
      ) : <small>How that video did counts when your intros and scripts are scored. Leave it empty for an outline you have not made yet.</small>}
    </label>
  );
}
