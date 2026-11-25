// The script starter in the idea editor: the AI drafts the hook, what happens and the beats from the
// idea, the owner's templates and what worked for the same idea elsewhere. Empty parts are filled
// straight in; parts the owner already wrote are never overwritten without asking.

import { useState } from "react";
import { useToast } from "../components/ui.tsx";
import { draftScript } from "../lib/api.ts";
import { useConnection } from "../lib/hooks.ts";
import type { IdeaDraft } from "../lib/types.ts";
import { useCuts } from "./EditorNotes.tsx";

type Part = "hook" | "concept" | "outline";
const LABEL: Record<Part, string> = { hook: "Hook", concept: "What happens", outline: "Outline" };

export function ScriptStarter({ form, onUse }: { form: IdeaDraft; onUse: (part: Part, text: string) => void }) {
  const connection = useConnection();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<Part, string>> | null>(null);
  const [fromCut, setFromCut] = useState<string | null>(null);
  const ai = Boolean(connection.data?.ai);
  // With cuts brought in from Premiere, the draft is built on the newest cut and the notes left on it.
  const cuts = useCuts(form.id);
  const cut = cuts[cuts.length - 1];

  const run = async () => {
    setBusy(true);
    try {
      const out = await draftScript({
        idea_id: form.id, title: form.title, game: form.topic?.trim() || null, format: form.format ?? "long",
        hook: form.hook, concept: form.concept, outline: form.outline,
      });
      // Fill what is empty; hold back what would replace the owner's own words.
      const held: Partial<Record<Part, string>> = {};
      for (const part of ["hook", "concept", "outline"] as Part[]) {
        if (!out[part]) continue;
        if ((form[part] ?? "").trim()) held[part] = out[part];
        else onUse(part, out[part]);
      }
      setDraft(Object.keys(held).length ? held : null);
      setFromCut(out.from_cut);
      const from = out.from_cut ? `Built from ${out.from_cut}. ` : "";
      toast(Object.keys(held).length ? `${from}Pick which parts to use below.` : `${from}Draft added. Make it yours: rewrite it in your own words.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The draft could not be written. Try again.", { error: true });
    }
    setBusy(false);
  };

  return (
    <div className="script-starter">
      <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-small" disabled={busy || !ai || !form.title.trim()} onClick={() => void run()}>
          {busy ? "Writing a draft" : cut ? `Draft from ${cut.name}` : "Draft a script"}
        </button>
        <small className="muted grow" style={{ minWidth: 0 }}>
          {!ai ? "Add your Claude API key in Settings to switch this on."
            : busy ? "This takes up to a minute."
            : cut ? `Lays the outline on ${cut.name}'s timeline, works in the ${cut.markers.length} ${cut.markers.length === 1 ? "note" : "notes"} you left on it, and writes the voiceover in your voice. You rewrite it.`
            : "A first draft from your idea, your templates and what worked for others. You rewrite it."}
        </small>
      </div>
      {draft ? (
        <div className="script-draft">
          <div className="row between" style={{ gap: 8 }}>
            <strong>{fromCut ? `Built from ${fromCut}, for the parts you already wrote` : "Draft for the parts you already wrote"}</strong>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setDraft(null)}>Keep mine</button>
          </div>
          {(Object.keys(draft) as Part[]).map((part) => (
            <div key={part} className="script-draft-part">
              <div className="row between" style={{ gap: 8 }}>
                <span className="small" style={{ fontWeight: 650 }}>{LABEL[part]}</span>
                <button
                  type="button" className="btn btn-small"
                  onClick={() => {
                    onUse(part, draft[part]!);
                    const rest = { ...draft };
                    delete rest[part];
                    setDraft(Object.keys(rest).length ? rest : null);
                  }}
                >
                  Use this
                </button>
              </div>
              <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{draft[part]}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
