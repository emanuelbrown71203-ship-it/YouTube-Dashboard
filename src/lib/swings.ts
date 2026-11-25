// Daily idea swings: the owner's 15-minute routine for writing ideas, read from their own "Daily idea
// swings" template so the app follows whatever they change there. Three swings write a new idea (a full
// game, one slice of a game, a Short); the fourth pushes an idea already on the board higher with one of
// their score levers.

import type { Idea } from "./types.ts";

export type SwingKind = "full" | "segment" | "short" | "upgrade";
export interface SwingPart { kind: SwingKind; label: string; minutes: number; lines: string[] }
export interface SwingGuide { parts: SwingPart[]; levers: string[] }

/** The owner's own routine, as they first wrote it: used when the template is missing or a part of it is. */
const DEFAULT: SwingGuide = {
  parts: [
    { kind: "full", label: "Full game swing", minutes: 5, lines: ["A whole game challenge, beginning to credits", "Formula: [Big game] + [proven hook] + [twist]", "Example: Can 4 People With \"0 Hours\" Beat BG3 Honour Mode? One wipe deletes the save"] },
    { kind: "segment", label: "Segmented game swing", minutes: 5, lines: ["One act, isle, area or boss", "Has to finish in 1-2 streams", "Formula: [Slice of a game] + [restriction] + [what makes it worse]", "Example: Beat Margit With Only What the First Merchant Sells. He sells 3 things"] },
    { kind: "short", label: "Short swing", minutes: 2, lines: ["One moment, one story, from what I played today", "Example: The second Patty dropped all his runes in front of Margit"] },
    { kind: "upgrade", label: "Upgrade swing", minutes: 3, lines: ["Take one 70-something idea already on the board", "Add one lever below to push it to 80+", "Upgrading is the fastest way to a 90"] },
  ],
  levers: [
    "Proven hook: \"0 hours\", a group, 24 hours, every game",
    "Big community: Elden Ring, BG3",
    "Expectations < reality: harder than the title says",
    "Stakes in one line: one death ends it, one wipe deletes the save",
    "Before/after thumbnail: 0 hours | ?? hours, LVL 1 | LVL 100",
  ],
};

const KIND_OF: [RegExp, SwingKind | "levers"][] = [[/full/i, "full"], [/segment/i, "segment"], [/short/i, "short"], [/upgrade/i, "upgrade"], [/lever/i, "levers"]];
const LABEL: Record<SwingKind, string> = { full: "Full game swing", segment: "Segmented game swing", short: "Short swing", upgrade: "Upgrade swing" };

/** The routine from the owner's template text: each heading with its minutes and its points, and the levers. */
export function parseSwings(body: string | null | undefined): SwingGuide {
  if (!body?.trim()) return DEFAULT;
  const found: Partial<Record<SwingKind, SwingPart>> = {};
  let levers: string[] | null = null;
  for (const block of body.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const kind = KIND_OF.find(([re]) => re.test(lines[0]))?.[1];
    if (!kind) continue;
    const points = lines.slice(1).map((l) => l.replace(/^[-*•]\s+(?:\[[ xX]\]\s+)?/, "").trim()).filter(Boolean);
    if (kind === "levers") { levers = points; continue; }
    const minutes = Number(/\((\d+)\s*min/i.exec(lines[0])?.[1] ?? DEFAULT.parts.find((p) => p.kind === kind)!.minutes);
    found[kind] = { kind, label: LABEL[kind], minutes, lines: points };
  }
  return {
    parts: DEFAULT.parts.map((p) => found[p.kind] ?? p),
    levers: levers && levers.length ? levers : DEFAULT.levers,
  };
}

/** Today in the owner's own time zone, as their device sees it. */
export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The best of an idea's two scores, or null before it has either. */
export const bestScore = (s: { history: { value: number | null }; recommended: { value: number | null } } | undefined) => {
  const values = [s?.history.value, s?.recommended.value].filter((v): v is number => typeof v === "number");
  return values.length ? Math.max(...values) : null;
};

/**
 * Today's idea to upgrade: one still on the board whose best score is in the 70s, a different one each day.
 * Ideas not being made yet come first (that is what the board is for); one already in production only when
 * no plain idea is in the 70s; failing all that, the highest one under 80. Never one that is out. `skip`
 * passes over ones the owner asked to swap.
 */
export function pickUpgrade<T extends Pick<Idea, "id" | "status"> & { picked_at?: string | null }>(
  ideas: T[], scoreOf: (id: string) => number | null, day: string, skip: string[] = [],
): T | null {
  const scored = ideas.filter((i) => i.status !== "published" && !skip.includes(i.id)).map((i) => ({ i, s: scoreOf(i.id) })).filter((x) => x.s !== null);
  const plain = scored.filter((x) => x.i.status === "idea" && !x.i.picked_at);
  const making = scored.filter((x) => !plain.includes(x));
  const turn = [...day].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  for (const pool of [plain, making]) {
    const seventies = pool.filter((x) => x.s! >= 70 && x.s! < 80).sort((a, b) => b.s! - a.s! || a.i.id.localeCompare(b.i.id));
    if (seventies.length) return seventies[turn % seventies.length].i;
  }
  for (const pool of [plain, making]) {
    const under = pool.filter((x) => x.s! < 80).sort((a, b) => b.s! - a.s!);
    if (under.length) return under[0].i;
  }
  return null;
}

export interface SwingRow { id: string; day: string; kind: SwingKind; idea_id: string | null; levers: string[] }

/** The swings done on a day. */
export const doneOn = (rows: SwingRow[], day: string) => new Set(rows.filter((r) => r.day === day).map((r) => r.kind));

/** Days in a row with at least one swing, counting back from today (or from yesterday, before today's first). */
export function streak(rows: SwingRow[], today: string): number {
  const days = new Set(rows.map((r) => r.day));
  const back = (d: string, n: number) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  let start = days.has(today) ? today : back(today, 1);
  let n = 0;
  while (days.has(start)) {
    n++;
    start = back(start, 1);
  }
  return n;
}
