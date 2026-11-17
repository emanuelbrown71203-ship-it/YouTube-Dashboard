// Routes for the single "yt-api" edge function:
//
//   GET  /health            is it up
//   POST /auth/setup        owner saves the Google client id and secret
//   POST /auth/start        any signed-in browser asks for the Google sign-in address
//   GET  /auth/callback     Google sends the browser back here
//   POST /auth/finish       the browser that started it proves itself and is let in
//   POST /auth/disconnect   owner disconnects YouTube
//   POST /ai/setup          owner saves the key for the AI
//   POST /sync              owner or the scheduler pulls fresh numbers
//   POST /sync/extras       the slow follow-up work (AI, feeders); scheduler only
//   POST /sync/pulse        hourly: spot a new upload, note live view counts; scheduler only
//   POST /ai/titles         title ideas for a video idea, in the owner's own style
//   POST /research          owner runs a research action
//
// The function is deployed without Supabase's own JWT check because Google's
// redirect and the scheduler carry no JWT; every route checks its caller here.

import {
  type Api, closeApi, COMMENTS_SCOPE, type Deps, EARNINGS_SCOPE, exchangeToken, fetchChannels, getConfig, HttpError, SCOPES, setConfig,
} from "./google.ts";
import { suggestTitles } from "./growth.ts";
import { research } from "./research.ts";
import { runExtras, runPulse, runSync } from "./sync.ts";

/** Makes postgres.js return counts and decimals as plain numbers. */
export const postgresTypes = {
  int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
  numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
};

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

async function signedInUser(req: Request, deps: Deps): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const id = token ? await deps.verifyUser(token) : null;
  if (!id) throw new HttpError(401, "signed_out", "Your session has expired. Reload the page.");
  return id;
}

async function requireOwner(req: Request, deps: Deps): Promise<string> {
  const id = await signedInUser(req, deps);
  const [row] = await deps.sql`select 1 as ok from public.yt_owners where user_id = ${id} and revoked_at is null`;
  if (!row) throw new HttpError(403, "not_owner", "This browser is not signed in to the dashboard.");
  return id;
}

async function isScheduler(req: Request, deps: Deps): Promise<boolean> {
  const given = req.headers.get("x-cron-secret");
  if (!given) return false;
  const { cron_secret } = await getConfig(deps.sql, ["cron_secret"]);
  return Boolean(cron_secret) && sameText(given, cron_secret);
}

const redirectUri = (deps: Deps) => `${deps.functionUrl}/auth/callback`;

// ---------------------------------------------------------------------------
// Google sign-in
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function authSetup(deps: Deps, body: any) {
  const clientId = String(body.client_id ?? "").trim();
  const clientSecret = String(body.client_secret ?? "").trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new HttpError(400, "bad_client_id", "That is not a Google client ID. It ends with .apps.googleusercontent.com");
  }
  if (clientSecret.length < 10 || /\s/.test(clientSecret)) {
    throw new HttpError(400, "bad_client_secret", "That client secret looks incomplete. Copy it again from Google.");
  }
  const current = await getConfig(deps.sql, ["google_client_id"]);
  const values: Record<string, string> = {
    google_client_id: clientId, google_client_secret: clientSecret, google_error: "",
  };
  if (current.google_client_id && current.google_client_id !== clientId) {
    // A sign-in made with the old client cannot be refreshed with the new one.
    Object.assign(values, { google_refresh_token: "", google_access_token: "", google_access_expires: "", google_connected_at: "" });
  }
  await setConfig(deps.sql, values);
  return { ok: true, redirect_uri: redirectUri(deps) };
}

