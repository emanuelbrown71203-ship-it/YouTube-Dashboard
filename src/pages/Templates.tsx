// The owner's own templates (what a title, a thumbnail or an intro of theirs should have), the AI's
// reading of an idea against them, ideas pasted in from a conversation, and Claude's connector.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NotesBox, RichNote } from "../components/notes.tsx";
import { Drawer, ErrorNote, Icon, Loading, Segmented, useToast } from "../components/ui.tsx";
import { ApiError, checkIdea, connector, fail, type PastedIdea, readPastedIdeas, saveIdea, type TemplateCheck } from "../lib/api.ts";
import { ago } from "../lib/format.ts";
import { checkCount, plainNote, untickAll } from "../lib/notes.ts";
import { supabase } from "../lib/supabase.ts";
import type { IdeaDraft } from "../lib/types.ts";

export type TemplateKind = "title" | "thumbnail" | "intro" | "other";
export interface Template {
  id: string;
  kind: TemplateKind;
  name: string;
  body: string;
  active: boolean;
  updated_at: string;
}
type TemplateDraft = Partial<Template> & { kind: TemplateKind; name: string; body: string };

const KINDS: { value: TemplateKind; label: string; plural: string; hint: string }[] = [
  { value: "title", label: "Title", plural: "Titles", hint: "Ask a question or set a rule\nName the game\nUnder 60 characters" },
  { value: "thumbnail", label: "Thumbnail", plural: "Thumbnails", hint: "My face, reacting\nThree words at most\nOne clear thing to look at" },
  { value: "intro", label: "Intro", plural: "Intros", hint: "Open on the best moment\nSay the challenge in one sentence\nSay what is at stake" },
  { value: "other", label: "Other", plural: "Other", hint: "Anything else you hold your videos to" },
];
const kindOf = (kind: string) => KINDS.find((k) => k.value === kind) ?? KINDS[3];
const COLUMNS = "id, kind, name, body, active, updated_at";
const templatesKey = ["templates"];
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");

async function getTemplates(): Promise<Template[]> {
  const { data, error } = await supabase.from("yt_templates").select(COLUMNS).is("trashed_at", null).order("created_at").limit(100);
  fail(error);
  return (data ?? []) as unknown as Template[];
}

async function saveTemplate(draft: TemplateDraft): Promise<void> {
  const fields = { kind: draft.kind, name: draft.name.trim(), body: draft.body.trim(), active: draft.active ?? true };
  if (!fields.name) throw new ApiError("Give the template a name first.", "bad_request");
  if (!fields.body) throw new ApiError("Write the template first.", "bad_request");
  const { error } = draft.id
    ? await supabase.from("yt_templates").update(fields).eq("id", draft.id)
    : await supabase.from("yt_templates").insert(fields);
  fail(error);
}

async function patchTemplate(id: string, fields: { active?: boolean; trashed_at?: string | null; body?: string }): Promise<void> {
  const { error } = await supabase.from("yt_templates").update(fields).eq("id", id);
  fail(error);
}

export const useTemplates = () => useQuery({ queryKey: templatesKey, queryFn: getTemplates });

/** A template as plain text, ready to send to someone. */
export function templateText(list: Template[]): string {
  return list.map((t) => `${t.name} (${kindOf(t.kind).label.toLowerCase()} template)\n\n${plainNote(t.body)}`).join("\n\n\n");
}

/** Hands text to the phone's share sheet, or copies it where there is none. */
async function share(title: string, text: string, toast: ReturnType<typeof useToast>) {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it into a message to send it.");
  } catch (err) {
    // Closing the share sheet is not a failure.
    if ((err as { name?: string })?.name !== "AbortError") toast("Could not share that. Select the text and copy it instead.", { error: true });
  }
}

