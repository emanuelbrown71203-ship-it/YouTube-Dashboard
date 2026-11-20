// The Suggested tab's order: the newest batch on top, older suggestions out of the way below,
// so new ideas never sit under a growing pile of old ones.

import type { Idea } from "./types.ts";

/** When an idea was suggested: the batch it came in, shared by every idea of that batch. Unknown counts as old. */
export function suggestedAt(i: Idea): number {
  const t = Date.parse(i.suggestion?.batch ?? i.suggested_at ?? i.created_at);
  return Number.isFinite(t) ? t : 0;
}

/** Follow-ups to a hot upload written up to a day before the newest batch still count as new. */
const FOLLOW_UP_GRACE_MS = 24 * 3_600_000;

const isFollowUp = (i: Idea) => i.suggestion?.made_by === "follow_up";

/**
 * Splits waiting suggestions into the newest batch and the earlier ones, newest first. Only the
 * newest batch is new: a batch from minutes before it (the owner tapping Give me more again) is
 * already earlier. Follow-ups suggested since the newest batch, or in the day before it, stay with
 * it. Before any batch, all are new.
 */
export function splitByBatch(ideas: Idea[]): { fresh: Idea[]; earlier: Idea[] } {
  const batches = ideas.filter((i) => !isFollowUp(i)).map(suggestedAt);
  const newest = batches.length ? Math.max(...batches) : -Infinity;
  const isFresh = (i: Idea) => suggestedAt(i) >= (isFollowUp(i) ? newest - FOLLOW_UP_GRACE_MS : newest);
  return {
    fresh: ideas.filter(isFresh),
    earlier: ideas.filter((i) => !isFresh(i)).sort((a, b) => suggestedAt(b) - suggestedAt(a)),
  };
}
