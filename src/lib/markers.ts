// Notes for the editor, read from markers exported from Premiere Pro (Markers panel, then File, Export,
// Markers). Premiere writes the file as tab-separated text in UTF-16; other editors write comma-separated
// UTF-8. Both are read here, in the browser, and turned into a list the editor can follow line by line.

export interface Marker {
  /** Where it is, as the timecode Premiere wrote ("00:01:05:12"). */
  at: string;
  /** Where a marker that spans a stretch ends; null for a single point. */
  end: string | null;
  name: string;
  note: string;
  /** Premiere's marker type ("Comment", "Chapter"...), when the file has one. */
  type: string | null;
}

/** The file's text, whatever encoding Premiere or another tool used. */
export function decodeFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  // UTF-16 without a mark: in plain English text every other byte is zero.
  const n = Math.min(bytes.length, 400);
  let zeros = 0;
  for (let i = 1; i < n; i += 2) if (bytes[i] === 0) zeros++;
  if (n > 3 && zeros > n / 4) return new TextDecoder("utf-16le").decode(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Rows of a tab-, comma- or semicolon-separated file; quoted fields may hold the separator, quotes or line breaks. */
export function parseRows(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = ["\t", ",", ";"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Seconds into the video for a timecode ("01:02:05:12", "00;01;05;12", "1:05", "65.5"); null when it is not one. */
export function seconds(tc: string): number | null {
  const parts = tc.trim().split(/[:;]/);
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 4) return n[0] * 3600 + n[1] * 60 + n[2] + n[3] / 1000;
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 1) return n[0];
  return null;
}

/** A timecode the way a person says it: "1:05", or "1:02:05" past the hour. */
export function shortTime(tc: string): string {
  const s = seconds(tc);
  if (s === null) return tc;
  const whole = Math.floor(s), h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), sec = whole % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

const column = (header: string[], ...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));

/** The markers in an export, in time order, or what is wrong with the file in plain words. */
export function readMarkers(text: string): { markers: Marker[]; problem: string | null } {
  const rows = parseRows(text);
  const none = "That file has no markers in it. In Premiere, open the Markers panel, then use File, Export, Markers.";
  if (rows.length < 2) return { markers: [], problem: none };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const at = column(header, /^in$/, /^start/, /^(timecode|time|source in|record in)$/);
  if (at < 0) return { markers: [], problem: "That file does not look like a marker export: it has no In column. In Premiere, use File, Export, Markers." };
  const end = column(header, /^out$/, /^end/);
  const duration = column(header, /^duration$/);
  const name = column(header, /^(marker )?name$/, /^title$/);
  const note = column(header, /^description$/, /^comments?$/, /^notes?$/);
  const type = column(header, /^(marker )?type$/, /^colou?r$/);
  const markers = rows.slice(1).flatMap((r): Marker[] => {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const start = cell(at);
    if (seconds(start) === null) return [];
    const stop = cell(end);
    const length = duration >= 0 ? seconds(cell(duration)) : null;
    const spans = Boolean(stop) && seconds(stop) !== null && seconds(stop)! > seconds(start)! && length !== 0;
    const label = cell(name), said = cell(note);
    return [{ at: start, end: spans ? stop : null, name: label === said ? "" : label, note: said, type: cell(type) || null }];
  }).sort((a, b) => seconds(a.at)! - seconds(b.at)!);
  return markers.length ? { markers, problem: null } : { markers: [], problem: none };
}

// Short words before a full stop that do not end a sentence.
const NOT_AN_END = new Set(["mr", "mrs", "ms", "dr", "st", "vs", "etc", "lvl", "pt", "no"]);

/** A marker's note, one sentence per line, the way the owner likes to read. */
export function noteLines(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const out: string[] = [];
    let from = 0;
    const end = /[.!?…]+["”')]*\s+(?=["“'(A-Z0-9])/g;
    for (let m = end.exec(line); m; m = end.exec(line)) {
      const word = (/([A-Za-z]+)\.$/.exec(line.slice(from, m.index + 1))?.[1] ?? "").toLowerCase();
      if (NOT_AN_END.has(word)) continue;
      out.push(line.slice(from, m.index + m[0].trimEnd().length).trim());
      from = m.index + m[0].length;
    }
    out.push(line.slice(from).trim());
    return out.filter(Boolean);
  });
}

/** Where a marker is, as a person reads it: "1:05", or "1:05 to 1:20" for a stretch. */
export const markerWhen = (m: Marker) => (m.end ? `${shortTime(m.at)} to ${shortTime(m.end)}` : shortTime(m.at));

/** The whole list as plain text to send the editor: numbered, in time order, one thought per line. */
export function editorText(title: string, sheet: { name: string; markers: Marker[] }): string {
  const n = sheet.markers.length;
  const lines = [`Notes for the editor: ${title}`, `${sheet.name}: ${n} ${n === 1 ? "note" : "notes"}, in order`, ""];
  sheet.markers.forEach((m, i) => {
    lines.push(`${i + 1}. ${markerWhen(m)} (timecode ${m.at}${m.end ? ` to ${m.end}` : ""})`);
    if (m.type && !/^comment$/i.test(m.type)) lines.push(`   ${m.type}`);
    if (m.name) lines.push(`   ${m.name}`);
    for (const line of noteLines(m.note)) lines.push(`   ${line}`);
    if (!m.name && !m.note) lines.push("   (no note on this marker)");
    lines.push("");
  });
  return `${lines.join("\n").trim()}\n`;
}
