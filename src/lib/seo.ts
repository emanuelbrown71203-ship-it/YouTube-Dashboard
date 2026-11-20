// Plain checks on my own uploads: things that are cheap to fix and easy to miss.

import type { Video } from "./types.ts";

export type CheckKey = "tags_off_topic" | "title_missing_topic" | "duplicate_title" | "hashtags" | "title_long";

export interface Check {
  key: CheckKey;
  level: "fix" | "tip";
  detail: string;
}

export const CHECK_LABEL: Record<CheckKey, string> = {
  tags_off_topic: "Tags copied from another video",
  title_missing_topic: "Title never names the topic",
  duplicate_title: "Same title as another upload",
  hashtags: "Title crowded with hashtags",
  title_long: "Long title",
};

const GENERIC = new Set([
  "the", "and", "for", "with", "you", "can", "but", "only", "this", "that", "what", "how", "from", "have", "not", "all",
  "challenge", "run", "runs", "gameplay", "game", "games", "gaming", "full", "best", "new", "video", "videos", "stream",
  "live", "mode", "part", "playthrough", "walkthrough", "guide", "tips", "funny", "moments", "first", "time", "beat",
]);

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3);

/** The word most of a video's tags revolve around, if there is one. */
export function dominantTagWord(tags: string[]): string | null {
  if (tags.length < 5) return null;
  const counts = new Map<string, number>();
  for (const tag of tags) for (const w of new Set(words(tag))) if (!GENERIC.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const [word, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return word && n / tags.length >= 0.4 ? word : null;
}

export function titleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

export function auditVideo(video: Video, titleCounts: Map<string, number>): Check[] {
  const checks: Check[] = [];
  const title = video.title ?? "";
  const tags = video.tags ?? [];

  const dominant = dominantTagWord(tags);
  if (dominant && !words(title).includes(dominant)) {
    const titleWords = new Set(words(title).filter((w) => !GENERIC.has(w)));
    const tagWords = new Set(tags.flatMap(words));
    const overlap = [...titleWords].some((w) => tagWords.has(w));
    checks.push(overlap
      ? {
        key: "title_missing_topic", level: "tip",
        detail: `The tags are about "${dominant}" but the title never says it, so someone searching for it can't tell this video is for them.`,
      }
      : {
        key: "tags_off_topic", level: "fix",
        detail: `Most tags are about "${dominant}", which the title never mentions. They look copied from a different upload.`,
      });
  }

  const sameTitle = titleCounts.get(titleKey(title)) ?? 0;
  if (title && sameTitle > 1) {
    checks.push({
      key: "duplicate_title", level: "tip",
      detail: `${sameTitle} uploads share this exact title. They compete with each other in search and look identical in a list.`,
    });
  }

  const tagsInTitle = title.match(/#\S+/g) ?? [];
  const bare = title.replace(/\s*#\S+/g, "").trim();
  if (tagsInTitle.length > 3) {
    checks.push({
      key: "hashtags", level: "tip",
      detail: `${tagsInTitle.length} hashtags take up ${title.length - bare.length} of the title's ${title.length} characters. YouTube's own advice is to keep them few: each one you add makes the others count for less. They work just as well in the description.`,
    });
  }
  if (bare.length > 70) {
    checks.push({
      key: "title_long", level: "tip",
      detail: `${bare.length} characters. Most screens show only the first 60 to 70, so the end may never be seen.`,
    });
  }
  return checks;
}

export function auditAll(videos: Video[]): Map<string, Check[]> {
  const titleCounts = new Map<string, number>();
  for (const v of videos) {
    if (v.privacy !== "public" || !v.title) continue;
    const key = titleKey(v.title);
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  const out = new Map<string, Check[]>();
  for (const v of videos) {
    const checks = v.privacy === "public" ? auditVideo(v, titleCounts) : [];
    if (checks.length) out.set(v.id, checks);
  }
  return out;
}
