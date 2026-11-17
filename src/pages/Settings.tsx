import { ClaudeConnector } from "./Templates.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { CopyLine, ErrorNote, Loading, Segmented, useTheme, useToast } from "../components/ui.tsx";
import {
  createAccessCode, currentUserId, disconnectYouTube, getBriefing, saveAiKey, saveGoogleClient, signOut, startGoogleSignIn, syncNow,
} from "../lib/api.ts";
import { ago, day } from "../lib/format.ts";
import { keys, useConnection, useOwners, useSyncRuns } from "../lib/hooks.ts";
import { FUNCTION_URL } from "../lib/supabase.ts";
import type { SyncRun } from "../lib/types.ts";

const STEP_LABEL: Record<string, string> = {
  channel: "Channel", videos: "Uploads", daily: "Daily numbers", formats: "Numbers by format", video_analytics: "Per-video numbers",
  recent_uploads: "New uploads day by day", reports: "Breakdowns", traffic: "Where views came from", watched_channels: "Channels you watch",
};
const SOURCE_LABEL: Record<string, string> = { cron: "Automatic", manual: "You pressed Sync", connect: "First sync", seed: "Starting snapshot" };

export function Settings({ onSignedOut }: { onSignedOut: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const connection = useConnection();
  const runs = useSyncRuns();
  const owners = useOwners();
  const me = useQuery({ queryKey: ["me"], queryFn: currentUserId });
  const [theme, setTheme] = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [editingClient, setEditingClient] = useState(false);

  const run = async (name: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    try {
      await work();
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not work. Try again.", { error: true });
    }
    setBusy(null);
  };

  if (connection.isLoading) return <Loading label="Loading settings" />;
  if (connection.error) return <ErrorNote error={connection.error} retry={() => void connection.refetch()} />;
  const c = connection.data!;
  const latest = runs.data?.[0];

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>

      <section>
        <div className="section-head"><h2>YouTube connection</h2></div>
        <div className="panel panel-pad stack">
          {c.connection_error ? <div className="notice error" role="alert" style={{ margin: 0 }}>{c.connection_error}</div> : null}

          {c.youtube_connected ? (
            <>
              <p>
                <strong>Connected{c.connected_at ? ` since ${day(c.connected_at)}` : ""}.</strong>{" "}
                <span className="soft">Your numbers refresh on their own every six hours.</span>
              </p>
              <div className="row-wrap">
                <button
                  type="button" className="btn btn-primary" disabled={busy !== null || latest?.status === "running"}
                  onClick={() => void run("sync", async () => {
                    const res = await syncNow();
                    await queryClient.invalidateQueries();
                    if (res.status === "busy") throw new Error("A sync is already running. Give it a minute.");
                    if (res.status === "error") throw new Error(res.message ?? "The sync failed.");
                  }, "Synced with YouTube.")}
                >
                  {busy === "sync" || latest?.status === "running" ? "Syncing with YouTube" : "Sync now"}
                </button>
                <button
                  type="button" className="btn btn-danger" disabled={busy !== null}
                  onClick={() => {
                    if (!window.confirm("Disconnect YouTube? Your stored numbers stay, but they stop updating and Research stops working until you connect again.")) return;
                    void run("disconnect", async () => {
                      await disconnectYouTube();
                      await queryClient.invalidateQueries({ queryKey: keys.connection });
                    }, "YouTube disconnected.");
                  }}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : c.google_configured && !editingClient ? (
            <>
              <p><strong>Almost there.</strong> <span className="soft">Sign in with the Google account that runs your channel.</span></p>
              <p className="soft small" style={{ maxWidth: "70ch" }}>
                Google will warn that the app is not verified. That is normal for an app only you use: choose Advanced, then continue.
                Leave every box ticked. Two are needed for your stats; one adds estimated earnings and one adds comments.
                Google words the comments one as managing your account, because it has no read-only version, but the dashboard only ever reads:
                it never posts, edits or removes anything. Untick it if you would rather not, and comments simply stay off.
              </p>
              <div className="row-wrap">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void run("google", async () => { window.location.assign((await startGoogleSignIn()).url); })}>
                  {busy === "google" ? "Opening Google" : "Sign in with Google"}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setEditingClient(true)}>Change the Google details</button>
              </div>
            </>
          ) : (
            <ConnectSteps
              clientId={c.google_client_id}
              onSaved={async () => {
                setEditingClient(false);
                await queryClient.invalidateQueries({ queryKey: keys.connection });
                toast("Saved. Now sign in with Google.");
              }}
              onCancel={c.google_configured ? () => setEditingClient(false) : undefined}
            />
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Recent syncs</h2></div>
        <div className="panel">
          {(runs.data ?? []).length === 0 ? <div className="empty"><h3>No syncs yet</h3><p>The first one runs as soon as YouTube is connected.</p></div> : null}
          {(runs.data ?? []).map((r) => <SyncRow key={r.id} run={r} />)}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Signed-in browsers</h2></div>
        <div className="panel">
          {(owners.data ?? []).map((o) => (
            <div className="item" key={o.user_id} style={{ alignItems: "center" }}>
              <div className="grow">
                <div className="title">{o.device ?? "A browser"}{o.user_id === me.data ? <span className="tag" style={{ marginLeft: 8 }}>This one</span> : null}</div>
                <div className="meta">Signed in {o.method === "google" ? "with Google" : "with a code"} {ago(o.created_at)}. Last used {ago(o.last_seen_at)}.</div>
              </div>
            </div>
          ))}
          <div className="panel-pad stack" style={{ borderTop: "1px solid var(--line)" }}>
            {code ? (
              <div>
                <p className="soft small" style={{ marginBottom: 6 }}>Open the dashboard on the other device and enter this. It works once, for the next 24 hours.</p>
                <CopyLine value={code} />
              </div>
            ) : null}
            <div className="row-wrap">
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void run("code", async () => setCode(await createAccessCode()))}>
                {busy === "code" ? "Making a code" : "Sign in another device"}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void run("out", async () => { await signOut(false); onSignedOut(); })}>Sign out here</button>
              <button
                type="button" className="btn btn-danger" disabled={busy !== null}
                onClick={() => {
                  if (window.confirm("Sign out every browser, including this one?")) void run("out-all", async () => { await signOut(true); onSignedOut(); });
                }}
              >
                Sign out everywhere
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Extras</h2></div>
        <div className="panel panel-pad stack">
          {c.youtube_connected ? (
            <p className="soft" style={{ maxWidth: "70ch" }}>
              Estimated earnings are <strong>{c.earnings ? "on" : "off"}</strong> and comments are <strong>{c.comments ? "on" : "off"}</strong>.
              {c.earnings && c.comments ? "" : " To switch one on, press Disconnect above, then sign in with Google again and leave every box ticked."}
            </p>
          ) : null}
          <AiKey on={Boolean(c.ai)} error={c.ai_error ?? null} onChanged={() => void queryClient.invalidateQueries({ queryKey: keys.connection })} />
          <ClaudeConnector />
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Claude</h2></div>
        <div className="panel panel-pad stack">
          <p className="soft" style={{ maxWidth: "70ch" }}>
            Claude can read everything on this dashboard: your numbers, every upload, your ideas and your research.
            In a Claude session with this project open, just ask. In any other chat, copy your current numbers and paste them in with your question.
          </p>
          <div>
            <button
              type="button" className="btn" disabled={busy !== null}
              onClick={() => void run("brief", async () => {
                const briefing = await getBriefing();
                await navigator.clipboard.writeText(`Here is a snapshot of my YouTube channel, ideas and research as JSON. Use it to answer my questions.\n\n${JSON.stringify(briefing)}`);
              }, "Copied. Paste it into a Claude chat.")}
            >
              {busy === "brief" ? "Copying" : "Copy my numbers for Claude"}
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Appearance</h2></div>
        <Segmented
          label="Theme" value={theme} onChange={setTheme}
          options={[{ value: "system", label: "Match my device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
        />
      </section>
    </>
  );
}

function SyncRow({ run }: { run: SyncRun }) {
  const steps = Object.entries(run.summary?.steps ?? {});
  const failed = steps.filter(([, s]) => !s.ok);
  const label = run.status === "ok" ? "Worked" : run.status === "partial" ? "Partly worked" : run.status === "running" ? "Running" : run.status === "error" ? "Failed" : "Skipped";
  return (
    <div className="item">
      <div className="grow">
        <div className="title">
          {label}
          <span className="muted" style={{ fontWeight: 500 }}> {ago(run.started_at)}, {SOURCE_LABEL[run.source] ?? run.source}</span>
        </div>
        {run.error ? <div className="meta" style={{ color: "var(--bad)" }}>{run.error}</div> : null}
        {failed.map(([name, s]) => (
          <div className="meta" key={name}><strong>{STEP_LABEL[name] ?? name}</strong> did not update: {String(s.error ?? "unknown reason")}</div>
        ))}
        {run.summary?.note ? <div className="meta">{run.summary.note}</div> : null}
      </div>
    </div>
  );
}

function ConnectSteps({ clientId, onSaved, onCancel }: { clientId: string | null; onSaved: () => Promise<void>; onCancel?: () => void }) {
  const [id, setId] = useState(clientId ?? "");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveGoogleClient(id, secret);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    }
    setSaving(false);
  };

  const out = { target: "_blank", rel: "noreferrer" } as const;
  return (
    <div className="stack">
      <p className="soft" style={{ maxWidth: "70ch" }}>
        Google only hands out YouTube stats to an app with its own free key, so this takes about ten minutes, once.
        After that the dashboard updates itself and the Research tools switch on. It is read-only: nothing here can post, edit or remove anything on your channel.
      </p>
      <ol className="steps">
        <li>
          <div>
            <h3>Create a Google Cloud project</h3>
            <p className="soft">Open <a href="https://console.cloud.google.com/projectcreate" {...out}>Google Cloud</a> with the Google account that runs your channel. Any name works, for example "YouTube Dashboard". Press Create and wait for it to finish.</p>
          </div>
        </li>
        <li>
          <div>
            <h3>Switch on the two YouTube services</h3>
            <p className="soft">
              Open <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" {...out}>YouTube Data API v3</a> and press Enable.
              Then open <a href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" {...out}>YouTube Analytics API</a> and press Enable.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h3>Fill in the sign-in screen</h3>
            <p className="soft">
              Open <a href="https://console.cloud.google.com/auth/overview" {...out}>Google Auth Platform</a> and press Get started. Give it any app name, pick your email, choose External, and finish.
            </p>
            <p className="soft">
              Then open <a href="https://console.cloud.google.com/auth/audience" {...out}>Audience</a> and press Publish app. Without this, Google signs you out every seven days.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h3>Create the key</h3>
            <p className="soft">
              Open <a href="https://console.cloud.google.com/auth/clients" {...out}>Clients</a>, press Create client and choose Web application.
              Under "Authorized redirect URIs" press Add URI and paste this exactly:
            </p>
            <CopyLine value={`${FUNCTION_URL}/auth/callback`} />
            <p className="soft">Press Create. Google shows a Client ID and a Client secret.</p>
          </div>
        </li>
        <li>
          <form onSubmit={save} className="stack">
            <h3>Paste both here</h3>
            <label className="field">
              <span>Client ID</span>
              <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="1234567890-abc123.apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span>Client secret</span>
              <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-" autoComplete="off" spellCheck={false} />
              <small>Stored on the server and never shown again. Not even this page can read it back.</small>
            </label>
            {error ? <div className="notice error" role="alert" style={{ margin: 0 }}>{error}</div> : null}
            <div className="row-wrap">
              <button type="submit" className="btn btn-primary" disabled={saving || !id.trim() || !secret.trim()}>{saving ? "Saving" : "Save and continue"}</button>
              {onCancel ? <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button> : null}
            </div>
          </form>
        </li>
      </ol>
    </div>
  );
}

