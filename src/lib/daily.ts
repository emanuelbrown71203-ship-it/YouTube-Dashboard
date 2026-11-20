// The front page shows one saved line and one kind comment at a time, a different one each day,
// so it stays short without hiding any of them for good.

/** One item a day from a list, each in turn. */
export function ofTheDay<T>(list: T[], now = Date.now()): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.floor(now / 86_400_000) % list.length];
}
