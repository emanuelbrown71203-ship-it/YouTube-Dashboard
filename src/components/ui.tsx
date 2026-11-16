// Small shared pieces: icons, buttons that pick one of a few options, the
// "times the usual" pill, thumbnails, the side drawer and toasts.

import { Component, createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { duration, FORMAT_LABEL, multiple, percentChange } from "../lib/format.ts";

const PATHS: Record<string, string> = {
  overview: "M4 19V10m5.5 9V5M15 19v-6m5.5 6V8",
  videos: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM10 9.5v5l4.5-2.5z",
  ideas: "M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2v.1h5V16c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
  research: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zm5-1.5L20 20",
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5",
  external: "M14 5h5v5m0-5-8 8M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  bookmark: "M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z",
  refresh: "M19 12a7 7 0 1 1-2.1-5M19 4v4h-4",
};

export function Icon({ name, filled = false }: { name: keyof typeof PATHS | string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A percentage change with an arrow, so direction never depends on colour. */
export function Delta({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return null;
  const flat = Math.abs(value) < 0.5;
  return (
    <span className={`delta ${flat ? "flat" : value > 0 ? "up" : "down"}`}>
      <span aria-hidden="true">{flat ? "●" : value > 0 ? "▲" : "▼"}</span>
      {percentChange(value)}
      {suffix ? <span className="muted" style={{ fontWeight: 500 }}> {suffix}</span> : null}
    </span>
  );
}

export function multStep(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return value >= 25 ? 5 : value >= 10 ? 4 : value >= 5 ? 3 : value >= 2 ? 2 : value >= 1 ? 1 : 0;
}

/** "14x": how many times the usual views. Darker is bigger. */
export function Mult({ value, title }: { value: number | null | undefined; title?: string }) {
  return (
    <span className="mult" data-step={multStep(value)} title={title ?? (value == null ? "Not enough uploads to know what is usual" : `${multiple(value)} the usual views`)}>
      {multiple(value)}
    </span>
  );
}

export function FormatTag({ format }: { format: string | null | undefined }) {
  if (!format) return null;
  return (
    <span className="tag">
      <span className="dot" style={{ background: `var(--s-${format})` }} />
      {FORMAT_LABEL[format] ?? format}
    </span>
  );
}

/**
 * YouTube's standard thumbnail for a Short is a wide crop from the middle of an
 * upright video, which looks zoomed in. Shorts have an upright one as well.
 */
function uprightThumb(src: string): string | null {
  const id = /\/vi\/([\w-]{11})\//.exec(src)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/oardefault.jpg` : null;
}

// Which thumbnails are on or near the screen, worked out from where they sit on the page each time
// it scrolls. Plain position sums on purpose: they behave the same in every browser.
const watched = new Set<{ el: HTMLElement; set: (near: boolean) => void }>();
let looking = false;
function look() {
  looking = false;
  const reach = 700;
  for (const { el, set } of watched) {
    const box = el.getBoundingClientRect();
    // A frame with no size is not laid out yet (or is hidden); leave it for the next look.
    set(box.width > 0 && box.bottom > -reach && box.top < window.innerHeight + reach);
  }
}
function lookSoon() {
  if (looking) return;
  looking = true;
  requestAnimationFrame(look);
}
if (typeof window !== "undefined") {
  // Capture, so scrolling inside a panel or a table counts as well.
  window.addEventListener("scroll", lookSoon, { passive: true, capture: true });
  window.addEventListener("resize", lookSoon, { passive: true });
  // Rows that appear without a scroll (a filter, more rows loading) are caught by a slow tick.
  window.setInterval(() => { if (watched.size) lookSoon(); }, 1000);
}

/** The shape each picture turned out to have, so a list does not jump when it is drawn again. */
const shapes = new Map<string, number>();

/**
 * A video's thumbnail, never cropped: the frame takes the shape of the picture once it has loaded.
 * A Short's upright picture is not always upright (a wide or square clip posted as a Short keeps
 * its own shape), so the shape is read from the picture and not assumed from the format.
 */
export function Thumb(props: { src: string | null | undefined; seconds?: number | null; tall?: boolean; small?: boolean; short?: boolean }) {
  const [failed, setFailed] = useState(0);
  const [, redraw] = useState(0);
  // Only pictures on or near the screen are kept loaded. An upright picture comes from YouTube at
  // full size, and a long list of those is more than a phone will hold: they turn black.
  const frame = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const entry = { el, set: setNear };
    watched.add(entry);
    lookSoon();
    return () => void watched.delete(entry);
  }, []);
  const upright = props.short && props.src ? uprightThumb(props.src) : null;
  const sources = [upright, props.src].filter((s): s is string => Boolean(s));
  const src = sources[Math.min(failed, sources.length - 1)];
  const isUpright = Boolean(upright) && src === upright;
  const ratio = src ? shapes.get(src) : undefined;
  // Until the picture has loaded, guess: upright for a Short, wide for everything else.
  const shape = ratio === undefined ? (props.tall || isUpright ? "tall" : "wide") : ratio < 0.8 ? "tall" : ratio < 1.25 ? "square" : "wide";
  return (
    <span
      ref={frame}
      className={`thumb${shape === "wide" ? "" : ` ${shape}`}${props.small ? " small" : ""}`}
      style={ratio === undefined ? undefined : { aspectRatio: String(Math.min(2, Math.max(0.5, ratio))) }}
    >
      {src && near ? (
        <img
          key={src} src={src} alt="" decoding="async"
          onError={() => setFailed((n) => n + 1)}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            // YouTube answers a missing picture with a small grey placeholder; treat that as missing.
            if (isUpright && w <= 120 && h <= 90) return setFailed((n) => n + 1);
            if (w > 0 && h > 0 && shapes.get(src) !== w / h) {
              shapes.set(src, w / h);
              redraw((n) => n + 1);
            }
          }}
        />
      ) : null}
      {props.seconds ? <span className="len">{duration(props.seconds)}</span> : null}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spin" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="notice error" role="alert">
      <span className="grow">{message}</span>
      {retry ? <button type="button" className="btn btn-small" onClick={retry}>Try again</button> : null}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <i style={{ width: `${Math.min(100, (100 * value) / max)}%` }} />
    </div>
  );
}

export function CopyLine({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy">
      <code>{value}</code>
      <button
        type="button"
        className="btn btn-small"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

export function Drawer(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2 className="clip">{props.title}</h2>
          <button type="button" className="btn btn-quiet btn-small" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">{props.children}</div>
        {props.footer ? <div className="drawer-foot">{props.footer}</div> : null}
      </div>
    </>
  );
}

interface Toast {
  id: number;
  message: string;
  error?: boolean;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(message: string, options?: Omit<Toast, "id" | "message">) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, options: Omit<Toast, "id" | "message"> = {}) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, message, ...options }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), options.action ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? " error" : ""}`}>
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export type Theme = "system" | "light" | "dark";

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("yt-theme") as Theme) ?? "system");
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("yt-theme", theme);
  }, [theme]);
  return [theme, setTheme];
}

/** If a screen breaks, say so and offer a way back, in place of a blank page. */
export class Safety extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice error" role="alert" style={{ margin: 24, flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
        <strong>This screen hit a problem and could not be shown.</strong>
        <span className="small">{this.state.error.message || String(this.state.error)}</span>
        <button type="button" className="btn btn-small" onClick={() => { window.location.hash = "#/"; window.location.reload(); }}>Back to the front page</button>
      </div>
    );
  }
}
