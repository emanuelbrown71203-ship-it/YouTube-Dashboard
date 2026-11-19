// Pull to refresh: at the top of any page, pull down and let go to reload the app (fresh numbers,
// and the newest version of the dashboard). Works the same in Safari, from the home screen and in
// an in-app browser: the browser's own pull is switched off in app.css (overscroll-behavior), so
// there is only ever this one.

import { useEffect, useRef, useState } from "react";

/** How far the circle has to come down before letting go refreshes. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;

/** Pulls that start here are not refreshes: an open editor, a menu, a box being typed in, a picture being framed. */
const NOT_A_PULL = ".drawer, .backdrop, .more-sheet, input, textarea, select, [contenteditable=\"true\"], .picture-crop-box, [data-no-pull]";

/** How far the circle shows for a finger that has moved `dy` pixels down: it lags behind, then stops. */
export const pullDistance = (dy: number) => Math.max(0, Math.min(PULL_MAX, dy * 0.5));

const reload = () => window.location.reload();

export function PullToRefresh({ onRefresh = reload }: { onRefresh?: () => void }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Held in a ref so a new function on each render never resets a pull that is under way.
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let shown = 0;
    const show = (d: number) => { shown = d; setPull(d); };
    const begin = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1 || window.scrollY > 0) return;
      // An open editor locks the page behind it.
      if (document.body.style.overflow === "hidden") return;
      if (e.target instanceof Element && e.target.closest(NOT_A_PULL)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = e.touches[0].clientX - start.x;
      // A sideways swipe or a scroll down the page is not a pull.
      if (dy < -8 || (Math.abs(dx) > 24 && Math.abs(dx) > dy) || window.scrollY > 0) {
        start = null;
        if (shown) show(0);
        return;
      }
      show(pullDistance(dy));
    };
    const end = () => {
      if (!start) return;
      start = null;
      if (shown >= PULL_THRESHOLD) {
        setRefreshing(true);
        show(PULL_THRESHOLD);
        refresh.current();
      } else if (shown) show(0);
    };
    window.addEventListener("touchstart", begin, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", begin);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (!pull && !refreshing) return null;
  const ready = pull >= PULL_THRESHOLD;
  return (
    <div className={`pull${ready ? " ready" : ""}`} style={{ transform: `translate(-50%, ${pull - 44}px)` }} role="status">
      <span className={`pull-circle${refreshing ? " spinning" : ""}`} style={refreshing ? undefined : { transform: `rotate(${pull * 3.5}deg)` }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="pull-label">{refreshing ? "Refreshing" : ready ? "Let go to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
