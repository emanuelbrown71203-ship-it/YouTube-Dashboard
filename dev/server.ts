// A local stand-in for the hosted backend, for development and browser tests:
//
//   /auth/v1/*        anonymous sign-in, like Supabase Auth
//   /rest/v1/*        the small part of PostgREST the app uses, with row level
//                     security enforced by running each request as the caller
//   /functions/v1/*   the real yt-api code, talking to a made-up YouTube
//   /fake-google      stands in for Google's consent screen
//
//   npm run dev:local          (needs a local Postgres; see dev/README.md)
//
// Never deployed. The production app talks to Supabase directly.

import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import postgres from "postgres";
import { handle, postgresTypes } from "../supabase/functions/yt-api/app.ts";
import type { Deps } from "../supabase/functions/yt-api/google.ts";
import { createMockGoogle } from "./mock-youtube.ts";

const PORT = Number(process.env.YT_DEV_PORT ?? 54321);
const DATABASE = process.env.YT_DEV_DB ?? "postgresql://ytdev:ytdev@localhost:5432/ytdash";
const ORIGIN = `http://localhost:${PORT}`;
const SECRET = "local-development-only";
const sql = postgres(DATABASE, { max: 8, prepare: false, types: postgresTypes, onnotice: () => {} });
// The REST stand-in answers the way PostgREST does: calendar dates stay "2026-11-16", not a timestamp.
const restSql = postgres(DATABASE, {
  max: 8, prepare: false, onnotice: () => {},
  types: { ...postgresTypes, date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x } },
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
  "access-control-expose-headers": "content-range",
};

const b64 = (data: string | Buffer) => Buffer.from(data).toString("base64url");
function signToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({
    sub: userId, role: "authenticated", aud: "authenticated", is_anonymous: true, iat: now, exp: now + 3600,
  }))}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
function readToken(token: string | null): { sub: string; role: string } | null {
  if (!token) return null;
  const [head, payload, signature] = token.split(".");
  if (!signature || createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url") !== signature) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json", ...headers },
  });
}

