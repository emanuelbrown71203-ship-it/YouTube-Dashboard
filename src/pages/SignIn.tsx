import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Loading } from "../components/ui.tsx";
import { publicStatus, redeemCode, startGoogleSignIn } from "../lib/api.ts";

export interface GoogleResult {
  kind: string;
  name?: string;
  message?: string;
}

function googleMessage(result: GoogleResult | null): string | null {
  if (!result) return null;
  switch (result.kind) {
    case "wrong": return `That Google account runs "${result.name ?? "a different channel"}", not the channel this dashboard is for. Sign in with the account you use for YouTube Studio.`;
    case "denied": return "Google sign-in was cancelled.";
    case "scopes": return "Google needs both YouTube boxes ticked to read your stats. Sign in again and leave them on.";
    case "nochannel": return "That Google account has no YouTube channel.";
    case "connected": return null;
    default: return result.message ?? "Google sign-in did not finish. Try again.";
  }
}

export function SignIn({ result, onSignedIn }: { result: GoogleResult | null; onSignedIn: () => void }) {
  const status = useQuery({ queryKey: ["public-status"], queryFn: publicStatus });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"code" | "google" | null>(null);
  const [error, setError] = useState<string | null>(googleMessage(result));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("code");
    setError(null);
    try {
      if (await redeemCode(code)) onSignedIn();
      else setError("That code did not work. It may have been used already or has expired.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the code.");
    }
    setBusy(null);
  };

  const google = async () => {
    setBusy("google");
    setError(null);
    try {
      window.location.assign((await startGoogleSignIn()).url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setBusy(null);
    }
  };

  if (status.isLoading) return <div className="gate"><Loading label="Opening your dashboard" /></div>;
  const googleReady = status.data?.google_configured === true;

  return (
    <div className="gate">
      <div className="gate-box">
        <div>
          <h1>YouTube Dashboard</h1>
          <p className="soft" style={{ marginTop: 8 }}>
            Private to the channel owner. {googleReady ? "Sign in with the Google account that runs the channel." : "Enter the sign-in code Claude gave you."}
          </p>
        </div>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
        {googleReady ? (
          <button type="button" className="btn btn-primary" onClick={google} disabled={busy !== null}>
            {busy === "google" ? "Opening Google" : "Sign in with Google"}
          </button>
        ) : null}
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>{googleReady ? "Or use a sign-in code" : "Sign-in code"}</span>
            <input
              className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE-FGHJK"
              autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} maxLength={14} inputMode="text"
            />
            <small>A code works once, for one browser. Ask Claude for a new one any time.</small>
          </label>
          <div>
            <button type="submit" className={googleReady ? "btn" : "btn btn-primary"} disabled={busy !== null || code.replace(/[^A-Za-z0-9]/g, "").length < 10}>
              {busy === "code" ? "Checking" : "Sign in with code"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
