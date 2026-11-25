import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY;
export const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/yt-api`;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "yt-dashboard-session" },
});
