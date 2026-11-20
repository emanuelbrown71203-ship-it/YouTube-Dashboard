// A tiny hash router: #/videos, #/research/keywords, #/?google=connected

import { useSyncExternalStore } from "react";

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, search = ""] = raw.split("?");
  const clean = `/${path.split("/").filter(Boolean).join("/")}`;
  return { path: clean, segments: clean.split("/").filter(Boolean), query: new URLSearchParams(search) };
}

let current = parse(window.location.hash);
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse(window.location.hash);
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function navigate(path: string, replace = false): void {
  const target = `#${path}`;
  if (replace) window.history.replaceState(null, "", target);
  else window.location.hash = target;
  if (replace) {
    current = parse(target);
    listeners.forEach((l) => l());
  }
}
