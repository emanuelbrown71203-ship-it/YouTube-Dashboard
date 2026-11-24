import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { PullToRefresh } from "./components/pull.tsx";
import { Icon, Loading, useToast } from "./components/ui.tsx";
import { ensureSession, finishGoogleSignIn, whoami } from "./lib/api.ts";
import { keys, useChannel, useSyncRuns } from "./lib/hooks.ts";
import { navigate, useRoute } from "./lib/router.ts";
import { Comments, Funnel, Games, Goals, IDEA_TABS, Planner, PLAYBOOK_TABS, Recap, STATS_TABS, Tabs, Tests, VIDEO_TABS } from "./pages/Growth.tsx";
import { Ideas } from "./pages/Ideas.tsx";
import { Notes } from "./pages/Notes.tsx";
import { Scripts } from "./pages/Scripts.tsx";
import { EditorNotesPage } from "./pages/EditorNotes.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Research } from "./pages/Research.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Suggested } from "./pages/Suggested.tsx";
import { type GoogleResult, SignIn } from "./pages/SignIn.tsx";
import { Templates } from "./pages/Templates.tsx";
import { Videos } from "./pages/Videos.tsx";
import { FindBox } from "./pages/Find.tsx";

// The sections, in the order they are listed. The first four sit in the phone's bottom bar; the rest
// open from "More" there. On a wide screen all of them are in the side rail.
const NAV = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/videos", label: "Videos", icon: "videos" },
  { path: "/ideas", label: "Ideas", icon: "ideas" },
  { path: "/research", label: "Research", icon: "research" },
  { path: "/stats", label: "Stats", icon: "overview" },
  { path: "/goals", label: "Goals", icon: "goals" },
  { path: "/comments", label: "Comments", icon: "comments" },
  { path: "/playbook", label: "Playbook", icon: "playbook" },
  { path: "/settings", label: "Settings", icon: "settings" },
];
const DOCK = 4;

// Pages that moved when the sections were sorted out: old links still land in the right place.
const MOVED: Record<string, string> = {
  "recap": "/stats/recap", "notes": "/playbook/lines", "videos/games": "/stats/games", "videos/funnel": "/stats/funnel",
  "ideas/templates": "/playbook",
};

