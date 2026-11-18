// Scores for a video idea. Two questions, kept apart:
//
//   history      has this kind of video worked on this channel before?
//   recommended  is YouTube likely to put it in front of people who were not looking for it?
//
// Everything is worked out within one format. A Short's views never count for or against a
// long-form idea; the one bridge is a hint, when a Short on the same game beat the other Shorts.

import type { Idea, Video } from "./types.ts";

export interface FoundVideo {
  id: string;
  title: string | null;
  tags: string[] | null;
  format: string | null;
  views: number | null;
  outlier_score: number | null;
  channel_subscribers: number | null;
  published_at: string | null;
}

/** A breakout search that was run on a game: by the owner, or by the dashboard to keep the scores fed. */
export interface Covered { game: string; format: "long" | "short"; at: string }
/** How long a search stays good for before the dashboard runs it again. */
export const COVER_DAYS = 14;

/** One group of videos a check on an idea found: the same idea, or the same kind of video. */
export interface MarketGroup {
  n: number;
  /** How many could be set against their channel's usual video. */
  scored: number;
  /** How many did 3x their channel's usual or better. */
  broke_out: number;
  /** The middle one against its channel's usual. A tiny channel's freak result counts as 20x at most. */
  median: number | null;
  newest: string | null;
}
export interface MarketVideo {
  video_id: string;
  title: string;
  channel: string;
  subscribers: number | null;
  views: number;
  score: number | null;
  published: string;
  match: "same" | "close" | "no";
}
/** What a YouTube search for one idea found. Made by the dashboard itself, one search per idea. */
export interface Market {
  searched: number;
  same: MarketGroup;
  close: MarketGroup;
  examples: MarketVideo[];
  /** Who sorted the results into same, close and neither: the AI, or the idea's own words when the AI is off. */
  judged_by?: "ai" | "words";
  at: string;
}

export interface Part {
  label: string;
  /** Points earned and the most this part can give. `null` points = not enough to go on. */
  points: number | null;
  max: number;
  why: string;
  /** Videos behind the reading, to open and look at. */
  examples?: { href: string; title: string; note: string }[];
}

export interface Score {
  /** 0 to 100, or null when there is too little to go on. */
  value: number | null;
  parts: Part[];
}

