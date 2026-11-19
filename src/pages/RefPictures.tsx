// Pictures the owner adds as thumbnail references: the framing step, and the picture on a card.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useNear } from "../components/ui.tsx";
import { getRefPicture } from "../lib/api.ts";
import { centreOn, clampCrop, type Crop, defaultCrop, encodePicture, loadPicture, resizeCrop, widestFrame } from "../lib/pictures.ts";

export const pictureKey = (id: string, size: "small" | "large") => ["ref-picture", id, size];

/**
 * A picture the owner added. A saved one is fetched by itself once it is near the screen (lists
 * leave the pictures out); one not saved yet comes in as `src`. The large view shows the small
 * picture until the sharp one arrives.
 */
export function RefPicture(props: { id?: string; src?: string; size?: "small" | "large"; className?: string }) {
  const size = props.size ?? "small";
  const [ref, near] = useNear<HTMLSpanElement>();
  const queryClient = useQueryClient();
  const picture = useQuery({
    queryKey: pictureKey(props.id ?? "", size),
    queryFn: () => getRefPicture(props.id!, size),
    enabled: Boolean(props.id) && !props.src && (near || size === "large"),
    staleTime: Infinity,
  });
  const fallback = size === "large" && props.id ? queryClient.getQueryData<string | null>(pictureKey(props.id, "small")) : null;
  const src = props.src ?? picture.data ?? fallback ?? null;
  return (
    <span ref={ref} className={`${size === "large" ? "ref-picture-large" : "wide-thumb ref-picture"}${props.className ? ` ${props.className}` : ""}`}>
      {src ? <img src={src} alt="" decoding="async" /> : null}
    </span>
  );
}

/**
 * Framing a picture before it is kept: a 16:9 box to drag over the thumbnail in a screenshot, a
 * slider for its size, or the whole picture as it is.
 */
export function PictureCrop(props: {
  file: File;
  /** "2 of 3" when several were chosen at once. */
  progress?: string;
  onUse: (picture: { image: string; image_small: string }) => Promise<void>;
  onSkip: () => void;
  skipLabel: string;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [share, setShare] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"part" | "whole" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; start: Crop } | null>(null);

  useEffect(() => {
    let live = true;
    setImg(null);
    setProblem(null);
    loadPicture(props.file).then(
      (loaded) => {
        if (!live) return;
        setImg(loaded);
        setCrop(defaultCrop(loaded.naturalWidth, loaded.naturalHeight));
        setShare(1);
      },
      (err: Error) => { if (live) setProblem(err.message); },
    );
    return () => { live = false; };
  }, [props.file]);
  // The picture is held as an object URL while it is being framed; let it go afterwards.
  useEffect(() => () => { if (img?.src.startsWith("blob:")) URL.revokeObjectURL(img.src); }, [img]);

  const W = img?.naturalWidth ?? 1;
  const H = img?.naturalHeight ?? 1;
  /** Where a pointer is, in the picture's own pixels. */
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, scale: W / r.width };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!crop || busy) return;
    e.preventDefault();
    const p = at(e);
    // A touch outside the box brings the box there first; then it follows the finger.
    const inside = p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
    const start = inside ? crop : centreOn(crop, p.x, p.y, W, H);
    setCrop(start);
    drag.current = { px: e.clientX, py: e.clientY, start };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { scale } = at(e);
    const d = drag.current;
    setCrop(clampCrop({ ...d.start, x: d.start.x + (e.clientX - d.px) * scale, y: d.start.y + (e.clientY - d.py) * scale }, W, H));
  };
  const up = () => { drag.current = null; };

  const use = async (whole: boolean) => {
    if (!img || !crop) return;
    setBusy(whole ? "whole" : "part");
    setProblem(null);
    try {
      await props.onUse(encodePicture(img, whole ? { x: 0, y: 0, w: W, h: H } : crop));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "That picture could not be kept. Try again.");
      setBusy(null);
    }
  };
  const widest = img ? widestFrame(W, H) : null;
  const alreadyWide = widest !== null && widest.w >= W - 1 && widest.h >= H - 1;

  return (
    <div className="picture-crop">
      <div className="row between" style={{ gap: 8 }}>
        <strong>Frame the thumbnail{props.progress ? ` (${props.progress})` : ""}</strong>
      </div>
      {problem ? <p className="small" style={{ margin: 0, color: "var(--bad)" }}>{problem}</p> : null}
      {!img && !problem ? <p className="small muted row" style={{ gap: 8, margin: 0 }}><span className="spin" />Opening the picture</p> : null}
      {img && crop ? (
        <>
          <small className="muted">{alreadyWide ? "This picture is already thumbnail-shaped. Make the box smaller to keep just part of it." : "Drag the box over the thumbnail in your screenshot."}</small>
          <div className="picture-crop-stage">
            <div
              ref={box} className="picture-crop-box" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              role="application" aria-label="Picture with a box to drag over the thumbnail"
            >
              <img src={img.src} alt="" draggable={false} />
              <div
                className="picture-crop-frame"
                style={{ left: `${(crop.x / W) * 100}%`, top: `${(crop.y / H) * 100}%`, width: `${(crop.w / W) * 100}%`, height: `${(crop.h / H) * 100}%` }}
              />
            </div>
          </div>
          <label className="row small" style={{ gap: 10 }}>
            <span style={{ flex: "none" }}>Box size</span>
            <input
              type="range" min={20} max={100} step={1} value={Math.round(share * 100)} className="grow"
              onChange={(e) => { const s = Number(e.target.value) / 100; setShare(s); setCrop((c) => (c ? resizeCrop(c, s, W, H) : c)); }}
            />
          </label>
        </>
      ) : null}
      <div className="row-wrap" style={{ gap: 8 }}>
        {img ? <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => void use(false)}>{busy === "part" ? "Adding" : "Add what is in the box"}</button> : null}
        {img && !alreadyWide ? <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void use(true)}>{busy === "whole" ? "Adding" : "Add the whole picture"}</button> : null}
        <button type="button" className="btn btn-quiet btn-small" disabled={busy !== null} onClick={props.onSkip}>{props.skipLabel}</button>
      </div>
    </div>
  );
}
