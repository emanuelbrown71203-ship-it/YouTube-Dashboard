// Entry point for the Supabase edge runtime (Deno). All logic lives in the
// other files, which are runtime-agnostic and covered by the test suite.

import postgres from "npm:postgres@3.4.7";
import { handle, postgresTypes } from "./app.ts";
import type { Deps } from "./google.ts";

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
};

Deno.serve((req) => handle(req, deps));
