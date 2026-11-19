// The Suggested tab's order: the newest batch on top, older suggestions out of the way below,
// so new ideas never sit under a growing pile of old ones.

import type { Idea } from "./types.ts";

/** When an idea was suggested: the batch it came in, shared by every idea of that batch. Unknown counts as old. */
export function suggestedAt(i: Idea): number {
  const t = Date.parse(i.suggestion?.batch ?? i.suggested_at ?? i.created_at);
  return Number.isFinite(t) ? t : 0;
}

/** Suggestions from up to a day before the newest batch count as part of it (follow-ups written just before it, say). */
const SAME_DROP_MS = 24 * 3_600_000;

/**
 * Splits waiting suggestions into the newest batch (with anything from the day before it and
 * anything suggested since, such as follow-ups) and the earlier ones, newest first. Before any
 * batch, all are new.
 */
export function splitByBatch(ideas: Idea[]): { fresh: Idea[]; earlier: Idea[] } {
  const batches = ideas.filter((i) => i.suggestion?.made_by !== "follow_up").map(suggestedAt);
  const from = batches.length ? Math.max(...batches) - SAME_DROP_MS : -Infinity;
  return {
    fresh: ideas.filter((i) => suggestedAt(i) >= from),
    earlier: ideas.filter((i) => suggestedAt(i) < from).sort((a, b) => suggestedAt(b) - suggestedAt(a)),
  };
}
