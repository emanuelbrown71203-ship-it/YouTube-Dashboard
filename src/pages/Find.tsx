// One box that finds a thought wherever it was put: an idea, a line to remember, a template, a script
// or a goal. The owner said their notes felt scattered across the app; this is the one place to look.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useGoals } from "../lib/growth.ts";
import { useIdeas } from "../lib/hooks.ts";
import { useNotes } from "./Notes.tsx";
import { useScripts } from "./Scripts.tsx";
import { useTemplates } from "./Templates.tsx";

interface Hit { id: string; title: string; text: string; href: string }

const words = (q: string) => q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 2);
const plain = (t: string | null | undefined) => String(t ?? "").replace(/^\s*[-*•]\s+(?:\[[ xX]\]\s+)?/gm, "").replace(/\s+/g, " ").trim();

/** Every word of the search is somewhere in the thing. */
export const matches = (q: string[], ...fields: (string | null | undefined)[]) => {
  const all = fields.map(plain).join(" ").toLowerCase();
  return q.length > 0 && q.every((w) => all.includes(w));
};

/** A short piece of the text around the first word searched for. */
export function snippet(text: string, q: string[], around = 60): string {
  const t = plain(text);
  const at = q.map((w) => t.toLowerCase().indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const from = Math.max(0, at - around), to = Math.min(t.length, at + around * 2);
  return `${from > 0 ? "…" : ""}${t.slice(from, to).trim()}${to < t.length ? "…" : ""}`;
}

function Marked({ text, q }: { text: string; q: string[] }): ReactNode {
  if (!q.length) return text;
  const parts = text.split(new RegExp(`(${q.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi"));
  return parts.map((p, i) => (q.includes(p.toLowerCase()) ? <mark key={i}>{p}</mark> : p));
}

export function FindBox({ label = "Find anything you wrote down" }: { label?: string }) {
  const [query, setQuery] = useState("");
  const ideas = useIdeas(), notes = useNotes(), templates = useTemplates(), scripts = useScripts(), goals = useGoals();
  const q = useMemo(() => words(query), [query]);
  const groups = useMemo(() => {
    if (!q.length) return [];
    const first = (...fields: (string | null | undefined)[]) => fields.find((f) => matches(q, f)) ?? fields.find(Boolean) ?? "";
    const list: { name: string; hits: Hit[] }[] = [
      {
        name: "Ideas",
        hits: (ideas.data ?? []).filter((i) => matches(q, i.title, i.topic, i.hook, i.concept, i.outline, i.notes))
          .map((i) => ({ id: i.id, title: i.title, text: first(i.hook, i.concept, i.outline, i.notes, i.topic), href: `#/ideas?edit=${i.id}` })),
      },
      {
        name: "Lines to remember",
        hits: (notes.data ?? []).filter((n) => matches(q, n.text, n.source, n.topic))
          .map((n) => ({ id: n.id, title: plain(n.text).slice(0, 90), text: n.source ?? "", href: "#/playbook/lines" })),
      },
      {
        name: "Templates",
        hits: (templates.data ?? []).filter((t) => matches(q, t.name, t.body))
          .map((t) => ({ id: t.id, title: t.name, text: t.body, href: "#/playbook" })),
      },
      {
        name: "My scripts",
        hits: (scripts.data ?? []).filter((s) => matches(q, s.title, s.topic, s.body))
          .map((s) => ({ id: s.id, title: s.title, text: s.body, href: "#/playbook/scripts" })),
      },
      {
        name: "Goals",
        hits: (goals.data ?? []).filter((g) => matches(q, g.title, g.notes, g.plan))
          .map((g) => ({ id: g.id, title: g.title, text: first(g.plan, g.notes), href: "#/goals" })),
      },
    ];
    return list.filter((g) => g.hits.length);
  }, [q, ideas.data, notes.data, templates.data, scripts.data, goals.data]);

  return (
    <div className="find">
      <input
        className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={label} aria-label={label} enterKeyHint="search"
      />
      {q.length ? (
        groups.length === 0 ? <p className="small muted" style={{ margin: "8px 0 0" }}>Nothing with "{query.trim()}" in it yet.</p> : (
          <div className="find-results">
            {groups.map((g) => (
              <div key={g.name} className="find-group">
                <h3>{g.name} ({g.hits.length})</h3>
                {g.hits.slice(0, 5).map((h) => (
                  <a key={h.id} className="find-hit" href={h.href}>
                    <Marked text={h.title} q={q} />
                    {h.text ? <span className="small muted"><Marked text={snippet(h.text, q)} q={q} /></span> : null}
                  </a>
                ))}
                {g.hits.length > 5 ? <p className="small muted" style={{ margin: 0 }}>And {g.hits.length - 5} more. Add a word to narrow it down.</p> : null}
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
