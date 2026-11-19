// Pictures the owner adds as thumbnail references: usually a phone screenshot with a thumbnail in it.
// The part they frame is cut out in the browser and kept as two small JPEGs, so nothing large is sent.

/** A part of a picture, in the picture's own pixels. */
export interface Crop { x: number; y: number; w: number; h: number }

/** A thumbnail's shape. */
export const WIDE = 16 / 9;

/** The widest 16:9 frame that fits in a picture of this size. */
export function widestFrame(width: number, height: number): { w: number; h: number } {
  const w = Math.min(width, height * WIDE);
  return { w, h: w / WIDE };
}

/** A 16:9 frame, as wide as the picture allows, in the middle of it. */
export function defaultCrop(width: number, height: number): Crop {
  const { w, h } = widestFrame(width, height);
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Keeps a frame inside the picture. */
export function clampCrop(c: Crop, width: number, height: number): Crop {
  const w = Math.min(c.w, width);
  const h = Math.min(c.h, height);
  return { w, h, x: Math.max(0, Math.min(c.x, width - w)), y: Math.max(0, Math.min(c.y, height - h)) };
}

/** The frame moved so its middle sits on a point, still inside the picture. */
export function centreOn(c: Crop, px: number, py: number, width: number, height: number): Crop {
  return clampCrop({ ...c, x: px - c.w / 2, y: py - c.h / 2 }, width, height);
}

/** The frame at a share of its widest (0.2 to 1), keeping its middle where it was. */
export function resizeCrop(c: Crop, share: number, width: number, height: number): Crop {
  const widest = widestFrame(width, height);
  const s = Math.max(0.2, Math.min(1, share));
  const w = widest.w * s;
  const h = widest.h * s;
  return clampCrop({ w, h, x: c.x + c.w / 2 - w / 2, y: c.y + c.h / 2 - h / 2 }, width, height);
}

/** The size a part comes out at: no side longer than `longest`, never larger than it was. */
export function fitWithin(w: number, h: number, longest: number): { w: number; h: number } {
  const scale = Math.min(1, longest / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Opens a picture file. Says what went wrong in words the owner can act on. */
export function loadPicture(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That picture could not be opened. Try a screenshot, or save it as a JPEG or PNG first."));
    };
    img.src = url;
  });
}

function jpeg(img: HTMLImageElement, c: Crop, longest: number, quality: number): string {
  const out = fitWithin(c.w, c.h, longest);
  const canvas = document.createElement("canvas");
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the picture. Try again in another browser.");
  // A see-through PNG would turn black as a JPEG: lay it on white.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.w, out.h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, out.w, out.h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Limits the database holds a picture to (see migration 017). */
export const MAX_IMAGE = 880_000;
export const MAX_SMALL = 110_000;

/** The framed part as the two JPEGs a reference keeps: up to 1280 pixels, and up to 320 for cards. */
export function encodePicture(img: HTMLImageElement, c: Crop): { image: string; image_small: string } {
  let image = "";
  for (const [longest, quality] of [[1280, 0.85], [1280, 0.72], [960, 0.7], [720, 0.65]] as const) {
    image = jpeg(img, c, longest, quality);
    if (image.length <= MAX_IMAGE) break;
  }
  let image_small = "";
  for (const quality of [0.78, 0.6, 0.45]) {
    image_small = jpeg(img, c, 320, quality);
    if (image_small.length <= MAX_SMALL) break;
  }
  if (image.length > MAX_IMAGE || image_small.length > MAX_SMALL) throw new Error("That picture is too detailed to keep. Try framing a smaller part of it.");
  return { image, image_small };
}

/** The pictures among some files: chosen, pasted or dropped. */
export function pictureFiles(files: FileList | File[] | null | undefined): File[] {
  return [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(heic|heif|png|jpe?g|webp)$/i.test(f.name));
}
