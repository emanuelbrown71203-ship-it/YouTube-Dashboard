// What to do next on a video the owner is making: one step, never a list. The owner asked for the app
// to "show me what's next" (it was "a bit much for my ADHD brain"), so each video in production gets a
// single plain next step, worked out from how far along it is and what is already written.

import { day } from "./format.ts";
import { checkCount } from "./notes.ts";
import type { Idea, IdeaStatus } from "./types.ts";

/** Where a step is done: the notebook page, or the part of the idea editor. The hook and its score are "intro". */
export type Place = "intro" | "script" | "editor" | "thumbnail" | "titles" | "plan";
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
      if (!has(idea.hook)) return { text: "Write the hook: the first 5 seconds, line by line.", place: "intro", advance: false };
      if (!has(idea.concept)) return { text: "Write what happens: the challenge, the stakes, how it ends.", place: "script", advance: false };
      if (!has(idea.outline)) return { text: "Outline the beats, in the order they happen.", place: "script", advance: false };
      if (box) return { text: box, place: "script", advance: false, fromList: true };
      if (!idea.intro_check) return { text: "Score your intro, then fix the weakest part.", place: "intro", advance: false };
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

/** The parts of making a video, in order. "pick" is deciding to make it at all. */
export type PlanStage = "pick" | "write" | "film" | "edit" | "post";
export const PLAN_STAGES: { key: PlanStage; label: string }[] = [
  { key: "pick", label: "Decide" },
  { key: "write", label: "Write it" },
  { key: "film", label: "Film it" },
  { key: "edit", label: "Edit it" },
  { key: "post", label: "Post it" },
];
/** The notebook page a step is done on. */
export type PlanPage = "plan" | "title" | "intro" | "script" | "editor" | "thumbnail" | "notes";
export interface PlanStep {
  key: string;
  text: string;
  stage: PlanStage;
  page: PlanPage;
  done: boolean;
  /** Not done, but the video has moved on past it. */
  passed: boolean;
}
export interface VideoPlan { steps: PlanStep[]; here: PlanStep | null; done: number; total: number }

/** Which part of making it the video is in now. Published videos are past all of it. */
function stageNow(idea: Pick<Idea, "status"> & { picked_at?: string | null }): number {
  const making = Boolean(idea.picked_at) || idea.status !== "idea";
  const at: Record<IdeaStatus, PlanStage> = { idea: "write", scripting: "write", filming: "film", editing: "edit", scheduled: "post", published: "post" };
  if (idea.status === "published") return PLAN_STAGES.length;
  return making ? PLAN_STAGES.findIndex((s) => s.key === at[idea.status]) : 0;
}

/**
 * The plan for one video: every step from deciding to make it to scheduling it, in the order the owner
 * does them, each ticked by what is already written or added (never by hand). The order inside each part
 * is the same as `nextStep`, so the plan and "Making now" agree. A step the video moved past without
 * doing is `passed`, not done. `here` is the first step still to do.
 */
export function planSteps(
  idea: Pick<Idea, "status" | "format" | "title" | "hook" | "concept" | "outline" | "notes" | "target_date" | "intro_check" | "title_check"> & { picked_at?: string | null },
  counts: { cuts: number; thumbs: number },
): VideoPlan {
  const now = stageNow(idea);
  const at = (s: PlanStage) => PLAN_STAGES.findIndex((x) => x.key === s);
  const steps: Omit<PlanStep, "passed">[] = [];
  const add = (key: string, stage: PlanStage, page: PlanPage, text: string, done: boolean) => steps.push({ key, stage, page, text, done });
  const published = idea.status === "published";

  add("pick", "pick", "plan", "Decide to make it", now > 0);
  add("title", "write", "title", "Write a title that names the game and the challenge", has(idea.title));
  add("hook", "write", "intro", "Write the hook: the first 5 seconds", has(idea.hook));
  add("concept", "write", "script", "Write what happens", has(idea.concept));
  add("outline", "write", "script", "Outline the beats", has(idea.outline));
  const inOutline = checkCount(idea.outline ?? ""), inNotes = checkCount(idea.notes ?? "");
  const boxes = { done: inOutline.done + inNotes.done, total: inOutline.total + inNotes.total };
  if (boxes.total) {
    add("list", "write", inOutline.total - inOutline.done > 0 || !inNotes.total ? "script" : "notes", `Tick off your list: ${boxes.done} of ${boxes.total}`, boxes.done === boxes.total);
  }
  add("intro", "write", "intro", "Score your intro and fix the weakest part", Boolean(idea.intro_check));
  add("film", "film", "plan", "Film it", ["editing", "scheduled", "published"].includes(idea.status));
  add("cuts", "edit", "editor", "Bring in your cut's markers for your editor", counts.cuts > 0);
  if (idea.format !== "short") add("thumb", "edit", "thumbnail", "Make the thumbnail and add it", counts.thumbs > 0);
  add("titles", "edit", "title", "Score your titles and pick the strongest", Boolean(idea.title_check));
  add("date", "post", "plan", "Set the day it goes up", has(idea.target_date) || published);
  add("schedule", "post", "plan", "Schedule it", idea.status === "scheduled" || published);

  const all = steps.map((s) => ({ ...s, passed: !s.done && at(s.stage) < now }));
  return {
    steps: all,
    here: all.find((s) => !s.done && !s.passed) ?? null,
    done: all.filter((s) => s.done).length,
    total: all.length,
  };
}
