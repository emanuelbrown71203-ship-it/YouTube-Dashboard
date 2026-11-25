import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { keywordWords, titleMatches } from "../../supabase/functions/yt-api/scoring.ts";
import { ErrorNote, Icon, Meter, Thumb, useToast } from "../components/ui.tsx";
import { checkKeyword, saveKeyword, suggestKeywords } from "../lib/api.ts";
import { setPendingIdea } from "../lib/draft.ts";
import { ago, compact, count, day } from "../lib/format.ts";
import { keys, useKeywords, useResearchRuns, useVideos } from "../lib/hooks.ts";
import { navigate } from "../lib/router.ts";
import type { KeywordRow } from "../lib/types.ts";

interface Suggestion {
  phrase: string;
  top: boolean;
}

function verdict(score: number | null): string {
  if (score === null) return "Too little to go on";
  return score >= 65 ? "Strong opening" : score >= 45 ? "Worth a try" : "Hard to rank for";
}

const titleCase = (phrase: string) => phrase.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function ResearchKeywords({ connected, initial }: { connected: boolean; initial: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const keywords = useKeywords();
  const videos = useVideos();
  const runs = useResearchRuns<Suggestion[]>("suggest");
  const [seed, setSeed] = useState(initial);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [listing, setListing] = useState(false);
  const [checking, setChecking] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [savedOnly, setSavedOnly] = useState(false);

  const byPhrase = useMemo(() => new Map((keywords.data ?? []).map((k) => [k.keyword, k])), [keywords.data]);
  const phrase = seed.toLowerCase().replace(/\s+/g, " ").trim();

  const list = async (e?: FormEvent) => {
    e?.preventDefault();
    if (phrase.length < 2) return;
    setListing(true);
    setError(null);
    try {
      setSuggestions((await suggestKeywords(phrase)).suggestions);
      void queryClient.invalidateQueries({ queryKey: keys.research("suggest") });
    } catch (err) {
      setError(err);
    }
    setListing(false);
  };

  const check = async (target: string) => {
    setChecking((c) => [...c, target]);
    setError(null);
    try {
      const res = await checkKeyword(target);
      queryClient.setQueryData(keys.quota, res.quota.used_today);
      await queryClient.invalidateQueries({ queryKey: keys.keywords });
      setOpen(res.keyword);
    } catch (err) {
      setError(err);
    }
    setChecking((c) => c.filter((p) => p !== target));
  };

  const toggleSaved = async (row: KeywordRow) => {
    try {
      await saveKeyword(row.keyword, !row.saved);
      await queryClient.invalidateQueries({ queryKey: keys.keywords });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that phrase.", { error: true });
    }
  };

  const detail = open ? byPhrase.get(open) ?? null : null;
  const table = (keywords.data ?? []).filter((k) => !savedOnly || k.saved);

  return (
    <>
      <form className="panel panel-pad stack" onSubmit={list}>
        <div className="quick-add">
          <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="A topic, like elden ring challenge" aria-label="Topic or phrase" maxLength={80} />
          <button type="submit" className="btn btn-primary" disabled={listing || phrase.length < 2}>{listing ? "Asking YouTube" : "List what people search"}</button>
          <button type="button" className="btn" disabled={!connected || phrase.length < 2 || checking.includes(phrase)} onClick={() => void check(phrase)}>
            {checking.includes(phrase) ? "Checking" : "Score this exact phrase"}
          </button>
        </div>
        <p className="small muted">
          Listing phrases is free. Scoring one looks at the videos that rank for it and uses 1% of today's free lookups.
          Scores are estimates from those videos. YouTube does not publish how often anything is searched.
        </p>
      </form>

      {error ? <div style={{ marginTop: 16 }}><ErrorNote error={error} /></div> : null}

      {detail ? <KeywordDetail row={detail} myVideos={videos.data ?? []} onClose={() => setOpen(null)} onSave={() => void toggleSaved(detail)} onRecheck={() => void check(detail.keyword)} rechecking={checking.includes(detail.keyword)} connected={connected} /> : null}

      {suggestions ? (
        <section className="section">
          <div className="section-head">
            <h2>{count(suggestions.length, "phrase")} people type</h2>
            <span className="small muted">YouTube's own search suggestions</span>
          </div>
          {suggestions.length === 0 ? (
            <div className="panel"><div className="empty"><h3>No suggestions</h3><p>YouTube has nothing for that. Try fewer or more common words.</p></div></div>
          ) : (
            <div className="panel">
              {suggestions.map((s) => {
                const known = byPhrase.get(s.phrase);
                return (
                  <div className="item" key={s.phrase} style={{ alignItems: "center" }}>
                    <div className="grow">
                      <span className="title">{s.phrase}</span>
                      {s.top ? <span className="tag" style={{ marginLeft: 8 }}>Suggested first</span> : null}
                    </div>
                    {known ? (
                      <button type="button" className="btn btn-small" onClick={() => setOpen(known.keyword)}>
                        <span className="fig" style={{ fontSize: 15 }}>{known.overall_score ?? "–"}</span>{verdict(known.overall_score)}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small" disabled={!connected || checking.includes(s.phrase)} onClick={() => void check(s.phrase)}>
                        {checking.includes(s.phrase) ? "Checking" : "Score it"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (runs.data ?? []).length ? (
        <section className="section">
          <div className="section-head"><h2>Earlier lists</h2><span className="small muted">Opening one costs nothing</span></div>
          <div className="row-wrap">
            {(runs.data ?? []).map((r) => (
              <button key={r.id} type="button" className="chip" onClick={() => { setSeed(r.query); setSuggestions(r.results); }}>
                {r.query}<span className="muted" style={{ fontWeight: 500 }}>{ago(r.created_at)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {(keywords.data ?? []).length ? (
        <section className="section">
          <div className="section-head">
            <h2>Phrases you have scored</h2>
            <button type="button" className="chip" aria-pressed={savedOnly} onClick={() => setSavedOnly((v) => !v)}>Saved only</button>
          </div>
          <div className="panel">
            {table.length === 0 ? <div className="empty"><h3>Nothing saved yet</h3><p>Open a phrase and press Save to keep it here.</p></div> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Phrase</th><th className="num">Opening</th><th className="num wide">Demand</th><th className="num wide">Competition</th><th className="num">Your rank</th><th className="num wide">Checked</th></tr>
                  </thead>
                  <tbody>
                    {table.map((k) => (
                      <tr key={k.keyword} className="clickable" onClick={() => setOpen(k.keyword)}>
                        <td>
                          <button type="button" className="th-sort" style={{ fontWeight: 600, color: "var(--ink)" }} onClick={(e) => { e.stopPropagation(); setOpen(k.keyword); }}>{k.keyword}</button>
                          {k.saved ? <span className="tag" style={{ marginLeft: 8 }}>Saved</span> : null}
                        </td>
                        <td className="num"><span className="fig" style={{ fontSize: 16 }}>{k.overall_score ?? "–"}</span></td>
                        <td className="num wide">{k.volume_score ?? "–"}</td>
                        <td className="num wide">{k.competition_score ?? "–"}</td>
                        <td className="num">{k.my_rank ? `#${k.my_rank}` : "–"}</td>
                        <td className="num wide">{day(k.analyzed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Score({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div>
      <div className="row between"><span className="k small" style={{ fontWeight: 600 }}>{label}</span><span className="fig" style={{ fontSize: 22 }}>{value ?? "–"}</span></div>
      <Meter value={value ?? 0} max={100} label={label} />
      <div className="small muted" style={{ marginTop: 4 }}>{note}</div>
    </div>
  );
}

function KeywordDetail(props: {
  row: KeywordRow;
  myVideos: { id: string; title: string; views: number | null; privacy: string | null }[];
  onClose: () => void;
  onSave: () => void;
  onRecheck: () => void;
  rechecking: boolean;
  connected: boolean;
}) {
  const { row } = props;
  const s = row.signals;
  const of = (share: number | null) => (share === null ? 0 : Math.round(share * s.top_n));
  const words = keywordWords(row.keyword);
  const mine = props.myVideos.filter((v) => v.privacy === "public" && titleMatches(v.title, words)).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 3);

  return (
    <section className="panel section" style={{ marginTop: 20 }}>
      <div className="panel-pad stack">
        <div className="row-wrap between">
          <div>
            <h2 style={{ fontSize: 20 }}>{row.keyword}</h2>
            <p className="soft">{verdict(row.overall_score)}. Checked {ago(row.analyzed_at)}.</p>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn btn-small" aria-pressed={row.saved} onClick={props.onSave}><Icon name="bookmark" filled={row.saved} />{row.saved ? "Saved" : "Save"}</button>
            <button
              type="button" className="btn btn-small"
              onClick={() => {
                setPendingIdea({ title: titleCase(row.keyword), format: "long", discovery: "search", target_keyword: row.keyword, source: "research", notes: `Search phrase scored ${row.overall_score ?? "–"} of 100 for opportunity.` });
                navigate("/ideas");
              }}
            >
              Make it an idea
            </button>
            <button type="button" className="btn btn-small" onClick={props.onRecheck} disabled={!props.connected || props.rechecking}><Icon name="refresh" />{props.rechecking ? "Checking" : "Check again"}</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={props.onClose} aria-label="Close this phrase"><Icon name="close" /></button>
          </div>
        </div>

        <div className="field-row" style={{ gap: 22 }}>
          <Score label="Opening" value={row.overall_score} note="Higher is better for you" />
          <Score label="Demand" value={row.volume_score} note={s.median_views_per_day === null ? "Unknown" : `Top results earn about ${compact(s.median_views_per_day)} views a day`} />
          <Score label="Competition" value={row.competition_score} note="Lower is easier" />
        </div>

        {s.top_n ? (
          <ul className="soft" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3 }}>
            {s.median_subscribers !== null ? <li>The channels in the top {s.top_n} have about {compact(s.median_subscribers)} subscribers each.</li> : null}
            <li>{of(s.small_channel_share)} of the top {s.top_n} are from channels with {compact(s.small_channel_cutoff)} subscribers or fewer, which is your league.</li>
            <li>{of(s.title_match_share)} of {s.top_n} already use the phrase in their title.</li>
            <li>{of(s.fresh_share)} of {s.top_n} were posted in the last year.</li>
            <li>{row.my_rank ? `Your video is at number ${row.my_rank}.` : `None of your videos is in the top ${s.results}.`}</li>
          </ul>
        ) : <p className="soft">YouTube returned too few videos to judge this phrase.</p>}

        {mine.length ? (
          <div>
            <h3 style={{ marginBottom: 6 }}>Your uploads with this phrase in the title</h3>
            {mine.map((v) => (
              <div key={v.id} className="row between" style={{ padding: "5px 0", borderTop: "1px solid var(--line)" }}>
                <a href={`#/videos?v=${v.id}`} className="clip">{v.title}</a>
                <span className="fig">{compact(v.views)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {row.results.length ? (
        <div className="table-wrap" style={{ borderTop: "1px solid var(--line)" }}>
          <table className="table">
            <thead>
              <tr><th>What ranks today</th><th className="num">Views</th><th className="num wide">Per day</th><th className="num wide">Posted</th><th className="wide">Phrase in title</th></tr>
            </thead>
            <tbody>
              {row.results.slice(0, 15).map((r) => (
                <tr key={r.video_id} style={r.mine ? { background: "var(--accent-soft)" } : undefined}>
                  <td>
                    <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                      <span className="fig muted" style={{ width: 18, textAlign: "right", flex: "none" }}>{r.rank}</span>
                      <Thumb src={r.thumbnail_url} seconds={r.duration_s} small />
                      <div className="grow">
                        <a className="clip2" style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none", lineHeight: 1.3 }} href={`https://www.youtube.com/watch?v=${r.video_id}`} target="_blank" rel="noreferrer">{r.title}</a>
                        <div className="small muted">{r.mine ? "Your video" : r.channel_title}{r.channel_subscribers !== null ? `, ${compact(r.channel_subscribers)} subscribers` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num fig" style={{ fontSize: 16 }}>{compact(r.views)}</td>
                  <td className="num wide">{compact(r.views_per_day)}</td>
                  <td className="num wide">{ago(r.published_at)}</td>
                  <td className="wide">{r.title_match ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