// deno-lint-ignore no-explicit-any
async function authStart(deps: Deps, userId: string, body: any) {
  const { sql } = deps;
  const cfg = await getConfig(sql, ["google_client_id", "google_client_secret", "allowed_origins"]);
  if (!cfg.google_client_id || !cfg.google_client_secret) {
    throw new HttpError(409, "not_configured", "Google sign-in is not set up yet.");
  }
  let origin: string;
  try {
    origin = new URL(String(body.return_to ?? "")).origin;
  } catch {
    throw new HttpError(400, "bad_request", "Missing the address to come back to.");
  }
  const allowed: string[] = JSON.parse(cfg.allowed_origins ?? "[]");
  if (!allowed.includes(origin)) {
    throw new HttpError(400, "origin_not_allowed", `Sign-in is not allowed from ${origin}.`);
  }
  // The browser keeps a secret and sends only its hash. It has to show the secret
  // again after Google, which proves the sign-in is finishing where it started.
  const challenge = String(body.challenge ?? "");
  if (!/^[0-9a-f]{64}$/.test(challenge)) throw new HttpError(400, "bad_request", "Reload the page and try again.");
  const [{ n }] = await sql`
    select count(*)::int as n from public.yt_oauth_states where created_at > now() - interval '10 minutes'`;
  if (n >= 30) throw new HttpError(429, "slow_down", "Too many sign-in attempts. Wait a few minutes and try again.");

  const state = randomHex(32);
  await sql`
    insert into public.yt_oauth_states (state, user_id, return_to, challenge)
    values (${state}, ${userId}, ${origin}, ${challenge})`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: cfg.google_client_id,
    redirect_uri: redirectUri(deps),
    response_type: "code",
    scope: [...SCOPES, EARNINGS_SCOPE, ...(body.comments === false ? [] : [COMMENTS_SCOPE])].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return { url: url.toString() };
}

