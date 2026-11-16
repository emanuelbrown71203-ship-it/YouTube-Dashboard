import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Loading, useToast } from "./components/ui.tsx";
import { ensureSession, finishGoogleSignIn, whoami } from "./lib/api.ts";
import { keys, useChannel, useSyncRuns } from "./lib/hooks.ts";
import { navigate, useRoute } from "./lib/router.ts";
import { Ideas } from "./pages/Ideas.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Research } from "./pages/Research.tsx";
import { Settings } from "./pages/Settings.tsx";
import { type GoogleResult, SignIn } from "./pages/SignIn.tsx";
import { Videos } from "./pages/Videos.tsx";

const NAV = [
  { path: "/", label: "Overview", icon: "overview" },
  { path: "/videos", label: "Videos", icon: "videos" },
  { path: "/ideas", label: "Ideas", icon: "ideas" },
  { path: "/research", label: "Research", icon: "research" },
  { path: "/settings", label: "Settings", icon: "settings" },
];

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
  const title = channel.data?.title ?? "My channel";
  return (
    <div className="app">
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
        {NAV.map((item) => (
          <a key={item.path} className="nav-link" href={`#${item.path}`} aria-current={`/${section}` === item.path ? "page" : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
        <div className="rail-foot small muted">
          {latest?.status === "running" ? <span className="row"><span className="spin" />Syncing with YouTube</span> : null}
        </div>
      </nav>
      <main className="main">
        {section === "" ? <Overview />
          : section === "videos" ? <Videos />
          : section === "ideas" ? <Ideas />
          : section === "research" ? <Research />
          : section === "settings" ? <Settings onSignedOut={props.onSignedOut} />
          : <div className="empty"><h3>That page does not exist</h3><p><a href="#/">Go to the overview</a></p></div>}
      </main>
    </div>
  );
}
