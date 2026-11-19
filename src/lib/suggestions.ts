// The Suggested tab's order: the newest batch on top, older suggestions out of the way below,
// so new ideas never sit under a growing pile of old ones.

import type { Idea } from "./types.ts";

/** When an idea was suggested: the batch it came in, shared by every idea of that batch. Unknown counts as old. */
export function suggestedAt(i: Idea): number {
  const t = Date.parse(i.suggestion?.batch ?? i.suggested_at ?? i.created_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Splits waiting suggestions into the newest batch (with anything suggested since, such as
 * follow-ups that came after it) and the earlier ones, newest first. Before any batch, all are new.
 */
export function splitByBatch(ideas: Idea[]): { fresh: Idea[]; earlier: Idea[] } {
  const batches = ideas.filter((i) => i.suggestion?.made_by !== "follow_up").map(suggestedAt);
  const latest = batches.length ? Math.max(...batches) : -Infinity;
  return {
    fresh: ideas.filter((i) => suggestedAt(i) >= latest),
    earlier: ideas.filter((i) => suggestedAt(i) < latest).sort((a, b) => suggestedAt(b) - suggestedAt(a)),
  };
}