async function authCallback(url: URL, deps: Deps): Promise<Response> {
  const { sql } = deps;
  const state = url.searchParams.get("state") ?? "";
  const [pending] = state
    ? await sql`
        update public.yt_oauth_states set used_at = now()
         where state = ${state} and used_at is null and created_at > now() - interval '15 minutes'
        returning user_id, return_to`
    : [];
  if (!pending) {
    return new Response("This sign-in link has expired. Go back to your dashboard and press Sign in with Google again.", {
      status: 400, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const back = (result: string, extra: Record<string, string> = {}) =>
    redirect(`${pending.return_to}/#/?${new URLSearchParams({ google: result, ...extra }).toString()}`);

  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error", { message: "Google sent no sign-in code." });

  try {
    const cfg = await getConfig(sql, ["google_client_id", "google_client_secret", "google_refresh_token", "owner_channel_id"]);
    const token = await exchangeToken(deps, {
      code, client_id: cfg.google_client_id ?? "", client_secret: cfg.google_client_secret ?? "",
      redirect_uri: redirectUri(deps), grant_type: "authorization_code",
    });
    const granted = String(token.scope ?? "").split(" ");
    if (!SCOPES.every((s) => granted.includes(s))) return back("scopes");

    const api: Api = { deps, token: String(token.access_token), units: 0, calls: 0 };
    const [channel] = await fetchChannels(api, { mine: true });
    await closeApi(api).catch(() => undefined);
    if (!channel) return back("nochannel");
    if (cfg.owner_channel_id && channel.id !== cfg.owner_channel_id) return back("wrong", { name: channel.title });

    const refresh = String(token.refresh_token ?? cfg.google_refresh_token ?? "");
    if (!refresh) return back("error", { message: "Google did not grant ongoing access. Try again." });
    await setConfig(sql, {
      google_refresh_token: refresh,
      google_access_token: String(token.access_token),
      google_access_expires: String(deps.now().getTime() + Number(token.expires_in ?? 3600) * 1000),
      google_connected_at: deps.now().toISOString(),
      google_scopes: granted.join(" "),
      google_error: "",
    });
    // Google has confirmed the channel owner approved, but not which browser they are in.
    // Hand back a one-time grant; only the browser holding the secret can turn it into access.
    const grant = randomHex(32);
    await sql`
      update public.yt_oauth_states set grant_hash = ${await sha256Hex(grant)}, granted_at = now()
       where state = ${state}`;

    const firstSync = runSync(deps, "connect").catch((err) => deps.log?.("first sync failed", String(err)));
    deps.background?.(firstSync);
    return back("verify", { grant });
  } catch (err) {
    deps.log?.("google callback failed", String(err), err instanceof HttpError ? err.detail : "");
    return back("error", { message: err instanceof HttpError ? err.message : "Something went wrong finishing the sign-in." });
  }
}

/** Last step of Google sign-in: the browser that started it proves itself and is let in. */
// deno-lint-ignore no-explicit-any
async function authFinish(deps: Deps, userId: string, body: any) {
  const grant = String(body.grant ?? "");
  const verifier = String(body.verifier ?? "");
  const [done] = grant && verifier
    ? await deps.sql`
        update public.yt_oauth_states set finished_at = now()
         where grant_hash = ${await sha256Hex(grant)} and challenge = ${await sha256Hex(verifier)}
           and user_id = ${userId} and finished_at is null and granted_at > now() - interval '10 minutes'
        returning state`
    : [];
  if (!done) {
    throw new HttpError(403, "not_this_browser", "That sign-in was not started in this browser. Press Sign in with Google here to try again.");
  }
  await deps.sql`
    insert into public.yt_owners (user_id, method, device) values (${userId}, 'google', ${String(body.device ?? "").slice(0, 160) || null})
    on conflict (user_id) do update
      set revoked_at = null, method = 'google', device = coalesce(excluded.device, public.yt_owners.device), last_seen_at = now()`;
  return { ok: true };
}

/** The owner saves (or, with an empty box, removes) the key that lets the AI read text for them. */
// deno-lint-ignore no-explicit-any
async function aiSetup(deps: Deps, body: any) {
  const key = String(body.api_key ?? "").trim();
  if (key && (!/^sk-ant-[\w-]{20,}$/.test(key) || key.startsWith("sk-ant-admin"))) {
    throw new HttpError(400, "bad_ai_key", "That does not look like a Claude API key. It starts with sk-ant-");
  }
  await setConfig(deps.sql, { anthropic_api_key: key, ai_error: "" });
  return { ok: true, ai: Boolean(key) };
}

async function authDisconnect(deps: Deps) {
  const cfg = await getConfig(deps.sql, ["google_refresh_token"]);
  if (cfg.google_refresh_token) {
    // Best effort: tell Google to forget the grant as well.
    await deps.fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: cfg.google_refresh_token }).toString(),
    }).catch(() => undefined);
  }
  await setConfig(deps.sql, {
    google_refresh_token: "", google_access_token: "", google_access_expires: "", google_connected_at: "", google_scopes: "", google_error: "",
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*?\/yt-api/, "").replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && route === "/health") return json({ ok: true });
    if (req.method === "GET" && route === "/auth/callback") return await authCallback(url, deps);
    if (req.method !== "POST") throw new HttpError(404, "not_found", "Not found.");
    const body = await req.json().catch(() => ({}));
    switch (route) {
      case "/auth/start":
        return json(await authStart(deps, await signedInUser(req, deps), body));
      case "/auth/finish":
        return json(await authFinish(deps, await signedInUser(req, deps), body));
      case "/auth/setup":
        await requireOwner(req, deps);
        return json(await authSetup(deps, body));
      case "/ai/setup":
        await requireOwner(req, deps);
        return json(await aiSetup(deps, body));
      case "/auth/disconnect":
        await requireOwner(req, deps);
        return json(await authDisconnect(deps));
      case "/sync": {
        const scheduled = await isScheduler(req, deps);
        if (!scheduled) await requireOwner(req, deps);
        return json(await runSync(deps, scheduled ? "cron" : "manual"));
      }
      case "/sync/extras":
        // Only the database's own follow-up call gets in here.
        if (!(await isScheduler(req, deps))) throw new HttpError(403, "forbidden", "Not allowed.");
        return json(await runExtras(deps, Number(body?.run_id ?? 0), Number(body?.hop ?? 0)));
      case "/sync/pulse":
        if (!(await isScheduler(req, deps))) throw new HttpError(403, "forbidden", "Not allowed.");
        return json(await runPulse(deps));
      case "/ai/titles":
        await requireOwner(req, deps);
        return json(await suggestTitles(deps, body ?? {}));
      case "/research":
        await requireOwner(req, deps);
        return json(await research(deps, body));
      default:
        throw new HttpError(404, "not_found", "Not found.");
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
    deps.log?.("unhandled error", err);
    return json({ error: "Something went wrong on the server. Try again in a moment.", code: "server_error" }, 500);
  }
}