function TemplateEditor({ draft, onClose, onSaved }: { draft: TemplateDraft; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<TemplateDraft>(draft);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) => setForm((f) => ({ ...f, [key]: value }));
  const run = async (work: Promise<void>) => {
    setSaving(true);
    try {
      await work;
      onSaved();
      onClose();
    } catch (err) {
      toast(message(err), { error: true });
    }
    setSaving(false);
  };
  return (
    <Drawer
      title={form.id ? "Edit template" : "New template"} onClose={onClose}
      footer={(
        <>
          {form.id ? <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void run(patchTemplate(form.id!, { trashed_at: new Date().toISOString() }))}>Move to bin</button> : <span />}
          <button type="button" className="btn btn-primary" disabled={saving || !form.name.trim() || !form.body.trim()} onClick={() => void run(saveTemplate(form))}>{saving ? "Saving" : "Save template"}</button>
        </>
      )}
    >
      <div className="field">
        <span>What it is for</span>
        <Segmented label="What it is for" value={form.kind} onChange={(v) => set("kind", v)} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
      </div>
      <label className="field">
        <span>Name</span>
        <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={`My ${kindOf(form.kind).label.toLowerCase()} template`} maxLength={120} />
      </label>
      <div className="field">
        <span>The template</span>
        <NotesBox alwaysEdit label="The template" value={form.body} onChange={(v) => set("body", v)} placeholder={kindOf(form.kind).hint} minHeight={220} maxLength={8000} />
        <small>
          Write it your way. One point per line works best, because the AI checks an idea against each point.
          Make the points checkboxes and the template becomes a checklist you can tick off as you work.
        </small>
      </div>
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" checked={form.active ?? true} onChange={(e) => set("active", e.target.checked)} />
        <span>Check my ideas against this template</span>
      </label>
    </Drawer>
  );
}