export interface IdeaScores {
  game: string | null;
  history: Score;
  recommended: Score;
  /** The game whose breakouts have not been searched lately; the dashboard runs that search by itself. */
  search: string | null;
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const times = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}x`;
const KIND = { long: "long-form video", short: "Short" } as const;
const KINDS = { long: "long-form videos", short: "Shorts" } as const;

/** "Baldur's Gate 3" is also written "BG3"; "Five Nights at Freddy's" is "FNAF". */
function initials(name: string): string | null {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const short = words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("").toLowerCase();
  return short.length >= 3 ? short : null;
}

/** Which of the known games an idea is about, going by its title, phrase and notes. Longest name wins. */
export function ideaGame(idea: Pick<Idea, "title" | "target_keyword" | "concept" | "hook">, games: string[]): string | null {
  const text = [idea.title, idea.target_keyword, idea.hook, idea.concept].filter(Boolean).join(" ");
  const flat = squash(text);
  const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let best: string | null = null;
  for (const game of games) {
    const key = squash(game);
    if (key.length < 3) continue;
    const short = initials(game);
    if (flat.includes(key) || (short && words.has(short))) {
      if (!best || key.length > squash(best).length) best = game;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// What the channel's own titles say works
// ---------------------------------------------------------------------------

const TRAITS: { key: string; says: string; test: (title: string) => boolean }[] = [
  { key: "question", says: "ask a question", test: (t) => /\?/.test(t) || /^(can|could|is|are|what|why|how|will|does|did)\b/i.test(t) },
  { key: "rule", says: "set a rule or restriction", test: (t) => /\b(only|without|no hit|no damage|but|restriction|challenge|every|never|0 hours?|zero)\b/i.test(t) },
  { key: "number", says: "have a number in them", test: (t) => /\d/.test(t.replace(/#\S+/g, "")) },
  { key: "firstperson", says: "are told in the first person", test: (t) => /\b(i|my|me|we|our)\b/i.test(t) },
  { key: "shouting", says: "are written in capitals", test: (t) => (t.replace(/#\S+/g, "").match(/\b[A-Z]{3,}\b/g) ?? []).length >= 3 },
  { key: "part", says: "are a numbered part of a series", test: (t) => /\b(pt\.?|part|act|episode|ep\.?)\s*\d/i.test(t) },
  { key: "brackets", says: "name the game in brackets", test: (t) => /\(.+\)/.test(t) },
  { key: "short", says: "are 50 characters or fewer", test: (t) => t.replace(/\s*#\S+/g, "").trim().length <= 50 },
];

export interface TraitLift {
  key: string;
  says: string;
  /** How videos with the trait did against the format's usual video: 1 = the same. */
  lift: number;
  videos: number;
}

/** For each kind of title, how the owner's videos of one format that used it did against the rest. */
export function titleLifts(videos: Video[], format: "long" | "short"): TraitLift[] {
  const pool = videos.filter((v) => v.content_type === format && v.privacy === "public" && v.vs_typical !== null && (v.age_days ?? 0) > 7);
  const out: TraitLift[] = [];
  for (const trait of TRAITS) {
    const withIt = pool.filter((v) => trait.test(v.title)).map((v) => v.vs_typical!);
    const without = pool.filter((v) => !trait.test(v.title)).map((v) => v.vs_typical!);
    // A handful of videos on either side is not a pattern.
    if (withIt.length < 4 || without.length < 4) continue;
    const a = median(withIt)!, b = median(without)!;
    if (b <= 0) continue;
    out.push({ key: trait.key, says: trait.says, lift: a / b, videos: withIt.length });
  }
  return out;
}

function titlePart(title: string, lifts: TraitLift[], format: "long" | "short", max: number): Part {
  const label = "Title";
  if (lifts.length === 0) {
    return { label, points: null, max, why: `Not enough ${KINDS[format]} yet to see which kinds of title work for you.` };
  }
  const has = lifts.filter((l) => TRAITS.find((t) => t.key === l.key)!.test(title));
  const missing = lifts.filter((l) => !has.includes(l) && l.lift >= 1.25).sort((a, b) => b.lift - a.lift);
  // Each trait moves the score by how much it has moved the owner's own videos.
  let points = max / 2;
  for (const l of has) points += clamp(Math.log2(l.lift) * (max / 4), -max / 4, max / 4);
  points = clamp(Math.round(points), 0, max);
  const good = has.filter((l) => l.lift >= 1.15).sort((a, b) => b.lift - a.lift)[0];
  const bad = has.filter((l) => l.lift <= 0.85).sort((a, b) => a.lift - b.lift)[0];
  const why = good
    ? `Your ${KINDS[format]} whose titles ${good.says} did ${times(good.lift)} the others.`
    : bad
      ? `Your ${KINDS[format]} whose titles ${bad.says} did ${times(bad.lift)} the others.`
      : missing[0]
        ? `Your ${KINDS[format]} whose titles ${missing[0].says} did ${times(missing[0].lift)} the others. This title does not.`
        : "This title is neither one of your strong kinds nor one of your weak ones.";
  return { label, points, max, why };
}

// ---------------------------------------------------------------------------
// The scores
// ---------------------------------------------------------------------------

function total(parts: Part[]): number | null {
  const known = parts.filter((p) => p.points !== null);
  const max = known.reduce((sum, p) => sum + p.max, 0);
  // With under half the evidence in, a number would be a guess dressed up.
  if (max < 50) return null;
  return Math.round((100 * known.reduce((sum, p) => sum + (p.points ?? 0), 0)) / max);
}

/** Maps "times the usual" onto points: 1x is half marks, 4x or more is full marks. */
const fromTimes = (x: number, max: number) => Math.round(clamp(0.5 + Math.log2(Math.max(x, 0.1)) / 4, 0, 1) * max);

const compactViews = (n: number) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const monthOf = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Has this exact video been made, and how did it do for the channels that made it? The one part of
 * the score that is about this idea and no other. Each video is measured against its own channel's
 * usual, so a big channel's big number does not count for more than a small channel's.
 */
function marketPart(market: Market | null | undefined, game: string | null, filed: boolean, format: "long" | "short"): Part {
  const label = "This exact video on YouTube", max = 40, even = max / 2;
  // The search is run for ideas filed under a game; one that only reads like a game has to be filed first.
  if (!game || !filed) return { label, points: null, max, why: `File the idea under ${game ?? "a game"} and the dashboard searches YouTube for this exact video.` };
  if (market === undefined) return { label, points: null, max, why: "Save the idea and the dashboard searches YouTube for this exact video. It takes a minute or two." };
  if (market === null) return { label, points: null, max, why: "The dashboard is searching YouTube for this exact video. This fills in by itself in a few minutes." };
  const examples = market.examples.slice(0, 3).map((v) => ({
    href: `https://www.youtube.com/watch?v=${v.video_id}`, title: v.title,
    note: `${v.channel}, ${compactViews(v.views)} views${v.score === null ? "" : `, ${times(v.score)} its channel's usual`}${v.match === "close" ? " (same kind of video)" : ""}`,
  }));
  const { same, close } = market;
  if (same.n > 0 && same.median !== null) {
    // One video proves little; three or more is a pattern.
    const points = Math.round(even + (fromTimes(same.median, max) - even) * Math.min(1, same.scored / 3));
    return {
      label, points, max, examples,
      why: `${same.n === 1 ? "One video" : `${same.n} videos`} of this exact idea turned up. ${
        same.broke_out ? `${same.broke_out === same.scored && same.scored > 1 ? "All of them" : same.broke_out} did 3x ${same.broke_out === 1 ? "its" : "their"} channel's usual or better` : `None stood out from ${same.n === 1 ? "its" : "their"} channel's usual`
      }${same.scored > 1 ? `; the middle one did ${times(same.median)}` : `, at ${times(same.median)}`}.${same.newest ? ` The newest is from ${monthOf(same.newest)}.` : ""}`,
    };
  }
  if (same.n > 0) {
    return { label, points: null, max, examples, why: `${same.n === 1 ? "One video" : `${same.n} videos`} of this exact idea turned up, but how ${same.n === 1 ? "it" : "they"} did against ${same.n === 1 ? "its channel's" : "their channels'"} usual could not be worked out.` };
  }
  if (close.scored >= 2 && close.median !== null) {
    // The same kind of video doing well is a weaker sign than this very idea doing well.
    const points = Math.round(even + (fromTimes(close.median, max) - even) * 0.6 * Math.min(1, close.scored / 4));
    return {
      label, points, max, examples,
      why: `Nobody in YouTube's top results has made this exact ${KIND[format]}, so the idea is open. ${close.n} of the same kind on ${game} turned up: ${
        close.broke_out ? `${close.broke_out} did 3x their channel's usual or better` : "none stood out from their channel's usual"
      }, and the middle one did ${times(close.median)}.`,
    };
  }
  return {
    label, points: even, max, examples,
    why: `Nothing like this idea turned up in YouTube's top results for it. It is untested: that can be an opening, but there is no proof yet that people want it.`,
  };
}

