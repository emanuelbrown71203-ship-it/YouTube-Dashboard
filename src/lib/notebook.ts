// The notebook: everything the owner wrote, one page at a time. The videos being made come first, then
// each game as a chapter (the same order as the board), then their notes, a page per heading. Each video
// is a set of pages in the order it is made: its plan, title, intro, script, notes for the editor,
// thumbnail and notes. The owner asked for "everything its own piece of paper" and their plan at the
// beginning of each video.

import { byNewest, orderSections } from "./ideaOrder.ts";
import { makingOrder, type PlanPage } from "./nextStep.ts";
import type { Idea } from "./types.ts";

export interface NoteLike { id: string; text: string; source: string | null }

/** A video's pages, in the order the owner works through them; the plan comes first. */
export type PageKind = PlanPage;
export const PAGE_NAMES: Record<PageKind, string> = {
  plan: "Plan", title: "Title", intro: "Intro", script: "Script", editor: "For my editor", thumbnail: "Thumbnail", notes: "Notes",
};
/** The same, short enough for the divider tabs on a phone. */
export const TAB_NAMES: Record<PageKind, string> = {
  plan: "Plan", title: "Title", intro: "Intro", script: "Script", editor: "Editor", thumbnail: "Thumb", notes: "Notes",
};
const ORDER: PageKind[] = ["plan", "title", "intro", "script", "editor", "thumbnail", "notes"];
/** The pages of one video. A Short has no thumbnail page. */
export const videoPages = (format: string | null | undefined): PageKind[] => ORDER.filter((k) => k !== "thumbnail" || format !== "short");
/** The page a step from "Making now" is done on. */
export function pageOfPlace(place: string | null | undefined): PageKind {
  const pages: Record<string, PageKind> = { intro: "intro", script: "script", editor: "editor", thumbnail: "thumbnail", titles: "title", plan: "plan" };
  return pages[place ?? ""] ?? "plan";
}
export const pageKey = (ideaId: string, page: PageKind) => `idea-${ideaId}-${page}`;

export type NotebookPage =
  | { kind: "idea"; key: string; chapter: string; entry: number; idea: Idea; page: PageKind }
  | { kind: "note"; key: string; chapter: string; entry: number; noteId: string; heading: string; body: string; part: number | null };
/** One video or one note, and the pages it fills. */
export interface Entry { key: string; label: string; start: number; count: number; ideaId: string | null }
export interface Chapter { name: string; start: number; count: number; entries: Entry[] }

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

/**
 * What a note is called in Contents and above its page. One written in parts goes by where it came from
 * ("Notes from my drive"); a single line goes by its own first words, since several lines can share a source.
 */
export function noteName(note: NoteLike, parts: number): string {
  const source = note.source?.trim();
  if (parts > 1 && source) return source;
  const first = note.text.split("\n").map((l) => l.replace(/^\s*[-*•]\s+(?:\[[ xX]\]\s+)?/, "").trim()).find(Boolean) ?? "";
  if (!first) return source || "A line to remember";
  return first.length > 70 ? `${first.slice(0, 68).trimEnd()}…` : first;
}

/** The note's text with one part's points replaced (a box ticked on its page); the whole note when `part` is null. */
export function withNotePart(text: string, part: number | null, body: string): string {
  if (part === null) return body;
  const blocks = blocksOf(text);
  const heading = blocks[part]?.split("\n")[0] ?? "";
  blocks[part] = body.trim() ? `${heading}\n${body.trim()}` : heading;
  return blocks.join("\n\n");
}

/**
 * Every page of the notebook, in order, and where each chapter and each video starts. A video fills one
 * page per part of making it (its plan first); a note fills a page per part it was written in.
 */
export function buildNotebook(ideas: Idea[], notes: NoteLike[]): { pages: NotebookPage[]; chapters: Chapter[]; entries: Entry[] } {
  const pages: NotebookPage[] = [];
  const chapters: Chapter[] = [];
  const entries: Entry[] = [];
  const open = (name: string) => chapters.push({ name, start: pages.length, count: 0, entries: [] });
  const begin = (key: string, label: string, ideaId: string | null) => {
    const entry = { key, label, start: pages.length, count: 0, ideaId };
    entries.push(entry);
    chapters[chapters.length - 1].entries.push(entry);
    return entries.length - 1;
  };
  const add = (page: NotebookPage) => {
    pages.push(page);
    chapters[chapters.length - 1].count++;
    entries[page.entry].count++;
  };
  const video = (idea: Idea, chapter: string) => {
    const entry = begin(`idea-${idea.id}`, idea.title, idea.id);
    for (const page of videoPages(idea.format)) add({ kind: "idea", key: pageKey(idea.id, page), chapter, entry, idea, page });
  };
  const making = makingOrder(ideas.filter(inMaking));
  if (making.length) {
    open(MAKING);
    for (const idea of making) video(idea, MAKING);
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
    for (const idea of [...list].sort(byNewest)) video(idea, name);
  }
  if (notes.length) {
    open(NOTES);
    for (const note of notes) {
      const parts = notePages(note);
      const entry = begin(`note-${note.id}`, noteName(note, parts.length), null);
      parts.forEach((p, i) => add({ kind: "note", key: `note-${note.id}-${i}`, chapter: NOTES, entry, noteId: note.id, ...p }));
    }
  }
  return { pages, chapters, entries };
}

/** Where a remembered page is now: the same page, or the plan of the same video for a key from before pages. */
export function findPage(pages: { key: string }[], key: string | null): number {
  if (!key) return -1;
  const at = pages.findIndex((p) => p.key === key);
  return at >= 0 ? at : pages.findIndex((p) => p.key === `${key}-plan`);
}

/** Videos and notes whose name has every word typed, in the notebook's order, each with its chapter. */
export function tocMatches(chapters: Chapter[], find: string): { entry: Entry; chapter: string }[] {
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return chapters.flatMap((c) => c.entries
    .filter((e) => words.every((w) => `${e.label} ${c.name}`.toLowerCase().includes(w)))
    .map((entry) => ({ entry, chapter: c.name })));
}
