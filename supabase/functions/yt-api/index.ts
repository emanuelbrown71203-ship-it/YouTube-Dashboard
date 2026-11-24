// Entry point for the Supabase edge runtime (Deno). All logic lives in the
// other files, which are runtime-agnostic and covered by the test suite.

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import postgres from "npm:postgres@3.4.7";
import { handle, postgresTypes } from "./app.ts";
import { type Deps, HttpError } from "./google.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

/**
 * The public key Supabase Auth wants with every request. Supabase hands
 * functions a named set of keys; the older single key stops working at the
 * end of 2026 and is only read when the set is missing.
 */
function publicKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    const key = keys?.default ?? Object.values(keys ?? {})[0];
    if (typeof key === "string" && key) return key;
  } catch {
    // Not set, or not JSON: fall back to the older key.
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

const API_KEY = publicKey();

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 15,
  prepare: false,
  types: postgresTypes,
  onnotice: () => {},
});

const deps: Deps = {
  sql,
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  functionUrl: `${SUPABASE_URL}/functions/v1/yt-api`,
  verifyUser: async (accessToken) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { authorization: `Bearer ${accessToken}`, apikey: API_KEY },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === "string" ? user.id : null;
  },
  background: (work) => {
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  },
  log: (...args) => console.log(...args),
  // The AI that reads text for the owner (video descriptions, comments) and looks at the pictures they
  // ask it to score (a thumbnail). It never sees video. The key is the owner's own and comes from
  // yt_private on every call.
  claude: async (apiKey, req) => {
    // One try with a firm time limit: the caller works to a deadline and comes back for the rest.
    const client = new Anthropic({ apiKey, timeout: 80_000, maxRetries: 0 });
    try {
      const res = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        // If the model declines on policy grounds, let the API retry on its fallback.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: req.system,
        output_config: {
          effort: (req.effort ?? "low") as "low" | "medium" | "high",
          format: { type: "json_schema", schema: req.schema },
        },
        // Pictures go first, each after the line that says what it is; then what to do with them.
        messages: [{
          role: "user",
          content: req.images?.length
            ? [
              ...req.images.flatMap((img) => [
                { type: "text" as const, text: img.label },
                { type: "image" as const, source: { type: "base64" as const, media_type: img.media_type, data: img.data } },
              ]),
              { type: "text" as const, text: req.prompt },
            ]
            : req.prompt,
        }],
      });
      if (res.stop_reason === "refusal") throw new HttpError(422, "ai_declined", "The AI declined to read this one.");
      if (res.stop_reason === "max_tokens") throw new HttpError(502, "ai_error", "The AI's answer was cut short. Try again.");
      const text = res.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      return JSON.parse(text);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new HttpError(409, "ai_key", "Your Claude API key was not accepted. Check it in Settings.", String(err));
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new HttpError(429, "ai_busy", "The AI is busy or your Claude account is out of credit. Try again later.", String(err));
      }
      if (err instanceof Anthropic.APIError) {
        throw new HttpError(502, "ai_error", "The AI did not answer. Try again in a moment.", `${err.status} ${err.message}`);
      }
      throw new HttpError(502, "ai_error", "The AI's answer could not be read. Try again.", String(err));
    }
  },
};

Deno.serve((req) => handle(req, deps));
