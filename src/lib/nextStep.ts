// What to do next on a video the owner is making: one step, never a list. The owner asked for the app
// to "show me what's next" (it was "a bit much for my ADHD brain"), so each video in production gets a
// single plain next step, worked out from how far along it is and what is already written.

import { day } from "./format.ts";
import type { Idea, IdeaStatus } from "./types.ts";

/** Where in the idea editor a step is done. */
export type Place = "script" | "editor" | "thumbnail" | "titles" | "plan";
export interface NextStep {
  text: string;
  place: Place | null;
  /** The step is to move the video to the next stage. */
  advance: boolean;
  /** The step is the first unticked box on the owner's own list. */
  fromList?: boolean;
}

export const STAGES: { key: IdeaStatus; label: string }[] = [
  { key: "idea", label: "To make" },
  { key: "scripting", label: "Scripting" },
  { key: "filming", label: "Filming" },
  { key: "editing", label: "Editing" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];
export const stageLabel = (status: IdeaStatus) => STAGES.find((s) => s.key === status)?.label ?? "To make";
export const nextStage = (status: IdeaStatus) => STAGES[STAGES.findIndex((s) => s.key === status) + 1] ?? null;

/** The first box not ticked yet in the outline or notes, as the owner wrote it. */
export function firstOpenBox(...texts: (string | null | undefined)[]): string | null {
  for (const line of texts.join("\n").split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(line);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

const has = (text: string | null | undefined) => Boolean((text ?? "").trim());

/** The one next step for a video in production. `cuts` and `thumbs` are what the owner added for it. */
export function nextStep(
  idea: Pick<Idea, "status" | "format" | "hook" | "concept" | "outline" | "notes" | "target_date" | "intro_check" | "title_check">,
  counts: { cuts: number; thumbs: number },
): NextStep {
  const box = firstOpenBox(idea.outline, idea.notes);
  const long = idea.format !== "short";
  switch (idea.status) {
    case "idea":
    case "scripting":
      if (!has(idea.hook)) return { text: "Write the hook: the first 5 seconds, line by line.", place: "script", advance: false };
      if (!has(idea.concept)) return { text: "Write what happens: the challenge, the stakes, how it ends.", place: "script", advance: false };
      if (!has(idea.outline)) return { text: "Outline the beats, in the order they happen.", place: "script", advance: false };
      if (box) return { text: box, place: "script", advance: false, fromList: true };
      if (!idea.intro_check) return { text: "Score your intro, then fix the weakest part.", place: "script", advance: false };
      return { text: "The script is ready. Move it to Filming.", place: null, advance: true };
    case "filming":
      if (box) return { text: box, place: "script", advance: false, fromList: true };
      return { text: "Film it, then move it to Editing.", place: null, advance: true };
    case "editing":
      if (counts.cuts === 0) return { text: "Bring in your cut's markers and leave notes for your editor.", place: "editor", advance: false };
      if (long && counts.thumbs === 0) return { text: "Make the thumbnail and add it.", place: "thumbnail", advance: false };
      if (!idea.title_check) return { text: "Score your titles and pick the strongest.", place: "titles", advance: false };
      return { text: "Ready: move it to Scheduled.", place: null, advance: true };
    case "scheduled":
      if (long && counts.thumbs === 0) return { text: "Add your thumbnail before it goes up.", place: "thumbnail", advance: false };
      if (!idea.target_date) return { text: "Set the day it goes up.", place: "plan", advance: false };
      return { text: `Goes up ${day(idea.target_date)}. Nothing left to do.`, place: null, advance: false };
    default:
      return { text: "It's out. Nothing left to do.", place: null, advance: false };
  }
}

/** "Due in 3 days", "Due today", "2 days late", or the date when it is further off. Null with no date. */
export function dueWord(date: string | null | undefined, today: string): string | null {
  if (!date) return null;
  const days = Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} late`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${day(date)}`;
}

/** The videos being made, the one due soonest first, then the one furthest along. */
export function makingOrder<T extends Pick<Idea, "target_date" | "status">>(ideas: T[]): T[] {
  const stage = (s: IdeaStatus) => STAGES.findIndex((x) => x.key === s);
  return [...ideas].sort((a, b) =>
    (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") || stage(b.status) - stage(a.status));
}
