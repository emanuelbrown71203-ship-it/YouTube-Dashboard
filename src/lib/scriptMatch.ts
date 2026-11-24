// Which upload a past script was for. The owner says so on My scripts; this only offers the most likely
// one ("Duo Honour Mode, Act 2" is "Honour Mode But I Only Use 2 Characters - Act 2"), never picks it.

import type { Video } from "./types.ts";

const SKIP = new Set(["the", "and", "with", "but", "can", "you", "beat", "only", "using", "this", "that", "for", "from", "outline", "script", "full", "game", "part"]);
const words = (text: string) =>
  new Set(text.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !SKIP.has(w)));

/** The long-form uploads a script could be for: same game first, then newest. */
export function scriptVideos(videos: Video[], topic: string | null | undefined): Video[] {
  const game = (topic ?? "").trim().toLowerCase();
  return videos
    .filter((v) => v.content_type === "long" && v.privacy === "public")
    .sort((a, b) => Number(Boolean(game) && (b.topic ?? "").toLowerCase() === game) - Number(Boolean(game) && (a.topic ?? "").toLowerCase() === game)
      || (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

/**
 * The upload a script most likely was for, or null when none is a clear match: most of the script's
 * own words in the video's title, on the same game when the script names one, and clearly ahead of
 * the next best (two Elden Ring DLC videos are left for the owner to tell apart).
 */
export function guessVideo(script: { title: string; topic?: string | null }, videos: Video[]): Video | null {
  const mine = words(script.title);
  if (mine.size === 0) return null;
  const game = (script.topic ?? "").trim().toLowerCase();
  const scored = scriptVideos(videos, script.topic)
    .filter((v) => !game || !v.topic || v.topic.toLowerCase() === game)
    .map((v) => {
      const theirs = words(v.title);
      const share = [...mine].filter((w) => theirs.has(w)).length / mine.size;
      // "Act 2" is not "Act 1": a number the script names has to be in the title too.
      const numbers = [...mine].filter((w) => /^\d+$/.test(w));
      return { v, share: numbers.length && !numbers.some((n) => theirs.has(n)) ? share / 2 : share };
    })
    .sort((a, b) => b.share - a.share);
  const [best, next] = scored;
  if (!best || best.share < 0.5) return null;
  if (next && best.share - next.share < 0.25) return null;
  return best.v;
}
