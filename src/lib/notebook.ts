// The notebook: everything the owner wrote, one page at a time. The videos being made come first, then
// each game as a chapter (the same order as the board), then their notes, a page per heading. The owner
// asked for their ideas to feel like "scrolling through a notebook", one page at a time.

import { byNewest, orderSections } from "./ideaOrder.ts";
import { makingOrder } from "./nextStep.ts";
import type { Idea } from "./types.ts";

export interface NoteLike { id: string; text: string; source: string | null }
export type NotebookPage =
  | { kind: "idea"; key: string; chapter: string; idea: Idea }
  | { kind: "note"; key: string; chapter: string; noteId: string; heading: string; body: string; part: number | null };
export interface Chapter { name: string; start: number; count: number }

export const MAKING = "Making now";
export const NOTES = "My notes";
/** Decided to make, and not out yet. */
const inMaking = (i: Pick<Idea, "picked_at" | "status">) => (Boolean(i.picked_at) || i.status !== "idea") && i.status !== "published";
const isBullet = (line: string) => /^\s*[-*•]\s+/.test(line);

const blocksOf = (text: string) => text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

/**
 * A note as pages. A note written in parts (a heading line, then its points, the parts apart by a blank
 * line, like the notes from a drive) gets a page per part; any other note is one page.
 */
export function notePages(note: NoteLike): { heading: string; body: string; part: number | null }[] {
  const blocks = blocksOf(note.text);
  const parts = blocks.map((b, part) => {
    const [first, ...rest] = b.split("\n");
    return isBullet(first) ? null : { heading: first.trim(), body: rest.join("\n").trim(), part };
  });
  if (blocks.length > 1 && parts.every(Boolean)) return parts as { heading: string; body: string; part: number }[];
  return [{ heading: note.source?.trim() || "A line to remember", body: note.text.trim(), part: null }];
}

/** The note's text with one part's points replaced (a box ticked on its page); the whole note when `part` is null. */
export function withNotePart(text: string, part: number | null, body: string): string {
  if (part === null) return body;
  const blocks = blocksOf(text);
  const heading = blocks[part]?.split("\n")[0] ?? "";
  blocks[part] = body.trim() ? `${heading}\n${body.trim()}` : heading;
  return blocks.join("\n\n");
}

/** Every page of the notebook, in order, and where each chapter starts. */
export function buildNotebook(ideas: Idea[], notes: NoteLike[]): { pages: NotebookPage[]; chapters: Chapter[] } {
  const pages: NotebookPage[] = [];
  const chapters: Chapter[] = [];
  const open = (name: string) => chapters.push({ name, start: pages.length, count: 0 });
  const add = (page: NotebookPage) => {
    pages.push(page);
    chapters[chapters.length - 1].count++;
  };
  const making = makingOrder(ideas.filter(inMaking));
  if (making.length) {
    open(MAKING);
    for (const idea of making) add({ kind: "idea", key: `idea-${idea.id}`, chapter: MAKING, idea });
  }
  const groups = new Map<string, Idea[]>();
  for (const idea of ideas) {
    if (idea.status === "published" || inMaking(idea)) continue;
    const game = idea.topic?.trim() ?? "";
    groups.set(game, [...(groups.get(game) ?? []), idea]);
  }
  for (const [game, list] of orderSections(groups)) {
    const name = game || "No game yet";
    open(name);
    for (const idea of [...list].sort(byNewest)) add({ kind: "idea", key: `idea-${idea.id}`, chapter: name, idea });
  }
  if (notes.length) {
    open(NOTES);
    for (const note of notes) {
      notePages(note).forEach((p, i) => add({ kind: "note", key: `note-${note.id}-${i}`, chapter: NOTES, noteId: note.id, ...p }));
    }
  }
  return { pages, chapters };
}
