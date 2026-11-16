// The screens built on top of the raw numbers: by game, Shorts to long, tests
// and changes, the monthly recap, goals, comments and the upload planner.

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { Drawer, ErrorNote, FormatTag, Loading, Segmented, Thumb, useToast } from "../components/ui.tsx";
import { saveIdea } from "../lib/api.ts";
import { ago, compact, count, day, duration, money, multiple, percent, whole } from "../lib/format.ts";
import {
  bestVideo, byTopic, shortsWorthAVideo, type Comment, emptyWeeks, type Goal, type GoalDraft, goalProgress, growthKeys, kindWords, markComment, monthsWithData,
  patchGoal, planMonth, recap, saveGoal, saveTest, shortsFunnel, type Test, type TestDraft, testResult, themes, trashTest,
  testCtr, useChanges, useComments, useGoals, useReachDays, useTests, useVideoDays,
} from "../lib/growth.ts";
import { keys, useChannel, useConnection, useDaily, useIdeas, useVideos } from "../lib/hooks.ts";
import { navigate } from "../lib/router.ts";
import type { Video } from "../lib/types.ts";

const todayIso = () => new Date().toISOString().slice(0, 10);
const message = (err: unknown) => (err instanceof Error ? err.message : "That did not work. Try again.");

export const HOME_TABS = [{ key: "", label: "Overview" }, { key: "recap", label: "Monthly recap" }, { key: "goals", label: "Goals" }, { key: "comments", label: "Comments" }];
export const VIDEO_TABS = [{ key: "", label: "All videos" }, { key: "games", label: "By game" }, { key: "funnel", label: "Shorts to long" }, { key: "tests", label: "Tests" }];
export const IDEA_TABS = [{ key: "", label: "Board" }, { key: "planner", label: "Planner" }];

