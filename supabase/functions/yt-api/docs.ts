// Notes for the editor as a Google Doc. Each video idea gets one doc in the owner's Drive with every
// cut in order (Cut 1, then Cut 2); sending again rewrites the same doc, so the editor keeps one link per
// video. It needs Google's drive.file permission, which only reaches files the dashboard made itself.

import { type Deps, DOCS_SCOPE, getAccessToken, getConfig, HttpError } from "./google.ts";
import { sentences } from "./growth.ts";

interface Marker { at: string; end: string | null; name: string; note: string; type: string | null }
interface Sheet { name: string; markers: Marker[] }

const esc = (text: unknown) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A timecode the way a person says it: "1:05", or "1:02:05" past the hour. */
export function shortTime(tc: string): string {
  const parts = String(tc).trim().split(/[:;]/);
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return String(tc);
  const n = parts.map(Number);
  const s = n.length >= 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n.length === 2 ? n[0] * 60 + n[1] : n[0];
  const whole = Math.floor(s), h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), sec = whole % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** The doc itself: a heading per cut, then each marker numbered, its time in bold and its note line by line. */
export function editorDocHtml(title: string, sheets: Sheet[]): string {
  const count = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;
  const last = sheets[sheets.length - 1];
  const parts = [`<h1>Notes for the editor: ${esc(title)}</h1>`];
  if (sheets.length > 1) parts.push(`<p>${sheets.length} cuts, in order. The newest, ${esc(last.name)}, is at the bottom.</p>`);
  for (const sheet of sheets) {
    parts.push(`<h2>${esc(sheet.name)}</h2>`, `<p>${count(sheet.markers.length)}, in order</p>`, "<ol>");
    for (const m of sheet.markers) {
      const when = m.end ? `${shortTime(m.at)} to ${shortTime(m.end)}` : shortTime(m.at);
      const lines = [
        ...(m.type && !/^comment$/i.test(m.type) ? [esc(m.type)] : []),
        ...(m.name ? [`<b>${esc(m.name)}</b>`] : []),
        ...String(m.note ?? "").split(/\r?\n/).flatMap((l) => sentences(l.trim())).map(esc),
        ...(!m.name && !m.note ? ["(no note on this marker)"] : []),
      ];
      parts.push(`<li><b>${esc(when)}</b> (timecode ${esc(m.at)}${m.end ? ` to ${esc(m.end)}` : ""})${lines.map((l) => `<br>${l}`).join("")}</li>`);
    }
    parts.push("</ol>");
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${parts.join("")}</body></html>`;
}

const DRIVE_OFF = "Google Docs is not switched on for your Google Cloud project yet. In Google Cloud, open APIs and services, then Library, " +
  "search for Google Drive API and press Enable. Then try again.";
const NOT_ALLOWED = "The dashboard is not allowed to make Google Docs yet. In Settings, under Google permissions, press Turn on Google Docs, then try again.";

/** Makes the video's Google Doc, or rewrites the one it made before, and hands back its link. */
export async function pushEditorDoc(deps: Deps, body: Record<string, unknown>) {
  const { sql } = deps;
  const ideaId = String(body.idea_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ideaId)) throw new HttpError(400, "bad_request", "Open the video's idea and try again.");
  const { google_scopes: scopes } = await getConfig(sql, ["google_scopes"]);
  if (!String(scopes ?? "").split(" ").includes(DOCS_SCOPE)) throw new HttpError(409, "docs_not_allowed", NOT_ALLOWED);
  const [idea] = await sql`select title from public.yt_ideas where id = ${ideaId} and trashed_at is null`;
  if (!idea) throw new HttpError(404, "not_found", "That idea is in the bin or no longer exists.");
  const sheets = await sql`
    select name, markers from public.yt_editor_notes where idea_id = ${ideaId} and trashed_at is null order by created_at`;
  if (sheets.length === 0) throw new HttpError(400, "no_notes", "Bring in the markers from your cut first, then send them to Google Docs.");
  const title = String(idea.title);
  const html = editorDocHtml(title, sheets as Sheet[]);
  const name = `Notes for the editor: ${title}`.slice(0, 200);
  const token = await getAccessToken(deps);

  const send = async (method: "POST" | "PATCH", path: string, meta: Record<string, string>) => {
    const boundary = `yt${crypto.randomUUID().replace(/-/g, "")}`;
    const payload = [
      `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(meta),
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", html, `--${boundary}--`, "",
    ].join("\r\n");
    return await deps.fetch(`https://www.googleapis.com/upload/drive/v3/files${path}?uploadType=multipart&fields=id,webViewLink`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body: payload,
    });
  };
  const [known] = await sql`select doc_id from public.yt_editor_docs where idea_id = ${ideaId}`;
  let res = known ? await send("PATCH", `/${encodeURIComponent(known.doc_id)}`, { name }) : null;
  // A doc the owner deleted, or one that never existed, is made again.
  const created = !res || res.status === 404;
  if (created) res = await send("POST", "", { name, mimeType: "application/vnd.google-apps.document" });
  const out = await res!.json().catch(() => ({}));
  if (!res!.ok) {
    const reason = JSON.stringify(out);
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason)) throw new HttpError(409, "drive_off", DRIVE_OFF, reason);
    if (res!.status === 401 || res!.status === 403) throw new HttpError(409, "docs_not_allowed", NOT_ALLOWED, reason);
    throw new HttpError(502, "google_error", "Google Docs did not take the notes. Try again in a moment.", reason);
  }
  const docId = String(out.id ?? known?.doc_id ?? "");
  const url = String(out.webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`);
  if (!docId) throw new HttpError(502, "google_error", "Google Docs did not say which doc it made. Try again.");
  await sql`
    insert into public.yt_editor_docs (idea_id, doc_id, doc_url, pushed_at) values (${ideaId}, ${docId}, ${url}, now())
    on conflict (idea_id) do update set doc_id = excluded.doc_id, doc_url = excluded.doc_url, pushed_at = excluded.pushed_at`;
  return { url, created, cuts: sheets.length };
}
