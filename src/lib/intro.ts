// Reading an intro score in the browser: which lines spark which emotion, whether the intro has changed
// since it was scored, and the one-line summary. The score itself comes from the server (/ai/intro).

import { introLayout } from "../../supabase/functions/yt-api/scoring.ts";
import type { IntroCheck } from "./api.ts";
import { EMOTION_LABEL, type Emotion } from "./emotions.ts";

const squash = (text: string | null | undefined) => String(text ?? "").replace(/\s+/g, " ").trim();

/** Has the intro changed since it was scored? Spacing and blank lines do not count. */
export const introChanged = (check: Pick<IntroCheck, "intro">, hook: string | null | undefined) => squash(check.intro) !== squash(hook);

/** The intro as it was scored, each line with the emotions it sparks. Directions in [brackets] spark none. */
export function scoredLines(check: Pick<IntroCheck, "intro" | "lines">) {
  const byN = new Map(check.lines.map((l) => [l.n, l.emotions]));
  return introLayout(check.intro).map((l) => ({ ...l, emotions: l.n === null ? [] : byN.get(l.n) ?? [] }));
}

/** How many spoken lines spark each emotion, and how many spark none. */
export function emotionCounts(check: Pick<IntroCheck, "intro" | "lines">) {
  const spoken = scoredLines(check).filter((l) => l.n !== null);
  const count = (e: Emotion) => spoken.filter((l) => l.emotions.includes(e)).length;
  return { curiosity: count("curiosity"), desire: count("desire"), fear: count("fear"), none: spoken.filter((l) => l.emotions.length === 0).length, spoken: spoken.length };
}

/** "Curiosity in 7 of 16 lines, desire in 1, fear in none." */
export function emotionSummary(counts: ReturnType<typeof emotionCounts>): string {
  const order: Emotion[] = ["curiosity", "desire", "fear"];
  const said = order.map((e, i) => {
    const n = counts[e];
    const label = i === 0 ? EMOTION_LABEL[e] : EMOTION_LABEL[e].toLowerCase();
    if (i === 0) return `${label} in ${n === 0 ? "no" : n} of ${counts.spoken} ${counts.spoken === 1 ? "line" : "lines"}`;
    return `${label} in ${n === 0 ? "none" : n}`;
  });
  return `${said.join(", ")}.`;
}