export function App() {
  const route = useRoute();
  const [state, setState] = useState<"starting" | "gate" | "in" | "error">("starting");
  const [error, setError] = useState("");
  const [google, setGoogle] = useState<GoogleResult | null>(null);

  const check = useCallback(async (grant: string | null = null) => {
    try {
      await ensureSession();
      if (grant) {
        // Back from Google: this browser shows the secret it kept, and is let in.
        try {
          await finishGoogleSignIn(grant);
          setGoogle({ kind: "connected" });
        } catch (err) {
          setGoogle({ kind: "error", message: err instanceof Error ? err.message : undefined });
        }
      }
      setState((await whoami()).owner ? "in" : "gate");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start.");
      setState("error");
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const grant = query.get("google") === "verify" ? query.get("grant") : null;
    if (grant) navigate("/", true); // take the one-time grant out of the address bar straight away
    void check(grant);
  }, [check]);

  // Google sends the browser back with the outcome in the address; read it once and tidy up.
  useEffect(() => {
    const kind = route.query.get("google");
    if (!kind || kind === "verify") return;
    setGoogle({ kind, name: route.query.get("name") ?? undefined, message: route.query.get("message") ?? undefined });
    navigate(route.path, true);
  }, [route]);

  if (state === "starting") return <div className="gate"><Loading label="Opening your dashboard" /></div>;
  if (state === "error") {
    return (
      <div className="gate">
        <div className="gate-box">
          <h1>The dashboard could not start</h1>
          <p className="soft">{error}</p>
          <div><button type="button" className="btn btn-primary" onClick={() => { setState("starting"); void check(); }}>Try again</button></div>
        </div>
      </div>
    );
  }
  if (state === "gate") return <SignIn result={google} onSignedIn={() => setState("in")} />;
  return <Shell google={google} clearGoogle={() => setGoogle(null)} onSignedOut={() => setState("gate")} />;
}

function Shell(props: { google: GoogleResult | null; clearGoogle: () => void; onSignedOut: () => void }) {
  const route = useRoute();
  const toast = useToast();
  const queryClient = useQueryClient();
  const channel = useChannel();
  const [watchUntil, setWatchUntil] = useState(0);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const runs = useSyncRuns(Date.now() < watchUntil ? 3000 : false);
  const latest = runs.data?.[0];
  const wasRunning = useRef(false);
  const { google, clearGoogle } = props;

  const handled = useRef<GoogleResult | null>(null);
  useEffect(() => {
    if (!google || handled.current === google) return;
    handled.current = google;
    if (google.kind === "connected") {
      toast("YouTube is connected. Your numbers are loading.");
      setWatchUntil(Date.now() + 90_000);
      void queryClient.invalidateQueries();
    } else if (google.kind === "wrong") {
      toast(`That Google account runs "${google.name ?? "another channel"}", not this one. Nothing was changed.`, { error: true });
    } else if (google.kind === "scopes") {
      toast("Google needs both YouTube boxes ticked. Connect again and leave them on.", { error: true });
    } else if (google.kind !== "denied") {
      toast(google.message ?? "Google sign-in did not finish. Try again.", { error: true });
    }
    clearGoogle();
  }, [google, clearGoogle, toast, queryClient]);

  // When a sync finishes, everything on screen is out of date: reload it.
  useEffect(() => {
    const running = latest?.status === "running";
    if (running) setWatchUntil((until) => Math.max(until, Date.now() + 30_000));
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey !== keys.runs });
      setWatchUntil(0);
    }
    wasRunning.current = running;
  }, [latest?.status, latest?.id, queryClient]);

  const section = route.segments[0] ?? "";
  const sub = route.segments[1] ?? "";
  const moved = MOVED[sub ? `${section}/${sub}` : section];
  useEffect(() => {
    if (moved) navigate(moved, true);
  }, [moved]);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [section, sub]);
  const inMore = NAV.slice(DOCK).some((item) => item.path === `/${section}`);
  const title = channel.data?.title ?? "My channel";
  return (
    <div className="app">
      <PullToRefresh />
      <nav className="rail" aria-label="Sections">
        <div className="rail-channel">
          {channel.data?.thumbnail_url && !avatarBroken
            ? <img className="avatar" src={channel.data.thumbnail_url} alt="" onError={() => setAvatarBroken(true)} />
            : <span className="avatar" aria-hidden="true" style={{ display: "grid", placeItems: "center", fontWeight: 750, color: "var(--accent-strong)" }}>{title.slice(0, 1)}</span>}
          <div className="grow">
            <div className="name clip">{title}</div>
            <div className="small muted clip">{channel.data?.handle ?? "YouTube dashboard"}</div>
          </div>
        </div>
        {NAV.map((item, index) => (
          <a key={item.path} className={`nav-link${index >= DOCK ? " nav-extra" : ""}`} href={`#${item.path}`} aria-current={`/${section}` === item.path ? "page" : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
        <button type="button" className="nav-link nav-more" aria-expanded={more} aria-current={inMore ? "page" : undefined} onClick={() => setMore((m) => !m)}>
          <Icon name="more" />
          <span>More</span>
        </button>
        <div className="rail-foot small muted">
          {latest?.status === "running" ? <span className="row"><span className="spin" />Syncing with YouTube</span> : null}
        </div>
      </nav>
      {more ? (
        <>
          <button type="button" className="more-shade" aria-label="Close the menu" onClick={() => setMore(false)} />
          <nav className="more-sheet" aria-label="More sections">
            {NAV.slice(DOCK).map((item) => (
              <a key={item.path} className="nav-link" href={`#${item.path}`} aria-current={`/${section}` === item.path ? "page" : undefined} onClick={() => setMore(false)}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </>
      ) : null}
      <main className="main">
        {moved ? null
          : section === "" ? <Overview view="home" />
          : section === "stats" && sub === "" ? <Overview view="stats" />
          : section === "stats" && ["recap", "games", "funnel"].includes(sub) ? (
            <>
              <div className="page-head"><h1>Stats</h1></div>
              <Tabs label="Stats" base="/stats" current={sub} tabs={STATS_TABS} />
              {sub === "recap" ? <Recap /> : sub === "games" ? <Games /> : <Funnel />}
            </>
          )
          : section === "videos" && sub === "tests" ? (
            <>
              <div className="page-head"><h1>Videos</h1></div>
              <Tabs label="Videos" base="/videos" current={sub} tabs={VIDEO_TABS} />
              <Tests />
            </>
          )
          : section === "videos" ? <Videos />
          : section === "ideas" && sub === "suggested" ? (
            <>
              <div className="page-head"><h1>Ideas</h1></div>
              <Tabs label="Ideas" base="/ideas" current={sub} tabs={IDEA_TABS} />
              <Suggested />
            </>
          )
          : section === "ideas" && sub === "planner" ? (
            <>
              <div className="page-head"><h1>Ideas</h1></div>
              <Tabs label="Ideas" base="/ideas" current={sub} tabs={IDEA_TABS} />
              <Planner />
            </>
          )
          : section === "ideas" && sub === "editor" ? (
            <>
              <div className="page-head"><h1>Ideas</h1></div>
              <Tabs label="Ideas" base="/ideas" current={sub} tabs={IDEA_TABS} />
              <EditorNotesPage />
            </>
          )
          : section === "ideas" ? <Ideas />
          : section === "goals" ? <><div className="page-head"><h1>Goals</h1></div><Goals /></>
          : section === "comments" ? <><div className="page-head"><h1>Comments</h1></div><Comments /></>
          : section === "playbook" && (sub === "" || sub === "lines" || sub === "scripts") ? (
            <>
              <div className="page-head"><h1>Playbook</h1></div>
              <Tabs label="Playbook" base="/playbook" current={sub} tabs={PLAYBOOK_TABS} />
              <div style={{ marginBottom: 16 }}><FindBox label="Find a template, line, script or idea" /></div>
              {sub === "lines" ? <Notes /> : sub === "scripts" ? <Scripts /> : <Templates />}
            </>
          )
          : section === "research" ? <Research />
          : section === "settings" ? <Settings onSignedOut={props.onSignedOut} />
          : <div className="empty"><h3>That page does not exist</h3><p><a href="#/">Go to the home page</a></p></div>}
      </main>
    </div>
  );
}
