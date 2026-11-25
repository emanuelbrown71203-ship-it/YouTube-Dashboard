// The three emotions a title can spark, as the owner colour-codes them in their notes, and the title
// length their own rules ask for.

export type Emotion = "curiosity" | "desire" | "fear";
export const EMOTION_LABEL: Record<Emotion, string> = { curiosity: "Curiosity", desire: "Desire", fear: "Fear" };

/**
 * The title length the owner's own rules give, when a rule says it ("45 to 55 characters",
 * "45-55 characters"). Null when no rule does.
 */
export function lengthRule(rules: string[]): { min: number; max: number } | null {
  for (const text of rules) {
    const m = /(\d{2,3})\s*(?:-|–|to)\s*(\d{2,3})\s*char/i.exec(text);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a > 0 && b >= a && b <= 150) return { min: a, max: b };
    }
  }
  return null;
}