export function Tabs(props: { label: string; base: string; current: string; tabs: { key: string; label: string }[] }) {
  return (
    <nav className="row-wrap" aria-label={props.label} style={{ marginBottom: 16 }}>
      {props.tabs.map((t) => (
        <a
          key={t.key} className="chip" aria-current={t.key === props.current ? "page" : undefined}
          href={`#${props.base}${t.key ? `/${t.key}` : ""}`} style={{ textDecoration: "none", padding: "7px 14px", fontSize: 14 }}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function Section(props: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="section" style={{ marginTop: 20 }}>
      <div className="section-head"><h2>{props.title}</h2>{props.aside}</div>
      {props.children}
    </div>
  );
}

function VideoLine({ video, children }: { video: Video; children?: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 12, minWidth: 0 }}>
      <Thumb src={video.thumbnail_url} seconds={video.duration_s} small short={video.content_type === "short"} />
      <div className="grow" style={{ minWidth: 0 }}>
        <a className="clip2" style={{ fontWeight: 600, color: "var(--ink)", lineHeight: 1.3, textDecoration: "none" }} href={`#/videos?v=${video.id}`}>{video.title}</a>
        <div className="row-wrap small muted" style={{ marginTop: 4 }}>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// By game
// ---------------------------------------------------------------------------

type TopicSort = "views" | "retention" | "typical" | "earned" | "subs";

export function Games() {
  const videos = useVideos();
  const [format, setFormat] = useState<"short" | "long" | "live">("long");
  const [sort, setSort] = useState<TopicSort>("retention");
  const [open, setOpen] = useState<string | null>(null);
  const all = videos.data ?? [];
  const rows = useMemo(() => {
    const list = byTopic(all, format).filter((r) => r.videos >= 2);
    const pick: Record<TopicSort, (r: (typeof list)[number]) => number> = {
      views: (r) => r.views, retention: (r) => r.retention ?? -1, typical: (r) => r.typicalViews ?? -1,
      earned: (r) => r.earned ?? -1, subs: (r) => r.subs,
    };
    return [...list].sort((a, b) => pick[sort](b) - pick[sort](a));
  }, [all, format, sort]);
  const earning = rows.some((r) => r.earned !== null);
  const unlabelled = all.filter((v) => v.privacy === "public" && !v.topic).length;

  if (videos.isLoading) return <Loading label="Loading your videos" />;
  if (videos.error) return <ErrorNote error={videos.error} retry={() => void videos.refetch()} />;
  return (
    <>
      <p className="soft" style={{ maxWidth: "70ch", marginBottom: 14 }}>
        Your videos grouped by game. Retention is the middle video's, so one freak upload cannot carry a game. Games with a single video are left out. Long-form, Shorts and streams are kept apart, because their views are not comparable.
      </p>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <div className="grow">
          <Segmented
            label="Format" value={format} onChange={setFormat}
            options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Shorts" }, { value: "live", label: "Streams" }]}
          />
        </div>
        <select className="select input" value={sort} onChange={(e) => setSort(e.target.value as TopicSort)} aria-label="Sort games by">
          <option value="retention">Highest retention</option>
          <option value="typical">Highest usual views</option>
          <option value="views">Most views in total</option>
          <option value="subs">Most subscribers gained</option>
          {earning ? <option value="earned">Most earned</option> : null}
        </select>
      </div>
      <div className="panel">
        {rows.length === 0 ? (
          <div className="empty"><h3>Nothing to group yet</h3><p>Games appear here after the next sync has worked out what each video is about. You can also set a video's game yourself when you open it.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Game</th><th className="num">Retention</th><th className="num">Usual views</th>
                  <th className="num wide">Average view</th><th className="num wide">Videos</th><th className="num wide">Views</th>
                  <th className="num wide">Subscribers</th>{earning ? <th className="num wide">Earned</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.topic} className="clickable" onClick={() => setOpen(open === r.topic ? null : r.topic)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.topic}</div>
                      <div className="small muted">{count(r.videos, "video")}{r.lastUpload ? `, last ${ago(r.lastUpload)}` : ""}</div>
                      {open === r.topic ? (
                        <div className="stack" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                          {all.filter((v) => v.topic === r.topic && v.privacy === "public" && v.content_type === format)
                            .sort((a, b) => (b.avg_view_pct ?? -1) - (a.avg_view_pct ?? -1)).slice(0, 8).map((v) => (
                              <VideoLine key={v.id} video={v}>
                                <FormatTag format={v.content_type} /><span>Retention {percent(v.avg_view_pct)}</span><span>{compact(v.views)} views</span>
                              </VideoLine>
                            ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="num fig" style={{ fontSize: 16 }}>{percent(r.retention)}</td>
                    <td className="num">{compact(r.typicalViews)}</td>
                    <td className="num wide">{duration(r.avgViewS)}</td>
                    <td className="num wide">{whole(r.videos)}</td>
                    <td className="num wide">{compact(r.views)}</td>
                    <td className="num wide">{whole(r.subs)}</td>
                    {earning ? <td className="num wide">{money(r.earned)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {unlabelled > 0 ? <p className="small muted" style={{ marginTop: 10 }}>{count(unlabelled, "video")} could not be matched to a game and {unlabelled === 1 ? "is" : "are"} left out. Open a video to set its game by hand.</p> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shorts to long
// ---------------------------------------------------------------------------

export function Funnel() {
  const videos = useVideos();
  const all = videos.data ?? [];
  const funnel = useMemo(() => shortsFunnel(all), [all]);
  const longs = all.filter((v) => v.content_type === "long" && v.privacy === "public").length;
  const hints = useMemo(() => shortsWorthAVideo(all), [all]);
  const toast = useToast();
  const queryClient = useQueryClient();
  const makeIdea = async (short: Video) => {
    try {
      const idea = await saveIdea({
        title: short.title.replace(/#\S+/g, "").trim() || short.title, format: "long", status: "idea",
        notes: `From a Short that did ${multiple(short.vs_typical)} your usual Short: ${short.url ?? short.title}`,
      } as never);
      void queryClient.invalidateQueries({ queryKey: keys.ideas });
      navigate(`/ideas?edit=${idea.id}`);
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  if (videos.isLoading) return <Loading label="Loading your videos" />;
  if (videos.error) return <ErrorNote error={videos.error} retry={() => void videos.refetch()} />;
  return (
    <>
      {hints.length ? (
        <Section title="Shorts that could carry a full video">
          <p className="soft" style={{ maxWidth: "72ch", margin: "0 0 12px" }}>
            A Short's views cannot be compared with a long video's. But a Short that did far better than your other Shorts is a fair hint that the idea has pull.
          </p>
          <div className="panel">
            {hints.map(({ short, covered }) => (
              <div className="item" key={short.id} style={{ gap: 12, alignItems: "flex-start" }}>
                <VideoLine video={short}>
                  <span>{multiple(short.vs_typical)} your usual Short</span>
                  <span>{covered ? `You followed up: ${covered.title}` : short.topic ? `No long video on ${short.topic} since` : "No long video since"}</span>
                </VideoLine>
                {covered ? null : <button type="button" className="btn btn-small" style={{ flex: "none" }} onClick={() => void makeIdea(short)}>Make it an idea</button>}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      <p className="soft" style={{ maxWidth: "72ch", marginBottom: 14 }}>
        Which Shorts sent viewers on to your long videos. This counts people YouTube moved from one of your videos to another through its suggestions.
        It cannot see someone who watched a Short, visited your channel later and picked a video there.
      </p>
      {funnel.measured === 0 ? (
        <div className="panel"><div className="empty"><h3>Not measured yet</h3><p>The sync checks a few long videos each time it runs. The first results appear after the next sync.</p></div></div>
      ) : (
        <>
          <div className="panel panel-pad" style={{ marginBottom: 14 }}>
            <strong className="fig" style={{ fontSize: 26 }}>{whole(funnel.fromShorts)}</strong>{" "}
            <span className="soft">
              views on your long videos came straight from your Shorts, against {whole(funnel.fromOthers)} from other videos
              {funnel.measured < longs ? `. Measured on ${funnel.measured} of ${longs} long videos so far` : ""}.
            </span>
          </div>
          <div className="panel">
            {funnel.rows.length === 0 ? (
              <div className="empty"><h3>No Short has sent viewers on yet</h3><p>None of the long videos measured so far got views from one of your Shorts through YouTube's suggestions.</p></div>
            ) : funnel.rows.slice(0, 40).map((row) => (
              <div className="item" key={row.short.id} style={{ flexDirection: "column", gap: 8 }}>
                <div className="row between" style={{ width: "100%", gap: 12, alignItems: "flex-start" }}>
                  <VideoLine video={row.short}><span>{compact(row.short.views)} views</span><span>{whole(row.short.subs_gained)} subscribers gained</span></VideoLine>
                  <div style={{ textAlign: "right", flex: "none" }}><div className="fig" style={{ fontSize: 20 }}>{whole(row.sent)}</div><div className="small muted">sent on</div></div>
                </div>
                <div className="small soft" style={{ paddingLeft: 4 }}>
                  {row.to.sort((a, b) => b.views - a.views).slice(0, 3).map((t) => (
                    <div key={t.video.id} className="clip">to <a href={`#/videos?v=${t.video.id}`}>{t.video.title}</a> ({whole(t.views)})</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tests and changes
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<Test["kind"], string> = { thumbnail: "Thumbnail", title: "Title", both: "Title and thumbnail", other: "Something else" };
const VERDICT_LABEL = { better: "It worked", worse: "It made things worse", same: "No real difference" } as const;

export function Tests() {
  const tests = useTests();
  const changes = useChanges();
  const videos = useVideos();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<TestDraft | null>(null);
  const list = tests.data ?? [];
  const ids = useMemo(() => [...new Set(list.map((t) => t.video_id))].sort(), [list]);
  const days = useVideoDays(ids);
  const reachDays = useReachDays(ids);
  const byId = useMemo(() => new Map((videos.data ?? []).map((v) => [v.id, v])), [videos.data]);
  const today = todayIso();

  if (tests.isLoading || videos.isLoading) return <Loading label="Loading your tests" />;
  if (tests.error) return <ErrorNote error={tests.error} retry={() => void tests.refetch()} />;
  const reload = () => void queryClient.invalidateQueries({ queryKey: growthKeys.tests });
  return (
    <>
      <div className="row-wrap between" style={{ marginBottom: 14 }}>
        <p className="soft grow" style={{ maxWidth: "70ch", margin: 0 }}>
          Write down each title or thumbnail test: what you changed and what you expected. The dashboard compares the four weeks before with the weeks after.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ video_id: "", what: "", kind: "thumbnail", started_on: today })}>New test</button>
      </div>

      <div className="panel">
        {list.length === 0 ? (
          <div className="empty"><h3>No tests yet</h3><p>Start one when you next change a thumbnail or title. You can also start one from a change the dashboard noticed, below.</p></div>
        ) : list.map((t) => {
          const video = byId.get(t.video_id);
          const r = testResult(t, days.data ?? [], today);
          const measured = testCtr(t, reachDays.data ?? [], today);
          // YouTube's own figure when it has reported one, otherwise what was typed in from Studio.
          const ctr = { before: measured.before ?? t.ctr_before, after: measured.after ?? t.ctr_after };
          return (
            <div className="item" key={t.id} style={{ flexDirection: "column", gap: 10 }}>
              <div className="row between" style={{ width: "100%", gap: 12, alignItems: "flex-start" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-wrap small" style={{ marginBottom: 4 }}>
                    <span className="tag">{KIND_LABEL[t.kind]}</span>
                    <span className="muted">{r.running ? `Running since ${day(t.started_on)}` : `${day(t.started_on)} to ${day(t.ended_on)}`}</span>
                    {t.verdict ? <span className="tag" style={{ fontWeight: 600 }}>{VERDICT_LABEL[t.verdict]}</span> : null}
                  </div>
                  <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{t.what}</div>
                  {t.why ? <div className="small soft" style={{ marginTop: 2 }}>Expected: {t.why}</div> : null}
                  <div className="small muted clip" style={{ marginTop: 4 }}>
                    on {video ? <a href={`#/videos?v=${video.id}`}>{video.title}</a> : "a video that is no longer on the channel"}
                  </div>
                </div>
                <button type="button" className="btn btn-small" onClick={() => setEditing(t)}>Edit</button>
              </div>
              {r.before.days === 0 && r.after.days === 0 ? (
                <div className="small muted">The numbers for this video load with the next sync.</div>
              ) : (
                <table className="compare" style={{ maxWidth: 520 }}>
                  <thead><tr><th /><th>Before</th><th>After</th><th>Change</th></tr></thead>
                  <tbody>
                    <tr><td>Views a day</td><td className="v">{compact(r.before.viewsPerDay)}</td><td className="v">{compact(r.after.viewsPerDay)}</td>
                      <td className="v">{r.viewsChange === null ? "–" : `${r.viewsChange >= 0 ? "+" : ""}${Math.round(r.viewsChange * 100)}%`}</td></tr>
                    <tr><td>Watch minutes a day</td><td className="v">{compact(r.before.watchMinPerDay)}</td><td className="v">{compact(r.after.watchMinPerDay)}</td><td className="v" /></tr>
                    <tr><td>Click-through rate</td><td className="v">{ctr.before === null ? "–" : `${ctr.before}%`}</td><td className="v">{ctr.after === null ? "–" : `${ctr.after}%`}</td>
                      <td className="v">{ctr.before !== null && ctr.after !== null ? `${ctr.after - ctr.before >= 0 ? "+" : ""}${(ctr.after - ctr.before).toFixed(1)} pts` : ""}</td></tr>
                  </tbody>
                </table>
              )}
              {r.after.days > 0 && r.after.days < 7 ? <div className="small muted">Only {count(r.after.days, "day")} of results so far. Give it at least a week before deciding.</div> : null}
              {t.learned ? <div className="small"><span className="muted">What I learned:</span> {t.learned}</div> : null}
            </div>
          );
        })}
      </div>

      <Section title="Changes the dashboard noticed">
        <div className="panel">
          {(changes.data ?? []).length === 0 ? (
            <div className="empty"><p>When you change a title or thumbnail on YouTube, it shows up here after the next sync, ready to turn into a test.</p></div>
          ) : (changes.data ?? []).slice(0, 30).map((c) => {
            const video = byId.get(c.video_id);
            return (
              <div className="item" key={c.id}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small muted">{c.field === "title" ? "Title changed" : "Thumbnail changed"}, noticed {ago(c.changed_at)}</div>
                  {c.field === "title" ? (
                    <div style={{ lineHeight: 1.35 }}><span className="muted" style={{ textDecoration: "line-through" }}>{c.old_value}</span><br /><strong>{c.new_value}</strong></div>
                  ) : <div className="clip" style={{ fontWeight: 600 }}>{video?.title ?? c.video_id}</div>}
                </div>
                <button
                  type="button" className="btn btn-small"
                  onClick={() => setEditing({ video_id: c.video_id, kind: c.field, what: c.field === "title" ? `New title: ${c.new_value ?? ""}`.slice(0, 200) : "New thumbnail", started_on: c.changed_at.slice(0, 10) })}
                >
                  Track as a test
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      {editing ? (
        <TestEditor
          draft={editing} videos={videos.data ?? []} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); toast("Test saved."); }}
        />
      ) : null}
    </>
  );
}

function TestEditor(props: { draft: TestDraft; videos: Video[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<TestDraft>(props.draft);
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState("");
  const set = <K extends keyof TestDraft>(key: K, value: TestDraft[K]) => setForm((f) => ({ ...f, [key]: value }));
  const picked = props.videos.find((v) => v.id === form.video_id);
  const matches = find.trim().length >= 2
    ? props.videos.filter((v) => v.title.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6)
    : [...props.videos].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 5);
  const num = (value: string) => (value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  const save = async () => {
    setSaving(true);
    try {
      await saveTest(form);
      props.onSaved();
    } catch (err) {
      toast(message(err), { error: true });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      title={form.id ? "Edit test" : "New test"} onClose={props.onClose}
      footer={(
        <>
          {form.id ? <button type="button" className="btn btn-danger" onClick={() => void trashTest(form.id!).then(props.onSaved, (e) => toast(message(e), { error: true }))}>Move to bin</button> : <span />}
          <button type="button" className="btn btn-primary" disabled={saving || !form.video_id || !form.what.trim()} onClick={() => void save()}>{saving ? "Saving" : "Save test"}</button>
        </>
      )}
    >
      <div className="field">
        <span>Video</span>
        {picked ? (
          <div className="row between" style={{ gap: 10 }}>
            <span className="clip grow" style={{ fontWeight: 600 }}>{picked.title}</span>
            <button type="button" className="btn btn-small" onClick={() => set("video_id", "")}>Change</button>
          </div>
        ) : (
          <>
            <input className="input" type="search" placeholder="Search your titles" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search your titles" />
            <div className="stack" style={{ gap: 4 }}>
              {matches.map((v) => <button key={v.id} type="button" className="btn clip" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => set("video_id", v.id)}>{v.title}</button>)}
            </div>
          </>
        )}
      </div>
      <div className="field">
        <span>What are you changing?</span>
        <Segmented
          label="What are you changing" value={form.kind ?? "thumbnail"} onChange={(v) => set("kind", v)}
          options={[{ value: "thumbnail", label: "Thumbnail" }, { value: "title", label: "Title" }, { value: "both", label: "Both" }, { value: "other", label: "Other" }]}
        />
      </div>
      <label className="field">
        <span>What you are testing</span>
        <input className="input" value={form.what} maxLength={200} onChange={(e) => set("what", e.target.value)} placeholder="Close-up of my face instead of the boss" />
      </label>
      <label className="field">
        <span>What you expect to happen</span>
        <input className="input" value={form.why ?? ""} maxLength={300} onChange={(e) => set("why", e.target.value || null)} placeholder="More people click because the stakes are clearer" />
      </label>
      <div className="field-row">
        <label className="field"><span>Changed on</span><input className="input" type="date" value={form.started_on ?? todayIso()} onChange={(e) => set("started_on", e.target.value)} /></label>
        <label className="field"><span>Ended on</span><input className="input" type="date" value={form.ended_on ?? ""} onChange={(e) => set("ended_on", e.target.value || null)} /><small>Leave empty while it runs.</small></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Click-through rate before (%)</span><input className="input" inputMode="decimal" value={form.ctr_before ?? ""} onChange={(e) => set("ctr_before", num(e.target.value))} /></label>
        <label className="field"><span>Click-through rate after (%)</span><input className="input" inputMode="decimal" value={form.ctr_after ?? ""} onChange={(e) => set("ctr_after", num(e.target.value))} /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Click-through rate fills in on its own once YouTube's daily reach report is arriving (it runs a day or two behind). Until then you can copy it from the video's Reach tab in YouTube Studio. Views and watch time always fill in on their own.</p>
      <div className="field">
        <span>How did it go?</span>
        <Segmented
          label="How did it go" value={form.verdict ?? "none"} onChange={(v) => set("verdict", v === "none" ? null : v)}
          options={[{ value: "none", label: "Not decided" }, { value: "better", label: "Worked" }, { value: "same", label: "No difference" }, { value: "worse", label: "Worse" }]}
        />
      </div>
      <label className="field">
        <span>What you learned</span>
        <textarea className="input" rows={3} value={form.learned ?? ""} maxLength={1000} onChange={(e) => set("learned", e.target.value || null)} />
      </label>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Monthly recap
// ---------------------------------------------------------------------------

export function Recap() {
  const daily = useDaily();
  const videos = useVideos();
  const months = useMemo(() => monthsWithData(daily.data ?? []), [daily.data]);
  const today = todayIso();
  // Open on the last finished month: that is the one worth reading.
  const firstDone = months.find((m) => m < today.slice(0, 7)) ?? months[0];
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? firstDone;
  if (daily.isLoading || videos.isLoading) return <Loading label="Adding up the month" />;
  if (daily.error) return <ErrorNote error={daily.error} retry={() => void daily.refetch()} />;
  if (!shown) return <div className="panel"><div className="empty"><h3>No months to recap yet</h3><p>The recap fills in once your daily numbers have loaded.</p></div></div>;
  const r = recap(shown, daily.data ?? [], videos.data ?? [], today);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const delta = (now: number, then: number | undefined) => (then && r.complete ? `${now >= then ? "+" : ""}${Math.round((100 * (now - then)) / then)}% on the month before` : "");
  return (
    <>
      <div className="row-wrap between" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{r.label}</h2>
        <select className="select input" value={shown} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.slice(0, 36).map((m) => <option key={m} value={m}>{label(m)}{m === today.slice(0, 7) ? " (so far)" : ""}</option>)}
        </select>
      </div>
      {!r.complete ? <div className="notice plain"><span className="grow">This month is still going, and YouTube's numbers run two to three days behind, so it is not compared with last month yet.</span></div> : null}
      <div className="panel panel-pad stack" style={{ gap: 6 }}>
        {r.lines.map((line) => <p key={line} style={{ margin: 0, maxWidth: "72ch" }}>{line}</p>)}
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr><td>Views</td><td className="num fig" style={{ fontSize: 16 }}>{whole(r.views)}</td><td className="small muted">{delta(r.views, r.previous?.views)}</td></tr>
              <tr><td>Watch hours</td><td className="num fig" style={{ fontSize: 16 }}>{whole(r.watchHours)}</td><td className="small muted">{delta(r.watchHours, r.previous?.watchHours)}</td></tr>
              <tr><td>Subscribers, net</td><td className="num fig" style={{ fontSize: 16 }}>{r.subsNet >= 0 ? "+" : ""}{whole(r.subsNet)}</td><td className="small muted">{r.previous && r.complete ? `${r.previous.subsNet >= 0 ? "+" : ""}${whole(r.previous.subsNet)} the month before` : ""}</td></tr>
              {r.bestDay ? <tr><td>Best day</td><td className="num fig" style={{ fontSize: 16 }}>{whole(r.bestDay.views)}</td><td className="small muted">{day(r.bestDay.date)}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <Section title={`Uploads in ${r.label}`}>
        <div className="panel">
          {r.uploads.length === 0 ? <div className="empty"><p>Nothing public went up this month.</p></div> : r.uploads.slice(0, 12).map((v) => (
            <div className="item" key={v.id}>
              <VideoLine video={v}>
                <FormatTag format={v.content_type} /><span>{compact(v.views)} views</span><span>Retention {percent(v.avg_view_pct)}</span>
                {v.estimated_revenue !== null ? <span>{money(v.estimated_revenue)}</span> : null}
              </VideoLine>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function useGoalContext() {
  const channel = useChannel();
  const videos = useVideos();
  const daily = useDaily();
  return { subscribers: channel.data?.subscribers ?? null, videos: videos.data ?? [], daily: daily.data ?? [], today: todayIso() };
}

function GoalRow({ goal, onEdit }: { goal: Goal; onEdit?: () => void }) {
  const ctx = useGoalContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const p = goalProgress(goal, ctx);
  const video = goal.video_id ? ctx.videos.find((v) => v.id === goal.video_id) : undefined;
  const best = goal.kind === "video_views" && !goal.video_id ? bestVideo(ctx.videos, goal.format) : undefined;
  const anyOf = goal.format === "long" ? "Any long-form video" : goal.format === "short" ? "Any Short" : goal.format === "live" ? "Any stream" : "Any video";
  const tick = async () => {
    try {
      await patchGoal(goal.id, { done_at: goal.done_at ? null : new Date().toISOString() });
      void queryClient.invalidateQueries({ queryKey: growthKeys.goals });
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  return (
    <div className="item" style={{ flexDirection: "column", gap: 8 }}>
      <div className="row between" style={{ width: "100%", gap: 12, alignItems: "flex-start" }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{p.done ? "Reached: " : ""}{goal.title}</div>
          <div className="small muted clip">
            {goal.kind === "video_views" ? (video ? video.title : best ? `${anyOf}. Closest so far: ${best.title}` : anyOf) : goal.kind === "subscribers" ? "Channel subscribers" : goal.notes ?? "A goal of your own"}
            {goal.due_on ? `. By ${day(goal.due_on)}` : ""}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flex: "none" }}>
          {goal.kind === "personal" ? <button type="button" className="btn btn-small" onClick={() => void tick()}>{goal.done_at ? "Not done yet" : "Mark as done"}</button> : null}
          {onEdit ? <button type="button" className="btn btn-small" onClick={onEdit}>Edit</button> : null}
        </div>
      </div>
      {p.share !== null && goal.target !== null ? (
        <>
          <div className="run-track small" role="img" aria-label={`${Math.round(p.share * 100)}% of the way`}>
            {Array.from({ length: 20 }, (_, i) => <i key={i} className={i < Math.round(p.share! * 20) ? "on" : ""} />)}
          </div>
          <div className="row between small" style={{ width: "100%" }}>
            <span><strong className="fig" style={{ fontSize: 15 }}>{whole(p.current)}</strong> <span className="muted">of {whole(goal.target)}</span></span>
            <span className="muted">
              {p.done ? "Done" : `${whole(p.left)} to go${p.eta ? `, around ${day(p.eta)} at the current pace` : ""}`}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Goals() {
  const goals = useGoals();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ctx = useGoalContext();
  const [editing, setEditing] = useState<GoalDraft | null>(null);
  if (goals.isLoading) return <Loading label="Loading your goals" />;
  if (goals.error) return <ErrorNote error={goals.error} retry={() => void goals.refetch()} />;
  const list = goals.data ?? [];
  const open = list.filter((g) => !goalProgress(g, ctx).done);
  const done = list.filter((g) => goalProgress(g, ctx).done);
  return (
    <>
      <div className="row-wrap between" style={{ marginBottom: 14 }}>
        <p className="soft grow" style={{ maxWidth: "70ch", margin: 0 }}>Set a subscriber goal, a view goal for one video, or a goal of your own such as landing a first sponsor.</p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: "subscribers", title: "", start_value: ctx.subscribers })}>New goal</button>
      </div>
      <div className="panel">
        {open.length === 0 ? <div className="empty"><h3>No open goals</h3><p>Add one and it shows on your front page with how far along you are.</p></div>
          : open.map((g) => <GoalRow key={g.id} goal={g} onEdit={() => setEditing(g)} />)}
      </div>
      {done.length ? <Section title="Reached"><div className="panel">{done.map((g) => <GoalRow key={g.id} goal={g} onEdit={() => setEditing(g)} />)}</div></Section> : null}
      {editing ? (
        <GoalEditor
          draft={editing} videos={ctx.videos} subscribers={ctx.subscribers} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: growthKeys.goals }); toast("Goal saved."); }}
        />
      ) : null}
    </>
  );
}

function GoalEditor(props: { draft: GoalDraft; videos: Video[]; subscribers: number | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<GoalDraft>(props.draft);
  const [find, setFind] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) => setForm((f) => ({ ...f, [key]: value }));
  const picked = props.videos.find((v) => v.id === form.video_id);
  // A views goal is for one kind of video; Shorts never count towards a long-form goal.
  const format = form.format ?? "long";
  const best = bestVideo(props.videos, format);
  const KIND = { long: "long-form video", short: "Short", live: "stream" } as const;
  // Within that kind it counts any video unless the owner ties it to one.
  const [oneVideo, setOneVideo] = useState(Boolean(props.draft.video_id));
  const matches = find.trim().length >= 2
    ? props.videos.filter((v) => v.title.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6)
    : [...props.videos].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 5);
  const target = form.target ?? null;
  const auto = form.kind === "subscribers" && target ? `Reach ${whole(target)} subscribers`
    : form.kind === "video_views" && target ? (form.video_id ? `${whole(target)} views on one video` : `A ${KIND[format]} with ${whole(target)} views`) : "";
  const ready = form.kind === "personal" ? form.title.trim() !== "" : Boolean(target && target > 0 && (form.kind !== "video_views" || !oneVideo || form.video_id));
  const save = async () => {
    setSaving(true);
    try {
      const start = form.id ? form.start_value ?? null : form.kind === "subscribers" ? props.subscribers : form.kind === "video_views" ? (oneVideo ? picked?.views : best?.views) ?? null : null;
      await saveGoal({
        ...form, title: form.title.trim() || auto, start_value: start,
        target: form.kind === "personal" ? null : target, video_id: form.kind === "video_views" && oneVideo ? form.video_id ?? null : null,
        format: form.kind === "video_views" && !oneVideo ? format : null,
      });
      props.onSaved();
    } catch (err) {
      toast(message(err), { error: true });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      title={form.id ? "Edit goal" : "New goal"} onClose={props.onClose}
      footer={(
        <>
          {form.id ? <button type="button" className="btn btn-danger" onClick={() => void patchGoal(form.id!, { trashed_at: new Date().toISOString() }).then(props.onSaved, (e) => toast(message(e), { error: true }))}>Move to bin</button> : <span />}
          <button type="button" className="btn btn-primary" disabled={saving || !ready} onClick={() => void save()}>{saving ? "Saving" : "Save goal"}</button>
        </>
      )}
    >
      <div className="field">
        <span>Kind of goal</span>
        <Segmented
          label="Kind of goal" value={form.kind} onChange={(v) => set("kind", v)}
          options={[{ value: "subscribers", label: "Subscribers" }, { value: "video_views", label: "Video views" }, { value: "personal", label: "My own" }]}
        />
      </div>
      {form.kind === "video_views" ? (
        <div className="field">
          <span>Which video</span>
          <Segmented
            label="Which video" value={oneVideo ? "one" : "any"} onChange={(v) => { setOneVideo(v === "one"); if (v === "any") set("video_id", null); }}
            options={[{ value: "any", label: "Any of one kind" }, { value: "one", label: "One video" }]}
          />
          {!oneVideo ? (
            <>
              <Segmented
                label="Kind of video" value={format} onChange={(v) => set("format", v)}
                options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Shorts" }, { value: "live", label: "Streams" }]}
              />
              <small>Reached as soon as any {KIND[format]} gets there, including ones you have not posted yet. Other kinds of video do not count.</small>
            </>
          ) : picked ? (
            <div className="row between" style={{ gap: 10 }}>
              <span className="clip grow" style={{ fontWeight: 600 }}>{picked.title}</span>
              <button type="button" className="btn btn-small" onClick={() => set("video_id", null)}>Change</button>
            </div>
          ) : (
            <>
              <input className="input" type="search" placeholder="Search your titles" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search your titles" />
              <div className="stack" style={{ gap: 4 }}>
                {matches.map((v) => <button key={v.id} type="button" className="btn clip" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => set("video_id", v.id)}>{v.title}</button>)}
              </div>
            </>
          )}
        </div>
      ) : null}
      {form.kind !== "personal" ? (
        <label className="field">
          <span>{form.kind === "subscribers" ? "Subscribers to reach" : "Views to reach"}</span>
          <input className="input" inputMode="numeric" value={target ?? ""} onChange={(e) => set("target", e.target.value.replace(/[^\d]/g, "") === "" ? null : Number(e.target.value.replace(/[^\d]/g, "")))} placeholder={form.kind === "subscribers" ? "5000" : "10000"} />
          <small>
            {form.kind === "subscribers" && props.subscribers !== null ? `You have ${whole(props.subscribers)} now.` : ""}
            {form.kind === "video_views" && oneVideo && picked ? `It has ${whole(picked.views)} now.` : ""}
            {form.kind === "video_views" && !oneVideo ? (best ? `Your best ${KIND[format]} so far has ${whole(best.views)}.` : `No ${KIND[format]} yet.`) : ""}
          </small>
        </label>
      ) : null}
      <label className="field">
        <span>{form.kind === "personal" ? "The goal" : "Name (optional)"}</span>
        <input className="input" value={form.title} maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder={form.kind === "personal" ? "Land my first sponsor" : auto || "Name this goal"} />
      </label>
      <label className="field">
        <span>By when (optional)</span>
        <input className="input" type="date" value={form.due_on ?? ""} onChange={(e) => set("due_on", e.target.value || null)} />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea className="input" rows={3} value={form.notes ?? ""} maxLength={1000} onChange={(e) => set("notes", e.target.value || null)} />
      </label>
    </Drawer>
  );
}

/** Front page: the open goals, at a glance. */
export function GoalsStrip() {
  const goals = useGoals();
  const ctx = useGoalContext();
  const open = (goals.data ?? []).filter((g) => !goalProgress(g, ctx).done).slice(0, 3);
  if (goals.isLoading || goals.error) return null;
  return (
    <Section title="Goals" aside={<a className="small" href="#/goals">{open.length ? "All goals" : "Set a goal"}</a>}>
      <div className="panel">
        {open.length === 0 ? <div className="empty"><p>No goal set. Pick a subscriber number, a view target for one video, or something of your own.</p></div>
          : open.map((g) => <GoalRow key={g.id} goal={g} />)}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

function CommentCard({ comment, video, actions }: { comment: Comment; video?: Video; actions?: ReactNode }) {
  return (
    <div className="item" style={{ flexDirection: "column", gap: 6 }}>
      <div style={{ lineHeight: 1.4, overflowWrap: "anywhere" }}>{comment.text.length > 320 ? `${comment.text.slice(0, 320)}...` : comment.text}</div>
      <div className="row-wrap between small muted" style={{ width: "100%" }}>
        <span className="clip grow">{comment.author ?? "A viewer"}{comment.likes ? `, ${count(comment.likes, "like")}` : ""}{video ? <> on <a href={`#/videos?v=${video.id}`}>{video.title}</a></> : null}</span>
        {actions}
      </div>
    </div>
  );
}

function useCommentActions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (id: string, change: { pinned?: boolean; hidden?: boolean }, done: string) => {
    try {
      await markComment(id, change);
      void queryClient.invalidateQueries({ queryKey: growthKeys.comments });
      toast(done);
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
}

function CommentsOff({ connection }: { connection: { comments?: boolean; ai?: boolean; youtube_connected: boolean } | undefined }) {
  if (!connection) return null;
  if (!connection.youtube_connected || !connection.comments) {
    return (
      <div className="notice">
        <span className="grow">Comments are not switched on. In Settings, disconnect and sign in with Google again, leaving the comments box ticked.</span>
        <a className="btn btn-small" href="#/settings">Open settings</a>
      </div>
    );
  }
  if (!connection.ai) {
    return (
      <div className="notice">
        <span className="grow">Comments are loading, but sorting them into positive ones and themes needs your Claude API key.</span>
        <a className="btn btn-small" href="#/settings">Add the key</a>
      </div>
    );
  }
  return null;
}

export function Comments() {
  const comments = useComments();
  const videos = useVideos();
  const connection = useConnection();
  const act = useCommentActions();
  const [view, setView] = useState<"themes" | "positive" | "questions" | "all">("themes");
  const [theme, setTheme] = useState<string | null>(null);
  const byId = useMemo(() => new Map((videos.data ?? []).map((v) => [v.id, v])), [videos.data]);
  const list = comments.data ?? [];
  const grouped = useMemo(() => themes(list), [list]);
  if (comments.isLoading) return <Loading label="Loading comments" />;
  if (comments.error) return <ErrorNote error={comments.error} retry={() => void comments.refetch()} />;
  const read = list.filter((c) => c.sentiment !== null);
  const shown = theme ? list.filter((c) => c.theme === theme)
    : view === "positive" ? list.filter((c) => c.sentiment === "positive")
      : view === "questions" ? list.filter((c) => c.is_question) : list;
  const actions = (c: Comment) => (
    <span className="row" style={{ gap: 6, flex: "none" }}>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => void act(c.id, { pinned: !c.pinned, hidden: false }, c.pinned ? "Taken off your front page." : "Pinned to your front page.")}>{c.pinned ? "Unpin" : "Pin to front page"}</button>
    </span>
  );
  return (
    <>
      <CommentsOff connection={connection.data} />
      {list.length === 0 ? (
        <div className="panel"><div className="empty"><h3>No comments loaded yet</h3><p>Once comments are switched on, the newest ones load with each sync.</p></div></div>
      ) : (
        <>
          <p className="soft" style={{ maxWidth: "70ch", marginBottom: 12 }}>
            {whole(list.length)} recent comments{read.length ? `: ${whole(read.filter((c) => c.sentiment === "positive").length)} positive, ${whole(read.filter((c) => c.sentiment === "negative").length)} negative, ${whole(read.filter((c) => c.is_question).length)} asking you something` : ""}.
          </p>
          <div style={{ marginBottom: 12 }}>
            <Segmented
              label="Show" value={view} onChange={(v) => { setView(v); setTheme(null); }}
              options={[{ value: "themes", label: "Themes" }, { value: "positive", label: "Positive" }, { value: "questions", label: "Questions" }, { value: "all", label: "All" }]}
            />
          </div>
          {view === "themes" && !theme ? (
            <div className="panel">
              {grouped.length === 0 ? <div className="empty"><p>Themes appear once the AI has read the comments, on the next sync.</p></div> : grouped.slice(0, 30).map((g) => (
                <button type="button" className="item" key={g.theme} onClick={() => setTheme(g.theme)}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="title">{g.theme}</span>
                    <span className="meta clip" style={{ display: "block" }}>"{g.sample.text.slice(0, 110)}"</span>
                  </span>
                  <span style={{ textAlign: "right", flex: "none" }}>
                    <span className="fig" style={{ fontSize: 18, display: "block" }}>{whole(g.count)}</span>
                    <span className="small muted">{g.questions ? `${g.questions} asking` : g.negative > g.positive ? "mostly negative" : g.positive ? "mostly positive" : "mixed"}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {theme ? <div className="row-wrap" style={{ marginBottom: 10 }}><strong>{theme}</strong><button type="button" className="btn btn-small" onClick={() => setTheme(null)}>Back to all themes</button></div> : null}
              <div className="panel">
                {shown.length === 0 ? <div className="empty"><p>Nothing here yet.</p></div>
                  : shown.slice(0, 80).map((c) => <CommentCard key={c.id} comment={c} video={c.video_id ? byId.get(c.video_id) : undefined} actions={actions(c)} />)}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Front page: only the kind ones. */
export function KindWords() {
  const comments = useComments();
  const videos = useVideos();
  const act = useCommentActions();
  const byId = useMemo(() => new Map((videos.data ?? []).map((v) => [v.id, v])), [videos.data]);
  const best = useMemo(() => kindWords(comments.data ?? []), [comments.data]);
  if (comments.isLoading || comments.error) return null;
  if (best.length === 0) {
    // Nothing is shown here until the owner picks it.
    return (comments.data ?? []).length === 0 ? null : (
      <Section title="Kind words" aside={<a className="small" href="#/comments">All comments</a>}>
        <div className="panel"><p className="small muted" style={{ padding: "14px 18px", margin: 0 }}>Only comments you pin show here. Open All comments and tap Pin to front page on the ones you want to keep.</p></div>
      </Section>
    );
  }
  return (
    <Section title="Kind words" aside={<a className="small" href="#/comments">All comments</a>}>
      <div className="panel">
        {best.map((c) => (
          <CommentCard
            key={c.id} comment={c} video={c.video_id ? byId.get(c.video_id) : undefined}
            actions={<button type="button" className="btn btn-quiet btn-small" onClick={() => void act(c.id, { pinned: false }, "Taken off your front page.")}>Unpin</button>}
          />
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Upload planner
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Planner() {
  const ideas = useIdeas();
  const videos = useVideos();
  const queryClient = useQueryClient();
  const toast = useToast();
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picking, setPicking] = useState<string | null>(null);
  const all = ideas.data ?? [];
  const weeks = useMemo(() => planMonth(month, all, videos.data ?? []), [month, all, videos.data]);
  const gaps = useMemo(() => emptyWeeks(all, today), [all, today]);
  const unplanned = all.filter((i) => !i.target_date && i.status !== "published");
  if (ideas.isLoading) return <Loading label="Loading your plan" />;
  if (ideas.error) return <ErrorNote error={ideas.error} retry={() => void ideas.refetch()} />;
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };
  const plan = async (id: string, date: string | null) => {
    const idea = all.find((i) => i.id === id);
    if (!idea) return;
    try {
      await saveIdea({ ...idea, target_date: date });
      void queryClient.invalidateQueries({ queryKey: keys.ideas });
      setPicking(null);
      toast(date ? `Planned for ${day(date)}.` : "Taken off the plan.");
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <div className="row-wrap between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{label}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-small" onClick={() => shift(-1)}>Earlier</button>
          <button type="button" className="btn btn-small" onClick={() => setMonth(today.slice(0, 7))}>This month</button>
          <button type="button" className="btn btn-small" onClick={() => shift(1)}>Later</button>
        </div>
      </div>
      {gaps.length ? (
        <div className="notice plain">
          <span className="grow">
            Nothing is planned for {gaps.length === 1 ? "the week" : "the weeks"} of {gaps.slice(0, 4).map((g) => day(g)).join(", ")}{gaps.length > 4 ? " and later" : ""}.
          </span>
        </div>
      ) : null}
      <div className="panel planner" role="grid" aria-label={`Plan for ${label}`}>
        <div className="planner-row planner-head" role="row">{WEEKDAYS.map((d) => <div key={d} role="columnheader">{d}</div>)}</div>
        {weeks.map((week) => (
          <div className="planner-row" role="row" key={week[0].date}>
            {week.map((d) => (
              <div
                key={d.date} role="gridcell" className={`planner-day${d.inMonth ? "" : " out"}${d.date === today ? " today" : ""}`}
                onClick={() => { if (d.date >= today) setPicking(d.date); }}
              >
                <div className="planner-date">{Number(d.date.slice(8))}</div>
                {d.uploads.map((v) => <a key={v.id} className={`planner-chip up ${v.content_type ?? ""}`} href={`#/videos?v=${v.id}`} onClick={(e) => e.stopPropagation()} title={v.title}>{v.title}</a>)}
                {d.streams ? <span className="planner-chip up live">{count(d.streams, "stream")}</span> : null}
                {d.ideas.map((i) => <button key={i.id} type="button" className={`planner-chip ${i.format}`} title={i.title} onClick={(e) => { e.stopPropagation(); navigate(`/ideas?edit=${i.id}`); }}>{i.title}</button>)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Filled chips are videos that went up. Outlined chips are ideas with a date. Tap a day from today on to plan something for it.</p>

      {picking ? (
        <Drawer title={`Plan for ${day(picking)}`} onClose={() => setPicking(null)}>
          {all.filter((i) => i.target_date === picking && i.status !== "published").map((i) => (
            <div className="row between" key={i.id} style={{ gap: 10 }}>
              <span className="clip grow" style={{ fontWeight: 600 }}>{i.title}</span>
              <button type="button" className="btn btn-small" onClick={() => void plan(i.id, null)}>Take off this day</button>
            </div>
          ))}
          <div className="field">
            <span>Ideas without a date</span>
            {unplanned.length === 0 ? <small>Every idea already has a date. Add a new one on the Ideas board.</small> : (
              <div className="stack" style={{ gap: 4 }}>
                {unplanned.slice(0, 30).map((i) => (
                  <button key={i.id} type="button" className="btn clip" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => void plan(i.id, picking)}>
                    {i.format === "short" ? "Short: " : ""}{i.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Front page: the run so far, and where to go next
// ---------------------------------------------------------------------------

const LADDER = [100, 250, 500, 1000, 2000, 3000, 4000, 5000, 7500, 10_000, 15_000, 20_000, 25_000, 50_000, 75_000, 100_000, 150_000, 250_000, 500_000, 1_000_000];

/** The stretch of road the channel is on: from the last round number passed to the next one, or to the owner's own subscriber goal. */
export function RunBand() {
  const channel = useChannel();
  const goals = useGoals();
  const daily = useDaily();
  const subs = channel.data?.subscribers;
  if (subs === null || subs === undefined) return null;
  const own = (goals.data ?? []).filter((g) => g.kind === "subscribers" && g.target !== null && !g.done_at && g.target > subs).sort((a, b) => (a.target ?? 0) - (b.target ?? 0))[0];
  const next = own?.target ?? LADDER.find((n) => n > subs) ?? Math.ceil((subs + 1) / 1_000_000) * 1_000_000;
  const from = own ? Math.min(own.start_value ?? 0, subs) : [...LADDER].reverse().find((n) => n <= subs) ?? 0;
  const share = next > from ? Math.max(0, Math.min(1, (subs - from) / (next - from))) : 1;
  const recent = (daily.data ?? []).slice(-28);
  const perDay = recent.length ? recent.reduce((t, d) => t + d.subs_gained - d.subs_lost, 0) / recent.length : 0;
  const left = next - subs;
  const eta = perDay > 0 && left / perDay < 3650 ? new Date(Date.now() + Math.ceil(left / perDay) * 86_400_000).toISOString().slice(0, 10) : null;
  const cells = 20;
  const lit = Math.round(share * cells);
  return (
    <div className="run-band">
      <div className="row between" style={{ alignItems: "flex-end", gap: 12 }}>
        <div>
          <div className="run-count fig">{whole(subs)}</div>
          <div className="run-sub">subscribers</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="run-next fig">{compact(next)}</div>
          <div className="run-sub">{own ? "your goal" : "next milestone"}</div>
        </div>
      </div>
      <div className="run-track" role="img" aria-label={`${Math.round(share * 100)}% of the way from ${whole(from)} to ${whole(next)} subscribers`}>
        {Array.from({ length: cells }, (_, i) => <i key={i} className={i < lit ? "on" : ""} style={{ animationDelay: `${i * 35}ms` }} />)}
      </div>
      <div className="run-sub" style={{ marginTop: 8 }}>
        {whole(left)} to go{eta ? `. Around ${day(eta)} at the pace of the last four weeks` : perDay <= 0 && recent.length ? ". Subscribers have been flat or falling these four weeks" : ""}.
      </div>
    </div>
  );
}

function Tile(props: { href: string; label: string; figure: string; line: string; hue: string; children?: ReactNode }) {
  return (
    <a className="tile" href={props.href} style={{ ["--hue" as string]: props.hue }}>
      <span className="tile-label">{props.label}</span>
      <span className="tile-figure fig">{props.figure}</span>
      <span className="tile-line">{props.line}</span>
      {props.children ? <span className="tile-art" aria-hidden="true">{props.children}</span> : null}
    </a>
  );
}

const Bars = ({ values }: { values: number[] }) => {
  const max = Math.max(...values, 1);
  return <svg viewBox="0 0 60 28" width="60" height="28">{values.slice(0, 6).map((v, i) => <rect key={i} x={i * 10} y={28 - Math.max(2, (26 * v) / max)} width="7" height={Math.max(2, (26 * v) / max)} rx="1.5" fill="currentColor" />)}</svg>;
};
const Ring = ({ share }: { share: number }) => (
  <svg viewBox="0 0 32 32" width="32" height="32">
    <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="5" />
    <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${Math.max(0.5, share * 75.4)} 75.4`} transform="rotate(-90 16 16)" />
  </svg>
);

/** Every part of the dashboard as a tile that already shows its headline. */
export function Hub() {
  const videos = useVideos();
  const daily = useDaily();
  const goals = useGoals();
  const tests = useTests();
  const comments = useComments();
  const ideas = useIdeas();
  const channel = useChannel();
  const today = todayIso();
  const all = videos.data ?? [];
  const months = monthsWithData(daily.data ?? []);
  const lastDone = months.find((m) => m < today.slice(0, 7)) ?? months[0];
  const rec = lastDone ? recap(lastDone, daily.data ?? [], all, today) : null;
  const ctx = { subscribers: channel.data?.subscribers ?? null, videos: all, daily: daily.data ?? [], today };
  const open = (goals.data ?? []).map((g) => ({ g, p: goalProgress(g, ctx) })).filter((x) => !x.p.done);
  const nearest = open.filter((x) => x.p.share !== null).sort((a, b) => (b.p.share ?? 0) - (a.p.share ?? 0))[0];
  const games = byTopic(all, "long").filter((r) => r.videos >= 2 && r.retention !== null).sort((a, b) => (b.retention ?? 0) - (a.retention ?? 0));
  const funnel = shortsFunnel(all);
  const running = (tests.data ?? []).filter((t) => !t.ended_on || t.ended_on >= today).length;
  const kind = (comments.data ?? []).filter((c) => c.sentiment === "positive").length;
  const planned = (ideas.data ?? []).filter((i) => i.target_date && i.target_date >= today && i.status !== "published").sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""))[0];
  const ideaCount = (ideas.data ?? []).filter((i) => i.status !== "published").length;
  return (
    <nav className="hub" aria-label="Jump to">
      <Tile href="#/recap" hue="var(--s-short)" label="Monthly recap" figure={rec ? compact(rec.views) : "–"} line={rec ? `views in ${rec.label.split(" ")[0]}` : "No full month yet"}>
        <Bars values={months.slice(0, 6).reverse().map((m) => (daily.data ?? []).filter((d) => d.date.startsWith(m)).reduce((t, d) => t + d.views, 0))} />
      </Tile>
      <Tile href="#/goals" hue="#c79a00" label="Goals" figure={nearest ? `${Math.round((nearest.p.share ?? 0) * 100)}%` : String(open.length)} line={nearest ? nearest.g.title : open.length ? count(open.length, "open goal") : "Set your first goal"}>
        {nearest ? <Ring share={nearest.p.share ?? 0} /> : null}
      </Tile>
      <Tile href="#/videos/games" hue="var(--s-long)" label="By game" figure={games[0] ? percent(games[0].retention) : "–"} line={games[0] ? `${games[0].topic} holds viewers best` : "Sorted after the next sync"}>
        <Bars values={games.slice(0, 6).map((g) => g.retention ?? 0)} />
      </Tile>
      <Tile href="#/videos/funnel" hue="var(--s-live)" label="Shorts to long" figure={funnel.measured ? compact(funnel.fromShorts) : "–"} line={funnel.measured ? "views sent on by your Shorts" : "Measured after the next sync"} />
      <Tile href="#/videos/tests" hue="#8b5cf6" label="Tests" figure={String(running)} line={running === 1 ? "test running" : running ? "tests running" : "Log your next thumbnail change"} />
      <Tile href="#/comments" hue="#e0528a" label="Comments" figure={kind ? whole(kind) : "–"} line={kind ? "kind comments lately" : "Switch comments on in Settings"} />
      <Tile href="#/ideas/planner" hue="var(--s-short)" label="Planner" figure={planned?.target_date ? day(planned.target_date) : "–"} line={planned ? planned.title : "Nothing planned yet"} />
      <Tile href="#/research" hue="var(--s-long)" label="Research" figure={String(ideaCount)} line={ideaCount === 1 ? "idea on your board. Find the next one" : "ideas on your board. Find the next one"} />
    </nav>
  );
}