/** The page: every template, readable at a glance, with a way to send it to someone. */
export function Templates() {
  const templates = useTemplates();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey: templatesKey });
  // Ticking a box shows at once and is saved behind it; if the save fails the tick is put back.
  const rewrite = async (id: string, body: string) => {
    const before = queryClient.getQueryData<Template[]>(templatesKey);
    queryClient.setQueryData<Template[]>(templatesKey, (list) => (list ?? []).map((x) => (x.id === id ? { ...x, body } : x)));
    try {
      await patchTemplate(id, { body });
    } catch (err) {
      queryClient.setQueryData(templatesKey, before);
      toast(message(err), { error: true });
    }
  };
  if (templates.isLoading) return <Loading label="Loading your templates" />;
  if (templates.error) return <ErrorNote error={templates.error} retry={() => void templates.refetch()} />;
  const list = templates.data ?? [];
  return (
    <>
      <p className="soft" style={{ maxWidth: "70ch", marginBottom: 14 }}>
        What your titles, thumbnails and intros should have, written once so you can follow it every time. Each idea can be checked against them, and you can send any of them to someone else.
      </p>
      <div className="row-wrap" style={{ marginBottom: 18 }}>
        {KINDS.map((k) => (
          <button key={k.value} type="button" className="btn" onClick={() => setEditing({ kind: k.value, name: "", body: "", active: true })}><Icon name="plus" />{k.label} template</button>
        ))}
        {list.length > 1 ? <button type="button" className="btn btn-quiet" onClick={() => void share("My video templates", templateText(list), toast)}>Share all of them</button> : null}
      </div>
      {list.length === 0 ? (
        <div className="panel"><div className="empty"><h3>No templates yet</h3><p>Start with the one you repeat most: what every title of yours should have, or how every intro should open.</p></div></div>
      ) : KINDS.map((k) => {
        const mine = list.filter((t) => t.kind === k.value);
        if (mine.length === 0) return null;
        return (
          <section className="section" key={k.value} style={{ marginTop: 0, marginBottom: 22 }}>
            <div className="section-head"><h2>{k.plural}</h2></div>
            <div className="stack" style={{ gap: 10 }}>
              {mine.map((t) => (
                <article className="panel panel-pad template" key={t.id}>
                  <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{t.name}</h3>
                      <div className="small muted">
                        {t.active ? "Ideas are checked against it" : "Not used for checking"}, changed {ago(t.updated_at)}
                        {checkCount(t.body).total ? `. ${checkCount(t.body).done} of ${checkCount(t.body).total} ticked` : ""}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flex: "none" }}>
                      <button type="button" className="btn btn-small" onClick={() => void share(t.name, templateText([t]), toast)}>Share</button>
                      <button type="button" className="btn btn-small" onClick={() => setEditing(t)}>Edit</button>
                    </div>
                  </div>
                  <RichNote className="template-body" text={t.body} onChange={(body) => void rewrite(t.id, body)} />
                  {checkCount(t.body).done ? (
                    <div style={{ marginTop: 10 }}><button type="button" className="btn btn-quiet btn-small" onClick={() => void rewrite(t.id, untickAll(t.body))}>Untick all, to start over</button></div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
      {editing ? <TemplateEditor draft={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </>
  );
}

/** Inside the idea editor: the owner's template for the field they are filling in, one tap away. */
export function TemplateHint({ kind }: { kind: TemplateKind }) {
  const templates = useTemplates();
  const mine = (templates.data ?? []).filter((t) => t.kind === kind && t.active);
  if (mine.length === 0) return null;
  return (
    <details className="template-hint">
      <summary>My {kindOf(kind).label.toLowerCase()} template</summary>
      {mine.map((t) => (
        <div key={t.id} style={{ marginTop: 8 }}>
          {mine.length > 1 ? <strong>{t.name}</strong> : null}
          <RichNote className="template-body" text={t.body} />
        </div>
      ))}
    </details>
  );
}

/** Inside the idea editor: the AI's reading of the idea against the templates. */
export function TemplateScore(props: { idea: IdeaDraft; dirty: boolean; onChecked: (check: TemplateCheck, at: string) => void }) {
  const toast = useToast();
  const templates = useTemplates();
  const [busy, setBusy] = useState(false);
  const active = (templates.data ?? []).filter((t) => t.active);
  const check = props.idea.template_check ?? null;
  const run = async () => {
    if (!props.idea.id) return;
    setBusy(true);
    try {
      const out = await checkIdea(props.idea.id);
      props.onChecked({ score: out.score, checks: out.checks }, new Date().toISOString());
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  if (templates.isLoading) return null;
  if (active.length === 0) {
    return (
      <div className="score-block">
        <div style={{ fontWeight: 650 }}>Your templates</div>
        <div className="small soft" style={{ marginTop: 4 }}>
          Write down what your titles, thumbnails and intros should have, and each idea can be scored against it. <a href="#/playbook">Open Templates</a>
        </div>
      </div>
    );
  }
  return (
    <div className="score-block">
      <div className="row between" style={{ alignItems: "flex-end", gap: 10 }}>
        <div><div style={{ fontWeight: 650 }}>Your templates</div><div className="small muted">Does it follow the standards you wrote down?</div></div>
        {check ? (
          <div style={{ textAlign: "right", flex: "none" }}>
            <div className={`score-figure fig ${check.score >= 75 ? "high" : check.score >= 55 ? "mid" : check.score >= 40 ? "even" : "low"}`}>{check.score}</div>
            <div className="small muted">out of 100</div>
          </div>
        ) : null}
      </div>
      {check ? (
        <ul className="score-parts">
          {check.checks.map((c) => (
            <li key={c.template_id}>
              <div className="row between" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{c.name}</span><span className="small muted fig">{c.score} of 100</span></div>
              <div className="score-bar"><i style={{ width: `${c.score}%` }} /></div>
              {c.met.length ? <div className="small soft">Has: {c.met.join("; ")}.</div> : null}
              {c.missing.length ? <div className="small soft">Missing: {c.missing.join("; ")}.</div> : null}
              {c.fix ? <div className="small" style={{ marginTop: 2 }}>{c.fix}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row-wrap" style={{ marginTop: 10, gap: 10 }}>
        <button type="button" className="btn btn-small" disabled={busy || !props.idea.id || props.dirty} onClick={() => void run()}>
          {busy ? "Checking" : check ? "Check again" : `Check against my ${active.length === 1 ? "template" : `${active.length} templates`}`}
        </button>
        <span className="small muted">
          {!props.idea.id || props.dirty ? "Save the idea first, then check it." : check && props.idea.template_checked_at ? `Checked ${ago(props.idea.template_checked_at)}. The AI reads only the text of the idea.` : "The AI reads the idea's title, hook and thumbnail idea. It uses your Claude key."}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ideas pasted in from a conversation with Claude
// ---------------------------------------------------------------------------

export function ImportIdeas({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<(PastedIdea & { keep: boolean })[] | null>(null);
  const read = async () => {
    setBusy(true);
    try {
      const out = await readPastedIdeas(text);
      setFound(out.ideas.map((i) => ({ ...i, keep: true })));
      if (out.ideas.length === 0) toast("No video ideas were found in that text.", { error: true });
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  const keep = (found ?? []).filter((i) => i.keep);
  const add = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const { keep: _keep, ...idea } of keep) {
        await saveIdea({ ...idea, status: "idea", priority: 2, source: "claude" } as IdeaDraft);
        done++;
      }
      onAdded();
      toast(`${done} ${done === 1 ? "idea" : "ideas"} added to your board.`);
      onClose();
    } catch (err) {
      if (done) onAdded();
      toast(`${done ? `${done} added, then it stopped. ` : ""}${message(err)}`, { error: true });
    }
    setBusy(false);
  };
  const change = (index: number, fields: Partial<PastedIdea & { keep: boolean }>) => setFound((list) => (list ?? []).map((i, j) => (j === index ? { ...i, ...fields } : i)));
  return (
    <Drawer
      title="Import ideas" onClose={onClose}
      footer={found?.length ? (
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => setFound(null)}>Paste something else</button>
          <button type="button" className="btn btn-primary" disabled={busy || keep.length === 0} onClick={() => void add()}>{busy ? "Adding" : `Add ${keep.length} ${keep.length === 1 ? "idea" : "ideas"}`}</button>
        </>
      ) : (
        <>
          <span />
          <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 10} onClick={() => void read()}>{busy ? "Reading" : "Find the ideas"}</button>
        </>
      )}
    >
      {found?.length ? (
        <>
          <p className="soft" style={{ margin: 0 }}>Untick any you do not want. You can change the game here and the rest once they are on the board.</p>
          {found.map((idea, i) => (
            <div key={i} className="title-idea" style={{ opacity: idea.keep ? 1 : 0.55 }}>
              <label className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <input type="checkbox" checked={idea.keep} onChange={(e) => change(i, { keep: e.target.checked })} style={{ marginTop: 4 }} />
                <span className="grow">
                  <span style={{ fontWeight: 600, lineHeight: 1.3, display: "block" }}>{idea.title}</span>
                  <span className="small muted">{idea.format === "short" ? "Short" : "Long-form"}{idea.concept ? `. ${idea.concept}` : ""}</span>
                </span>
              </label>
              <input className="input" style={{ marginTop: 8 }} value={idea.topic ?? ""} onChange={(e) => change(i, { topic: e.target.value || null })} placeholder="Game or topic" aria-label={`Game for ${idea.title}`} maxLength={80} />
            </div>
          ))}
        </>
      ) : (
        <>
          <p className="soft" style={{ margin: 0 }}>
            Paste a conversation with Claude, or any notes, and the AI pulls out the video ideas for you to look over before anything is added. It uses your Claude key.
          </p>
          <label className="field">
            <span>The text</span>
            <textarea className="textarea" style={{ minHeight: 260 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here" maxLength={24000} autoFocus />
          </label>
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Claude's connector, in Settings
// ---------------------------------------------------------------------------

export function ClaudeConnector() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["connector"], queryFn: () => connector("status") });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: "create" | "remove") => {
    if (action === "create" && state.data?.connected && !window.confirm("Make a new address? The old one stops working, so you would add the connector to Claude again.")) return;
    setBusy(true);
    try {
      const out = await connector(action);
      setUrl(out.url ?? null);
      void queryClient.invalidateQueries({ queryKey: ["connector"] });
      toast(action === "create" ? "The connector address is ready." : "The connector is switched off.");
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? "");
      toast("Copied.");
    } catch {
      toast("Could not copy. Press and hold the address to copy it.", { error: true });
    }
  };
  useEffect(() => () => setUrl(null), []);
  const on = Boolean(state.data?.connected);
  return (
    <div className="stack">
      <p className="soft" style={{ maxWidth: "70ch" }}>
        Lets you talk to Claude in the Claude app and have it put things straight into this dashboard: video ideas filed under their game, lines to remember, and templates.
        Claude can also read your channel's numbers, so its advice rests on them. It cannot remove anything or see any of your keys.
      </p>
      <p className="small muted">
        {state.isLoading ? "Checking" : on
          ? `On${state.data?.used_at ? `. Claude last used it ${ago(state.data.used_at)}` : ". Claude has not used it yet"}.`
          : "Off."}
      </p>
      {url ? (
        <div className="notice plain" style={{ margin: 0, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <strong>Your connector address</strong>
          <code className="secret-url">{url}</code>
          <div><button type="button" className="btn btn-small" onClick={() => void copy()}>Copy the address</button></div>
          <ol className="small soft" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
            <li>In the Claude app, open Settings, then Connectors.</li>
            <li>Choose Add custom connector.</li>
            <li>Name it YouTube Dashboard and paste this address.</li>
            <li>In a chat, say something like "add this idea to my dashboard".</li>
          </ol>
          <span className="small muted">This address is shown only now. Treat it like a password: anyone who has it can add to your dashboard. If it gets out, make a new one here and the old one stops working.</span>
        </div>
      ) : null}
      <div className="row-wrap">
        <button type="button" className="btn" disabled={busy || state.isLoading} onClick={() => void run("create")}>{on ? "Make a new address" : "Switch on and get the address"}</button>
        {on ? <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run("remove")}>Switch off</button> : null}
      </div>
    </div>
  );
}


