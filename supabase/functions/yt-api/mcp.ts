// A connector for Claude: lets a Claude conversation read the channel's numbers and add ideas,
// lines and templates to the dashboard. Speaks the Model Context Protocol over plain HTTP.
//
// The address carries a long secret, made in Settings and stored only as a hash. Whoever holds the
// address can use these tools, so they are limited to reading the briefing and adding or editing the
// owner's own notes. Nothing here can remove a row, touch the stats, or read a key or a token.

import { type Deps, getConfig, HttpError, setConfig } from "./google.ts";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "This is the private dashboard of one YouTube gaming channel. Use get_channel_briefing before giving advice, so it rests on the channel's real numbers. " +
  "Shorts, long-form videos and live streams are three separate worlds: never compare or add up their views. " +
  "When the owner settles on video ideas, save them with add_ideas, each filed under its game (use list_games for the spellings in use). " +
  "Save a line they want to remember with add_lines, and a title, thumbnail or intro standard with save_template. " +
  "Say what you saved in one short sentence. Write to the owner in plain language: they are a creator, not a developer.";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Settings: is a connector address set, make a new one (the old one stops working), or switch it off. */
export async function mcpSetup(deps: Deps, body: { action?: unknown }) {
  const action = String(body.action ?? "status");
  if (action === "create") {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await setConfig(deps.sql, { mcp_token_hash: await sha256(token), mcp_created_at: deps.now().toISOString() });
    // The address is shown this once; only its hash is kept.
    return { connected: true, url: `${deps.functionUrl}/mcp/${token}` };
  }
  if (action === "remove") {
    await setConfig(deps.sql, { mcp_token_hash: "", mcp_created_at: "" });
    return { connected: false };
  }
  const cfg = await getConfig(deps.sql, ["mcp_token_hash", "mcp_created_at", "mcp_used_at"]);
  return { connected: Boolean(cfg.mcp_token_hash), created_at: cfg.mcp_created_at || null, used_at: cfg.mcp_used_at || null };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;
const text = (x: unknown, max: number): string | null => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
const need = (x: unknown, max: number, what: string): string => {
  const value = text(x, max);
  if (!value) throw new HttpError(400, "bad_request", `${what} is missing.`);
  return value;
};
const pick = <T extends string>(x: unknown, allowed: readonly T[], fallback: T | null): T | null =>
  (typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : fallback);
const uuid = (x: unknown, what: string): string => {
  if (typeof x !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(x)) throw new HttpError(400, "bad_request", `${what} is not a valid id.`);
  return x;
};
const date = (x: unknown): string | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
const list = (x: unknown): Args[] => (Array.isArray(x) ? x.filter((i): i is Args => typeof i === "object" && i !== null) : []);

const STATUSES = ["idea", "scripting", "filming", "editing", "scheduled", "published"] as const;
const FORMATS = ["long", "short"] as const;
const KINDS = ["title", "thumbnail", "intro", "other"] as const;

const IDEA_FIELDS = {
  title: { type: "string", description: "The working title." },
  format: { type: "string", enum: ["long", "short"], description: "long = a long-form video, short = a YouTube Short. Default long." },
  game: { type: "string", description: "The game or topic the idea sits under, spelled as list_games gives it (\"Elden Ring\")." },
  hook: { type: "string", description: "The first line or first five seconds." },
  concept: { type: "string", description: "What happens: the challenge, the stakes, how it ends." },
  outline: { type: "string", description: "Outline or script notes." },
  thumbnail_idea: { type: "string", description: "What the thumbnail shows and the words on it." },
  other_titles: { type: "array", items: { type: "string" }, description: "Up to five alternative titles." },
  made_for: { type: "string", enum: ["recommended", "search"], description: "recommended = the home feed and suggested videos; search = people typing a phrase." },
  search_phrase: { type: "string", description: "For made_for search: the phrase to rank for." },
  priority: { type: "integer", enum: [1, 2, 3], description: "1 high, 2 normal, 3 low." },
  target_date: { type: "string", description: "The day to post by, YYYY-MM-DD." },
  notes: { type: "string" },
} as const;

const TOOLS = [
  {
    name: "get_channel_briefing",
    description: "The channel's current numbers in one call: subscribers, the last 28 days against the 28 before, the split by format, recent and top uploads, where views come from, the ideas board, saved research and when the data was last synced. Read this before advising.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_games",
    description: "The games and topics the channel has covered, with how many long-form videos and Shorts each has and how they usually do against the channel's usual video of the same format (1 = the usual).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_ideas",
    description: "The ideas on the board that are not in the bin, with their game, stage and how they measured up to the owner's templates.",
    inputSchema: { type: "object", properties: { stage: { type: "string", enum: [...STATUSES] } }, additionalProperties: false },
  },
  {
    name: "add_ideas",
    description: "Adds one or more video ideas to the board. File each under its game. Returns the ids.",
    inputSchema: {
      type: "object", required: ["ideas"], additionalProperties: false,
      properties: { ideas: { type: "array", minItems: 1, maxItems: 25, items: { type: "object", required: ["title"], properties: IDEA_FIELDS } } },
    },
  },
  {
    name: "update_idea",
    description: "Changes an idea: any of its fields, its stage, or moves it to the bin (it can be brought back in the app).",
    inputSchema: {
      type: "object", required: ["id"], additionalProperties: false,
      properties: { id: { type: "string" }, ...IDEA_FIELDS, stage: { type: "string", enum: [...STATUSES] }, move_to_bin: { type: "boolean" } },
    },
  },
  {
    name: "list_lines",
    description: "The lines the owner saved to remember: things heard in podcasts and videos.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_lines",
    description: "Saves one or more lines the owner wants to remember. They show on the dashboard's front page.",
    inputSchema: {
      type: "object", required: ["lines"], additionalProperties: false,
      properties: {
        lines: {
          type: "array", minItems: 1, maxItems: 25,
          items: {
            type: "object", required: ["text"],
            properties: {
              text: { type: "string", description: "The line itself." }, source: { type: "string", description: "Where it came from: a podcast, a video, a person." },
              link: { type: "string", description: "A link to the source, starting with https://" }, topic: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "list_templates",
    description: "The owner's own templates: what their titles, thumbnails and intros should have. Follow these when suggesting titles, thumbnails or openings.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "save_template",
    description: "Adds a template, or changes one when given its id. The body is the owner's standard in their own words, usually one point per line.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "string", description: "Leave out to add a new template." }, kind: { type: "string", enum: [...KINDS] },
        name: { type: "string" }, body: { type: "string" }, active: { type: "boolean", description: "Whether ideas are checked against it. Default true." },
      },
    },
  },
] as const;

function ideaRow(a: Args) {
  const options = Array.isArray(a.other_titles) ? a.other_titles.map((t) => text(t, 200)).filter((t): t is string => Boolean(t)).slice(0, 5) : undefined;
  return {
    title: text(a.title, 200), format: pick(a.format, FORMATS, null), topic: text(a.game, 80), hook: text(a.hook, 600),
    concept: text(a.concept, 4000), outline: text(a.outline, 12000), thumbnail_concept: text(a.thumbnail_idea, 400), title_options: options,
    discovery: pick(a.made_for, ["recommended", "search"] as const, null), target_keyword: text(a.search_phrase, 80),
    priority: [1, 2, 3].includes(Number(a.priority)) ? Number(a.priority) : null, target_date: date(a.target_date), notes: text(a.notes, 4000),
  };
}

async function callTool(deps: Deps, name: string, a: Args): Promise<unknown> {
  const { sql } = deps;
  switch (name) {
    case "get_channel_briefing": {
      const [{ briefing }] = await sql`select public.yt_claude_context() as briefing`;
      return briefing;
    }
    case "list_games":
      return await sql`
        select topic as game,
               count(*) filter (where content_type = 'long')::int as long_form_videos,
               count(*) filter (where content_type = 'short')::int as shorts,
               round((percentile_cont(0.5) within group (order by vs_typical) filter (where content_type = 'long'))::numeric, 2) as long_form_times_usual,
               round((percentile_cont(0.5) within group (order by vs_typical) filter (where content_type = 'short'))::numeric, 2) as shorts_times_usual,
               max(published_at)::date as last_upload
        from public.yt_v_videos where topic is not null and privacy = 'public' group by topic order by count(*) desc limit 80`;
    case "list_ideas": {
      const stage = pick(a.stage, STATUSES, null);
      return await sql`
        select id, title, format, topic as game, status as stage, priority, target_date, hook, concept, thumbnail_concept as thumbnail_idea,
               title_options as other_titles, (template_check->>'score')::int as template_score, created_at::date as added
        from public.yt_ideas where trashed_at is null and not archived and (${stage}::text is null or status = ${stage})
        order by status, priority, created_at desc limit 200`;
    }
    case "add_ideas": {
      const rows = list(a.ideas).slice(0, 25).map(ideaRow);
      if (rows.length === 0) throw new HttpError(400, "bad_request", "Give at least one idea.");
      const added = [];
      for (const r of rows) {
        if (!r.title) throw new HttpError(400, "bad_request", "Every idea needs a title.");
        const [row] = await sql`
          insert into public.yt_ideas (title, format, topic, hook, concept, outline, thumbnail_concept, title_options, discovery, target_keyword, priority, target_date, notes, source)
          values (${r.title}, ${r.format ?? "long"}, ${r.topic}, ${r.hook}, ${r.concept}, ${r.outline}, ${r.thumbnail_concept}, ${r.title_options ?? []},
                  ${r.discovery}, ${r.target_keyword}, ${r.priority ?? 2}, ${r.target_date}, ${r.notes}, 'claude')
          returning id, title, topic as game, format`;
        added.push(row);
      }
      return { added };
    }
    case "update_idea": {
      const id = uuid(a.id, "The idea");
      const r = ideaRow(a);
      const stage = pick(a.stage, STATUSES, null);
      const bin = a.move_to_bin === true;
      const [row] = await sql`
        update public.yt_ideas set
          title = coalesce(${r.title}, title), format = coalesce(${r.format}, format), topic = coalesce(${r.topic}, topic),
          hook = coalesce(${r.hook}, hook), concept = coalesce(${r.concept}, concept), outline = coalesce(${r.outline}, outline),
          thumbnail_concept = coalesce(${r.thumbnail_concept}, thumbnail_concept),
          title_options = coalesce(${r.title_options ?? null}::text[], title_options),
          discovery = coalesce(${r.discovery}, discovery), target_keyword = coalesce(${r.target_keyword}, target_keyword),
          priority = coalesce(${r.priority}, priority), target_date = coalesce(${r.target_date}::date, target_date),
          notes = coalesce(${r.notes}, notes), status = coalesce(${stage}, status),
          trashed_at = case when ${bin} then now() else trashed_at end
        where id = ${id} and trashed_at is null
        returning id, title, topic as game, format, status as stage, trashed_at is not null as in_bin`;
      if (!row) throw new HttpError(404, "not_found", "No idea with that id is on the board.");
      return row;
    }
    case "list_lines":
      return await sql`
        select id, text, source, source_url as link, topic, on_front as on_front_page, created_at::date as added
        from public.yt_notes where trashed_at is null order by created_at desc limit 200`;
    case "add_lines": {
      const rows = list(a.lines).slice(0, 25);
      if (rows.length === 0) throw new HttpError(400, "bad_request", "Give at least one line.");
      const added = [];
      for (const r of rows) {
        const link = text(r.link, 500);
        const [row] = await sql`
          insert into public.yt_notes (text, source, source_url, topic)
          values (${need(r.text, 2000, "The line")}, ${text(r.source, 200)}, ${link && /^https?:\/\//i.test(link) ? link : null}, ${text(r.topic, 80)})
          returning id, text`;
        added.push(row);
      }
      return { added };
    }
    case "list_templates":
      return await sql`
        select id, kind, name, body, active from public.yt_templates where trashed_at is null order by kind, created_at limit 50`;
    case "save_template": {
      const active = typeof a.active === "boolean" ? a.active : null;
      if (a.id) {
        const [row] = await sql`
          update public.yt_templates set
            kind = coalesce(${pick(a.kind, KINDS, null)}, kind), name = coalesce(${text(a.name, 120)}, name),
            body = coalesce(${text(a.body, 8000)}, body), active = coalesce(${active}, active)
          where id = ${uuid(a.id, "The template")} and trashed_at is null returning id, kind, name, active`;
        if (!row) throw new HttpError(404, "not_found", "No template with that id.");
        return row;
      }
      const kind = pick(a.kind, KINDS, null);
      if (!kind) throw new HttpError(400, "bad_request", "Say what the template is for: title, thumbnail, intro or other.");
      const [row] = await sql`
        insert into public.yt_templates (kind, name, body, active)
        values (${kind}, ${need(a.name, 120, "The template's name")}, ${need(a.body, 8000, "The template itself")}, ${active ?? true})
        returning id, kind, name, active`;
      return row;
    }
    default:
      throw new HttpError(404, "not_found", `There is no tool called ${name}.`);
  }
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

async function answer(deps: Deps, msg: Message): Promise<Record<string, unknown> | null> {
  // A message with no id is a notification: nothing is sent back.
  if (msg.id === undefined || msg.id === null) return null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const refuse = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "youtube-dashboard", title: "YouTube Dashboard", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (typeof msg.params?.arguments === "object" && msg.params?.arguments) || {};
      try {
        const out = await callTool(deps, name, args as Args);
        return reply({ content: [{ type: "text", text: JSON.stringify(out) }], isError: false });
      } catch (err) {
        if (!(err instanceof HttpError)) deps.log?.("connector tool failed", name, String(err));
        // A tool that fails tells the model why, so it can put it right or tell the owner.
        const why = err instanceof HttpError ? err.message : "That did not work on the dashboard's side. Try again in a moment.";
        return reply({ content: [{ type: "text", text: why }], isError: true });
      }
    }
    default:
      return refuse(-32601, `Method not found: ${msg.method ?? ""}`);
  }
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/** Everything under /mcp/<secret>. */
export async function handleMcp(req: Request, deps: Deps, token: string): Promise<Response> {
  const { mcp_token_hash: hash } = await getConfig(deps.sql, ["mcp_token_hash"]);
  if (!hash || !/^[0-9a-f]{64}$/.test(token) || !sameText(await sha256(token), hash)) {
    return new Response(JSON.stringify({ error: "This connector address is not valid any more. Make a new one in the dashboard's Settings." }), { status: 401, headers: HEADERS });
  }
  // No stream to listen on and no session to end: only requests.
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: HEADERS });
  }
  const many = Array.isArray(body);
  const messages = (many ? body : [body]) as Message[];
  const replies = [];
  for (const msg of messages) {
    const out = await answer(deps, typeof msg === "object" && msg !== null ? msg : {});
    if (out) replies.push(out);
  }
  if (messages.some((m) => m?.method === "tools/call")) {
    await setConfig(deps.sql, { mcp_used_at: deps.now().toISOString() }).catch(() => undefined);
  }
  if (replies.length === 0) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(many ? replies : replies[0]), { status: 200, headers: HEADERS });
}
