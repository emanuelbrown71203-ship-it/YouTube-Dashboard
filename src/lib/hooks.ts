// Cached reads for the screens. Everything is refetched when the tab regains focus.

import { useQuery } from "@tanstack/react-query";
import * as api from "./api.ts";
import type { ResearchRun } from "./types.ts";

export const keys = {
  channel: ["channel"], daily: ["daily"], formats: ["formats"], videos: ["videos"], myFormats: ["my-formats"],
  reports: ["reports"], runs: ["sync-runs"], connection: ["connection"], ideas: ["ideas"], quota: ["quota"],
  watched: ["watched"], saved: ["saved-videos"], keywords: ["keywords"], owners: ["owners"],
  research: (kind: string) => ["research-runs", kind],
} as const;

export const useChannel = () => useQuery({ queryKey: keys.channel, queryFn: api.getChannel });
export const useDaily = () => useQuery({ queryKey: keys.daily, queryFn: api.getDaily });
export const useFormatDaily = () => useQuery({ queryKey: keys.formats, queryFn: api.getFormatDaily });
export const useVideos = () => useQuery({ queryKey: keys.videos, queryFn: api.getVideos });
export const useMyFormats = () => useQuery({ queryKey: keys.myFormats, queryFn: api.getMyFormats });
export const useReports = () => useQuery({ queryKey: keys.reports, queryFn: api.getReports });
export const useSyncRuns = (refetchInterval: number | false = false) =>
  useQuery({ queryKey: keys.runs, queryFn: () => api.getSyncRuns(), refetchInterval });
export const useConnection = () => useQuery({ queryKey: keys.connection, queryFn: api.getConnection });
export const useIdeas = () => useQuery({ queryKey: keys.ideas, queryFn: api.getIdeas });
export const useQuota = () => useQuery({ queryKey: keys.quota, queryFn: api.getQuotaUsed });
export const useWatched = () => useQuery({ queryKey: keys.watched, queryFn: api.getWatchedChannels });
export const useSavedVideos = () => useQuery({ queryKey: keys.saved, queryFn: api.getSavedVideos });
export const useKeywords = () => useQuery({ queryKey: keys.keywords, queryFn: api.getKeywords });
export const useOwners = () => useQuery({ queryKey: keys.owners, queryFn: api.getOwners });
export const useResearchRuns = <T>(kind: ResearchRun["kind"]) =>
  useQuery({ queryKey: keys.research(kind), queryFn: () => api.getResearchRuns<T>(kind) });
