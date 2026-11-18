// Thumbnail references: which game a found video is about, and the list the owner browses.

import type { FoundThumb } from "./api.ts";
import { ideaGame } from "./ideaScore.ts";
import type { Idea, Video } from "./types.ts";

/** YouTube's pictures for a video. Small is always 16:9 with no bars; large may be missing, so it falls back. */
export const ytThumb = (id: string, size: "small" | "medium" | "large" = "small") =>
  size === "large" ? [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`]
    : size === "medium" ? [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`]
    : [`https://i.ytimg.com/vi/${id}/mqdefault.jpg`];

/** The owner's niche: the games their open ideas sit under, then the games they posted in the last year. */
export function currentGames(videos: Pick<Video, "topic" | "privacy" | "published_at">[], ideas: Pick<Idea, "topic" | "status">[], today: string): string[] {
  const yearAgo = new Date(Date.parse(today) - 365 * 86_400_000).toISOString();
  const fromIdeas = ideas.filter((i) => i.status !== "published").map((i) => i.topic?.trim()).filter((t): t is string => Boolean(t));
  const fromVideos = videos.filter((v) => v.topic && v.privacy === "public" && (v.published_at ?? "") >= yearAgo).map((v) => v.topic!);
  return [...new Set([...fromIdeas, ...fromVideos])];
}

/** The owner's game a found video is about, going by its title and tags; null = outside the niche. */
export const gameOfThumb = (row: Pick<FoundThumb, "title" | "tags">, games: string[]) =>
  ideaGame({ title: row.title ?? "", target_keyword: (row.tags ?? []).slice(0, 15).join(" "), concept: null, hook: null }, games);

export interface GalleryFilter {
  where: "mine" | "outside" | "all";
  /** Within the niche, one game only. */
  game: string | null;
  days: number;
  /** Only channels under 50,000 subscribers: what is working for channels nearer the owner's size. */
  small: boolean;
  sort: "jump" | "newest";
}

export interface GalleryItem extends FoundThumb { game: string | null }

/**
 * The thumbnails to show: videos that did at least 3x their channel's usual, never the owner's own.
 * One outside the owner's games has to be in YouTube's Gaming category: a broad search turns up
 * dance, fitness and drama videos as well.
 */
export function galleryItems(rows: FoundThumb[], games: string[], filter: GalleryFilter, today: string, ownChannel: string | null): GalleryItem[] {
  const since = Date.parse(today) - filter.days * 86_400_000;
  return rows
    .filter((r) => (r.outlier_score ?? 0) >= 3 && r.channel_id !== ownChannel && r.published_at && Date.parse(r.published_at) >= since)
    .filter((r) => !filter.small || (r.channel_subscribers !== null && r.channel_subscribers <= 50_000))
    .map((r) => ({ ...r, game: gameOfThumb(r, games) }))
    .filter((r) => r.game !== null || r.category === "20")
    .filter((r) => filter.where === "all" || (filter.where === "mine" ? r.game !== null && (!filter.game || r.game === filter.game) : r.game === null))
    .sort((a, b) => (filter.sort === "newest" ? (b.published_at ?? "").localeCompare(a.published_at ?? "") : (b.outlier_score ?? 0) - (a.outlier_score ?? 0)));
}
