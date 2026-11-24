// The owner's own thumbnails for a video idea: one or more versions, each framed to a thumbnail in the
// browser and scored two ways, "Your history" (their thumbnail rules and how their past thumbnails did)
// and "Recommended" (next to the thumbnails that broke out on this idea and game). The AI looks at the
// pictures; it never sees video.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
import { Icon, useToast } from "../components/ui.tsx";
import { addIdeaThumb, getIdeaThumbs, type IdeaThumb, patchIdeaThumb, scoreThumb } from "../lib/api.ts";
import { useConnection } from "../lib/hooks.ts";
import { pictureFiles } from "../lib/pictures.ts";
import type { IdeaDraft } from "../lib/types.ts";
import { PieceAdvice, PieceFigures, PieceParts, PieceTries } from "./PieceScore.tsx";
import { PictureCrop, RefPicture } from "./RefPictures.tsx";

const thumbsKey = (ideaId: string) => ["idea-thumbs", ideaId];
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function MyThumbnails({ idea }: { idea: IdeaDraft }) {
  const connection = useConnection();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ai = Boolean(connection.data?.ai);
  const thumbs = useQuery({ queryKey: thumbsKey(idea.id ?? ""), queryFn: () => getIdeaThumbs(idea.id!), enabled: Boolean(idea.id) });
  const [framing, setFraming] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey: thumbsKey(idea.id ?? "") });
  const list = thumbs.data ?? [];

  if (!idea.id) return <small className="muted">Save the idea, then add your thumbnail here to score it.</small>;

  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const [file] = pictureFiles(e.target.files);
    e.target.value = "";
    if (file) setFraming(file);
  };
  const score = async (t: IdeaThumb) => {
    setBusy(t.id);
    try {
      await scoreThumb({ idea_id: idea.id, thumb_id: t.id, title: idea.title, game: idea.topic ?? null, format: idea.format ?? "long" });
      reload();
    } catch (err) {
      toast(message(err, "The thumbnail could not be scored. Try again."), { error: true });
    }
    setBusy(null);
  };
  const bin = async (t: IdeaThumb) => {
    try {
      await patchIdeaThumb(t.id, { trashed_at: new Date().toISOString() });
      toast("Moved to the bin.");
      reload();
    } catch (err) {
      toast(message(err, "Could not move it to the bin. Try again."), { error: true });
    }
  };

  return (
    <div className="field">
      <span>My thumbnail</span>
      <small className="muted">Add the thumbnail you made (a screenshot or the exported picture). Add another version to compare them.</small>
      {list.length ? (
        <div className="piece-thumbs">
          {list.map((t, i) => (
            <div key={t.id} className="piece-thumb">
              <RefPicture id={t.id} table="thumbs" size="large" />
              <div className="row between" style={{ gap: 8 }}>
                <strong className="small">{t.name || `Version ${i + 1}`}</strong>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => void bin(t)}>Move to bin</button>
              </div>
              {t.score ? (
                <>
                  <PieceFigures reading={t.score} />
                  <PieceAdvice reading={t.score} />
                  <PieceParts reading={t.score} />
                  <PieceTries label="Changes to try" items={t.score.to_try} />
                </>
              ) : null}
              <div className="row-wrap" style={{ gap: 10 }}>
                <button type="button" className="btn btn-small" disabled={!ai || busy !== null} onClick={() => void score(t)}>
                  {busy === t.id ? "Scoring" : t.score ? "Score it again" : "Score this thumbnail"}
                </button>
                <small className="muted grow" style={{ minWidth: 0 }}>
                  {!ai ? "Add your Claude API key in Settings to switch this on."
                    : "The AI looks at the picture next to your past thumbnails and the ones that broke out on this idea. Estimates, not promises."}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {framing ? (
        <PictureCrop
          key={`${framing.name}-${framing.size}-${framing.lastModified}`}
          file={framing}
          skipLabel="Cancel"
          onSkip={() => setFraming(null)}
          onUse={async (picture) => {
            try {
              await addIdeaThumb(idea.id!, picture, null);
              setFraming(null);
              reload();
            } catch (err) {
              toast(message(err, "The picture could not be kept. Try again."), { error: true });
            }
          }}
        />
      ) : (
        <div>
          <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()}>
            <Icon name="image" />{list.length ? "Add another version" : "Add my thumbnail"}
          </button>
        </div>
      )}
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={picked} aria-label="Choose your thumbnail" />
    </div>
  );
}
