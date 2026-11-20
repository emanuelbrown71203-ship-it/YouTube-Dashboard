// The order of the Ideas board. The owner writes an idea most days and never has to clear old ones,
// so inside each game the newest come first and older ones fold away under them. Games keep their
// usual order: the one with the most ideas first. Nothing here hides an idea for good or counts an
// unused one against anything.

/** The fields the order needs. sort_order is when the idea joined the board, in seconds. */
export interface Ordered {
  sort_order: number;
  priority: number;
  picked_at: string | null;
  status: string;
}

const making = (idea: Ordered) => Boolean(idea.picked_at) || idea.status !== "idea";

/**
 * The owner's own order inside a game: the ones they are making first, then by the priority they set
 * (high above normal above low), newest first within each.
 */
export const byNewest = (a: Ordered, b: Ordered) =>
  Number(making(b)) - Number(making(a)) || a.priority - b.priority || b.sort_order - a.sort_order;

/** Game sections, the one with the most ideas first; ideas with no game ("") always last. */
export function orderSections<T>(groups: Map<string, T[]>): [string, T[]][] {
  return [...groups.entries()].sort((x, y) =>
    Number(x[0] === "") - Number(y[0] === "") || y[1].length - x[1].length || x[0].localeCompare(y[0]));
}