function session(userId: string) {
  const now = new Date().toISOString();
  return {
    access_token: signToken(userId), token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh.${userId}`,
    user: {
      id: userId, aud: "authenticated", role: "authenticated", email: "", phone: "", is_anonymous: true,
      app_metadata: {}, user_metadata: {}, identities: [], created_at: now, updated_at: now,
    },
  };
}

async function auth(req: Request, url: URL): Promise<Response> {
  const route = url.pathname.slice("/auth/v1".length);
  if (route === "/signup" && req.method === "POST") {
    const id = randomUUID();
    await sql`insert into auth.users (id) values (${id})`;
    return json(session(id));
  }
  if (route === "/token" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const id = String(body.refresh_token ?? "").replace(/^refresh\./, "");
    const [user] = /^[0-9a-f-]{36}$/.test(id) ? await sql`select id from auth.users where id = ${id}` : [];
    return user ? json(session(id)) : json({ error: "invalid_grant", error_description: "Invalid Refresh Token" }, 400);
  }
  if (route === "/user") {
    const claims = readToken(bearer(req));
    return claims ? json(session(claims.sub).user) : json({ code: 401, msg: "invalid token" }, 401);
  }
  if (route === "/logout") return new Response(null, { status: 204, headers: CORS });
  return json({ msg: "not implemented in the local stand-in" }, 404);
}

// --- the PostgREST subset ----------------------------------------------------

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw Object.assign(new Error(`bad name: ${name}`), { code: "PGRST100" });
  return `"${name}"`;
};
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

// Filter values go in as untyped literals, the way PostgREST sends them, so Postgres
// turns "true" or "2026-11-16" into whatever type the column has.
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

function where(url: URL, table = ""): string {
  const parts: string[] = [];
  for (const [name, raw] of url.searchParams) {
    if (RESERVED.has(name)) continue;
    const column = { toString: () => `${table}${ident(name)}` };
    const negate = raw.startsWith("not.");
    const expr = negate ? raw.slice(4) : raw;
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot), value = expr.slice(dot + 1);
    let clause: string;
    if (op === "is") clause = `${column} is ${({ null: "null", true: "true", false: "false" } as Record<string, string>)[value] ?? "null"}`;
    else if (op === "in") {
      const items = value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      clause = `${column} in (${items.map(literal).join(", ")})`;
    } else if (op === "cs") clause = `${column} @> ${literal(value)}::jsonb`;
    else if (OPS[op]) clause = `${column} ${OPS[op]} ${literal(value)}`;
    else throw Object.assign(new Error(`the local stand-in does not support the "${op}" filter`), { code: "PGRST100" });
    parts.push(negate ? `not (${clause})` : clause);
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

function columnsOf(url: URL): string {
  const select = url.searchParams.get("select");
  if (!select || select === "*") return "*";
  return select.split(",").map((c) => ident(c.trim())).join(", ");
}

async function rest(req: Request, url: URL): Promise<Response> {
  const claims = readToken(bearer(req));
  const role = claims ? "authenticated" : "anon";
  const jwt = JSON.stringify(claims ?? { role: "anon" });
  const path = url.pathname.slice("/rest/v1/".length);
  const params: unknown[] = [];
  let query: string;
  let rpc = false;

  if (path.startsWith("rpc/")) {
    rpc = true;
    const args = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // Values keep their own type (true stays a boolean, 5 a number) so the driver sends them correctly.
    const list = Object.entries(args).map(([name, value]) =>
      `${ident(name)} := $${params.push(value !== null && typeof value === "object" ? JSON.stringify(value) : value)}`);
    query = `select public.${ident(path.slice(4))}(${list.join(", ")}) as result`;
  } else if (req.method === "GET") {
    const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map((o) => {
      const [column, ...flags] = o.split(".");
      return `${ident(column)}${flags.includes("desc") ? " desc" : ""}${flags.includes("nullslast") ? " nulls last" : flags.includes("nullsfirst") ? " nulls first" : ""}`;
    });
    query = `select ${columnsOf(url)} from public.${ident(path)}${where(url)}` +
      `${order.length ? ` order by ${order.join(", ")}` : ""}` +
      `${url.searchParams.get("limit") ? ` limit ${Number(url.searchParams.get("limit"))}` : ""}` +
      `${url.searchParams.get("offset") ? ` offset ${Number(url.searchParams.get("offset"))}` : ""}`;
  } else if (req.method === "POST") {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : [body];
    const columns = Object.keys(rows[0] ?? {}).map(ident).join(", ");
    params.push(JSON.stringify(rows));
    query = `insert into public.${ident(path)} (${columns}) select ${columns} from jsonb_populate_recordset(null::public.${ident(path)}, $1::text::jsonb) returning ${columnsOf(url)}`;
  } else if (req.method === "PATCH") {
    const body = await req.json();
    params.push(JSON.stringify(body));
    const sets = Object.keys(body).map((c) => `${ident(c)} = x.${ident(c)}`).join(", ");
    query = `update public.${ident(path)} t set ${sets} from jsonb_populate_record(null::public.${ident(path)}, $1::text::jsonb) x${where(url, "t.")} returning ${columnsOf(url).replace(/"(\w+)"/g, 't."$1"').replace(/^\*$/, "t.*")}`;
  } else {
    return json({ message: "the local stand-in does not support this method" }, 405);
  }

  try {
    const rows = await restSql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
      // deno-lint-ignore no-explicit-any
      return tx.unsafe(query, params as any[]);
    });
    if (rpc) return json(rows[0]?.result === "" ? null : (rows[0]?.result ?? null));
    if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
      return rows.length === 1 ? json(rows[0]) : json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, 406);
    }
    return json(rows);
  } catch (err) {
    const e = err as { code?: string; message: string; detail?: string; hint?: string };
    console.error(`[rest] ${req.method} ${path}: ${e.message}`);
    return json({ code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null }, e.code === "42501" ? 403 : 400);
  }
}

// --- the edge function, against a made-up YouTube ------------------------------

const google = createMockGoogle({
  now: () => new Date(),
  signedInChannelId: process.env.YT_DEV_GOOGLE_CHANNEL || undefined,
});
const deps: Deps = {
  sql,
  fetch: google.fetch,
  now: () => new Date(),
  functionUrl: `${ORIGIN}/functions/v1/yt-api`,
  verifyUser: async (token) => readToken(token)?.sub ?? null,
  log: (...args) => console.log("[yt-api]", ...args),
  // A stand-in for the AI: it answers in the right shape without thinking.
  claude: async (_key, req) => {
    const props = (req.schema.properties ?? {}) as Record<string, unknown>;
    if (JSON.stringify(req.schema).includes('"match"')) {
      // Sorting search results for one idea: the same idea shares its last word, the same kind is another challenge.
      const sent = JSON.parse(req.prompt) as { idea: { title: string }; videos: { n: number; title: string }[] };
      const last = sent.idea.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().split(" ").pop() ?? "";
      return {
        videos: sent.videos.map((v) => ({
          n: v.n, match: last && v.title.toLowerCase().includes(last) ? "same" : /only|without|but|challenge/i.test(v.title) ? "close" : "no",
        })),
      };
    }
    if (props.videos) {
      const list = JSON.parse(req.prompt.slice(req.prompt.indexOf("Videos:") + 7)) as { id: string; title: string }[];
      const games = ["Elden Ring", "Baldur's Gate 3", "Cuphead", "Dark Souls 3"];
      return { videos: list.map((v) => ({ id: v.id, topic: games.find((g) => v.title.toLowerCase().includes(g.toLowerCase().split(" ")[0])) ?? null })) };
    }
    if (props.checks) {
      const sent = JSON.parse(req.prompt) as { idea: { title: string }; templates: { id: string; template: string }[] };
      return {
        checks: sent.templates.map((t) => {
          const points = t.template.split("\n").map((l) => l.trim()).filter(Boolean);
          const met = points.filter((_, i) => i % 2 === 0), missing = points.filter((_, i) => i % 2 === 1);
          return { template_id: t.id, score: Math.round((100 * met.length) / Math.max(1, points.length)), met, missing, fix: missing[0] ? `(made-up) Work in: ${missing[0]}.` : "" };
        }),
      };
    }
    if (props.ideas) {
      const pasted = (JSON.parse(req.prompt) as { pasted_text: string }).pasted_text;
      return {
        ideas: pasted.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter((l) => l.length > 8).slice(0, 6)
          .map((title) => ({ title, format: "long", game: /elden/i.test(title) ? "Elden Ring" : null, hook: null, concept: "(made-up) Read from the pasted text.", thumbnail: null, other_titles: [] })),
      };
    }
    if (props.titles) {
      const idea = JSON.parse(req.prompt).idea as { working_title: string; game: string | null };
      const game = idea.game ?? "this game";
      return {
        titles: [`Can I Beat ${game} With One Rule?`, `I Tried ${game} With 0 Hours`, `${game} But Every Boss Is Harder`].map((title) => ({
          title, why: "(made-up) Follows the kind of title that beat your usual video.",
        })),
      };
    }
    if (props.comments) {
      const list = JSON.parse(req.prompt) as { id: string; text: string }[];
      return {
        comments: list.map((c) => {
          const negative = /quiet|not your best/i.test(c.text);
          const question = /\?|please|can you/i.test(c.text);
          return {
            id: c.id, sentiment: negative ? "negative" : question ? "neutral" : "positive", is_question: question,
            theme: negative ? "Feedback on quality" : /more|next|try/i.test(c.text) ? "Wants more challenge runs" : question ? "Asks how it was made" : "Enjoyed the video",
          };
        }),
      };
    }
    return {
      title_en: "(made-up) The same title in English",
      what_happens: "A made-up description for local testing: the creator attempts a challenge run and narrates each failure.",
      why_it_worked: "A clear one-line premise in the title and a thumbnail that shows the stakes.",
      your_version: "Try the same restriction in a game your viewers already watch you play.",
      confidence: "medium",
    };
  },
};

async function functions(req: Request, url: URL): Promise<Response> {
  const res = await handle(req, deps);
  if (url.pathname.endsWith("/auth/start") && res.ok) {
    // Send the browser to the local consent stand-in instead of the real Google.
    const body = await res.json();
    body.url = String(body.url).replace("https://accounts.google.com/o/oauth2/v2/auth", `${ORIGIN}/fake-google`);
    return json(body);
  }
  return res;
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname.startsWith("/auth/v1/")) return auth(req, url);
  if (url.pathname.startsWith("/rest/v1/")) return rest(req, url);
  if (url.pathname.startsWith("/functions/v1/yt-api")) return functions(req, url);
  if (url.pathname === "/fake-google") {
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    back.searchParams.set("code", "good-code");
    return new Response(null, { status: 302, headers: { location: back.toString() } });
  }
  return json({ message: "not found" }, 404);
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
  return new Request(`${ORIGIN}${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const response = await route(await toRequest(req));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error("[dev server]", err);
    res.writeHead(500, { ...CORS, "content-type": "application/json" });
    res.end(JSON.stringify({ message: String(err) }));
  }
}).listen(PORT, () => console.log(`local backend on ${ORIGIN} (database ${new URL(DATABASE).pathname.slice(1)})`));