/** The key that lets an AI read text for the owner: outlier descriptions, comment themes, the game each video is about. */
function AiKey(props: { on: boolean; error: string | null; onChanged: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (value: string) => {
    setSaving(true);
    try {
      await saveAiKey(value);
      setKey("");
      props.onChanged();
      toast(value ? "Saved. The AI helper is on." : "Removed. The AI helper is off.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not save. Try again.", { error: true });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(key.trim()); }}>
      <h3>AI helper</h3>
      <p className="soft" style={{ maxWidth: "70ch" }}>
        {props.on ? "The AI helper is on. " : ""}
        With a Claude API key, the dashboard can describe in plain English what happens in any outlier video, sort your comments into themes,
        and work out which game each of your videos is about. The key comes from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic's console</a>,
        which is a separate paid account from the Claude app: you add a few dollars of credit there and it is used a little at a time.
      </p>
      {props.error ? <div className="notice error" role="alert" style={{ margin: 0 }}>{props.error}</div> : null}
      <label className="field">
        <span>{props.on ? "Replace the key" : "Claude API key"}</span>
        <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-" autoComplete="off" spellCheck={false} />
        <small>Stored on the server and never shown again. Paste it here, never into a chat.</small>
      </label>
      <div className="row-wrap">
        <button type="submit" className="btn btn-primary" disabled={saving || !key.trim()}>{saving ? "Saving" : "Save key"}</button>
        {props.on ? <button type="button" className="btn btn-danger" disabled={saving} onClick={() => { if (window.confirm("Remove the key? Descriptions and comment themes stop until you add one again.")) void save(""); }}>Remove key</button> : null}
      </div>
    </form>
  );
}
