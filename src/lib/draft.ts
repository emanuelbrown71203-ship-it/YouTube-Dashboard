// Hands a half-filled idea from one screen (research) to the ideas editor.

import type { IdeaDraft } from "./types.ts";

let pending: IdeaDraft | null = null;

export function setPendingIdea(draft: IdeaDraft): void {
  pending = draft;
}

export function takePendingIdea(): IdeaDraft | null {
  const draft = pending;
  pending = null;
  return draft;
}