export function scoreIdea(
  idea: Pick<Idea, "title" | "format" | "target_keyword" | "concept" | "hook"> & { topic?: string | null },
  videos: Video[],
  found: FoundVideo[],
  today: string,
  covered: Covered[] = [],
  /** The check on this idea: `null` = not run yet; left out = cannot be run (a draft that is not saved). */
  market?: Market | null,
): IdeaScores {
  const format = idea.format === "short" ? "short" : "long";
  const other = format === "long" ? "short" : "long";
  const mine = videos.filter((v) => v.privacy === "public");
  const games = [...new Set(mine.map((v) => v.topic).filter((t): t is string => Boolean(t)))];
  // The game the owner filed the idea under wins; otherwise it is read from the wording.
  const game = idea.topic?.trim() || ideaGame(idea, games);
  const lifts = titleLifts(mine, format);
  const sameGame = game ? mine.filter((v) => v.topic === game) : [];
  const here = sameGame.filter((v) => v.content_type === format && v.vs_typical !== null);

  // --- Your history ---------------------------------------------------------
  const history: Part[] = [];
  if (!game) {
    history.push({ label: "The game", points: null, max: 45, why: "No game you have covered is named in this idea. Put the game's name in the title to score it against your past videos." });
  } else if (here.length === 0) {
    history.push({ label: "The game", points: null, max: 45, why: `You have not made a ${KIND[format]} on ${game} yet, so there is nothing of the same kind to go on.` });
  } else {
    const usual = median(here.map((v) => v.vs_typical!))!;
    history.push({
      label: "The game", points: fromTimes(usual, 45), max: 45,
      why: `Your ${here.length === 1 ? `one ${KIND[format]}` : `${here.length} ${KINDS[format]}`} on ${game} typically did ${times(usual)} your usual ${KIND[format]}.`,
    });
  }
  history.push(titlePart(idea.title, lifts, format, 30));
  if (game) {
    const hint = sameGame.filter((v) => v.content_type === other && (v.vs_typical ?? 0) >= 2).sort((a, b) => (b.vs_typical ?? 0) - (a.vs_typical ?? 0))[0];
    history.push(hint
      ? { label: "A hint from the other side", points: 15, max: 15, why: `A ${KIND[other]} of yours on ${game} did ${times(hint.vs_typical!)} your usual ${KIND[other]}. Not the same thing, but a sign the idea has pull.` }
      : { label: "A hint from the other side", points: 5, max: 15, why: `None of your ${KINDS[other]} on ${game} has stood out from your other ${KINDS[other]}.` });
    const last = [...here].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
    if (last) {
      const days = Math.round((Date.parse(today) - Date.parse(last.published_at ?? today)) / 86_400_000);
      const x = last.vs_typical ?? 1;
      history.push({
        label: "Momentum", points: x >= 1.5 ? 10 : x >= 0.8 ? 6 : 2, max: 10,
        why: `Your last ${KIND[format]} on it, ${days <= 1 ? "just now" : `${days} days ago`}, did ${times(x)} your usual.`,
      });
    }
  }

  // --- Recommended ----------------------------------------------------------
  const recommended: Part[] = [];
  const key = game ? squash(game) : null;
  const short = game ? initials(game) : null;
  const about = (v: FoundVideo) => {
    if (!key) return false;
    const text = `${v.title ?? ""} ${(v.tags ?? []).join(" ")}`;
    return squash(text).includes(key) || Boolean(short && text.toLowerCase().split(/[^a-z0-9]+/).includes(short));
  };
  const since = Date.parse(today) - 120 * 86_400_000;
  const outside = found.filter((v) => (v.format ?? "long") === format && about(v) && v.published_at && Date.parse(v.published_at) >= since);
  const breakouts = outside.filter((v) => (v.outlier_score ?? 0) >= 3);
  // The newest search on this game in this format, if there is one.
  const searches = covered.filter((c) => c.format === format && key && squash(c.game) === key).map((c) => c.at).sort();
  const searchedAt = searches[searches.length - 1] ?? null;
  const searchedDaysAgo = searchedAt ? Math.floor((Date.parse(today) - Date.parse(searchedAt.slice(0, 10))) / 86_400_000) : null;
  const fresh = searchedDaysAgo !== null && searchedDaysAgo <= COVER_DAYS;
  recommended.push(marketPart(market, game, Boolean(idea.topic?.trim()), format));

  // The game as a whole, as a small part: it is the same for every idea on the game, so it cannot
  // tell two ideas apart. What counts is small channels getting through, since this is one.
  const small = breakouts.filter((v) => (v.channel_subscribers ?? Infinity) <= 50_000).length;
  if (!game) {
    recommended.push({ label: "The game right now", points: null, max: 10, why: "File the idea under a game and this can say whether the game is travelling on YouTube." });
  } else if (outside.length === 0 && searchedDaysAgo !== null && searchedDaysAgo <= 45) {
    recommended.push({
      label: "The game right now", points: 1, max: 10,
      why: `A search ${searchedDaysAgo <= 1 ? "just now" : `${searchedDaysAgo} days ago`} found no recent ${KINDS[format]} on ${game} with enough views to count.`,
    });
  } else if (outside.length === 0) {
    recommended.push({ label: "The game right now", points: null, max: 10, why: `Recent ${KINDS[format]} on ${game} have not been looked at yet. The dashboard does that by itself; this fills in shortly.` });
  } else {
    recommended.push({
      label: "The game right now", points: clamp(Math.round(small / 2), breakouts.length ? 2 : 0, 10), max: 10,
      why: small
        ? `Among the most-viewed recent ${KINDS[format]} on ${game}, ${small} came from ${small === 1 ? "a channel" : "channels"} under 50,000 subscribers and did 3x that channel's usual or better. Small channels are getting through.`
        : breakouts.length
          ? `Among the most-viewed recent ${KINDS[format]} on ${game}, ${breakouts.length} broke out, all from larger channels.`
          : `None of the ${outside.length} most-viewed recent ${KINDS[format]} on ${game} broke out from its channel's usual.`,
    });
  }
  const fed = here.filter((v) => v.recommended_pct !== null);
  if (fed.length) {
    const share = median(fed.map((v) => v.recommended_pct!))!;
    const usual = median(here.map((v) => v.vs_typical!))!;
    // A big share only counts if the videos also travelled.
    recommended.push({
      label: "Your reach on this game", points: clamp(Math.round((share / 100) * 12 + fromTimes(usual, 13)), 0, 25), max: 25,
      why: `${Math.round(share)}% of the views on your ${KINDS[format]} about ${game} came from YouTube recommending them, and they typically did ${times(usual)} your usual.`,
    });
  } else if (game) {
    recommended.push({ label: "Your reach on this game", points: null, max: 25, why: `YouTube has not had a ${KIND[format]} of yours on ${game} to recommend yet.` });
  }
  const title = titlePart(idea.title, lifts, format, 25);
  const bare = idea.title.replace(/\s*#\S+/g, "").trim();
  if (title.points !== null && bare.length > 70) {
    title.points = Math.max(0, title.points - 6);
    title.why += " It runs past 70 characters, so the end will be cut off on the home page.";
  }
  recommended.push({ ...title, label: "A title that earns the click" });

  return {
    game,
    history: { value: total(history), parts: history },
    recommended: { value: total(recommended), parts: recommended },
    search: game && !fresh ? game : null,
  };
}

/** A word for a score, so the number is not read as more exact than it is. */
export function scoreWord(value: number | null): string {
  if (value === null) return "Not enough to go on";
  return value >= 75 ? "Strong" : value >= 55 ? "Promising" : value >= 40 ? "Even odds" : "Weak";
}
