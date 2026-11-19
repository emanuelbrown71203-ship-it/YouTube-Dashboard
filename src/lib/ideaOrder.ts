// The order of the Ideas board. The owner writes an idea most days and never has to clear old ones,
// so the newest ideas lead: inside each game the newest come first (older ones fold away under them),
// and the game with the newest idea comes first. Nothing here hides an idea for good or counts an
// unused one against anything.

/** The fields the order needs. sort_order is when the idea joined the board, in seconds. */
export interface Ordered {
  sort_order: number;
  priority: number;
  picked_at: string | null;
  status: string;
}

/** An idea that joined the board this recently is marked New. */
export const NEW_FOR_DAYS = 7;

/** When the idea joined the board: when it was written, or for a kept suggestion, when it was kept. */
export const joinedAt = (idea: Pick<Ordered, "sort_order">) => idea.sort_order * 1000;

export const isNew = (idea: Pick<Ordered, "sort_order">, now = Date.now()) => now - joinedAt(idea) < NEW_FOR_DAYS * 86_400_000;

const making = (idea: Ordered) => Boolean(idea.picked_at) || idea.status !== "idea";

/**
 * The owner's own order inside a game: the ones they are making first, then by the priority they set
 * (high above normal above low), newest first within each.
 */
export const byNewest = (a: Ordered, b: Ordered) =>
  Number(making(b)) - Number(making(a)) || a.priority - b.priority || b.sort_order - a.sort_order;

/** Game sections, the one with the newest idea first; ideas with no game ("") always last. */
export function orderSections<T extends Ordered>(groups: Map<string, T[]>): [string, T[]][] {
  const latest = (cards: T[]) => Math.max(...cards.map((c) => c.sort_order));
  return [...groups.entries()].sort((x, y) =>
    Number(x[0] === "") - Number(y[0] === "") || latest(y[1]) - latest(x[1]) || x[0].localeCompare(y[0]));
}
