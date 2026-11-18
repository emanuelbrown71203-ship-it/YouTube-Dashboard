import { Meter } from "../components/ui.tsx";
import { whole } from "../lib/format.ts";
import { useConnection, useQuota } from "../lib/hooks.ts";
import { useRoute } from "../lib/router.ts";
import { ResearchChannels } from "./ResearchChannels.tsx";
import { ResearchKeywords } from "./ResearchKeywords.tsx";
import { ResearchOutliers } from "./ResearchOutliers.tsx";
import { Thumbnails } from "./Thumbnails.tsx";

export const DAILY_BUDGET = 10_000;

const TABS = [
  { key: "outliers", label: "Outliers", about: "Videos that beat their own channel's usual by a wide margin. They show what YouTube is recommending in your niche right now." },
  { key: "thumbnails", label: "Thumbnails", about: "Thumbnails that are working right now, on your games and on others. Open one to keep it with an idea, or start a new idea from it." },
  { key: "keywords", label: "Search phrases", about: "What people type into YouTube search, and how hard each phrase is to rank for at your size." },
  { key: "channels", label: "Channels", about: "Channels you want to keep an eye on, measured the same way as your own." },
];

export function Research() {
  const route = useRoute();
  const connection = useConnection();
  const quota = useQuota();
  const tab = TABS.find((t) => t.key === route.segments[1]) ?? TABS[0];
  const connected = connection.data?.youtube_connected === true;
  const used = quota.data ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Research</h1>
        <div style={{ minWidth: 220 }}>
          <div className="row between small soft" style={{ marginBottom: 5 }}>
            <span>Free lookups used today</span>
            <span><strong className="fig" style={{ color: "var(--ink)", fontSize: 15 }}>{whole(used)}</strong> of {whole(DAILY_BUDGET)}</span>
          </div>
          <Meter value={used} max={DAILY_BUDGET} label="Free YouTube lookups used today" />
        </div>
      </div>

      <nav className="row-wrap" aria-label="Research tools" style={{ marginBottom: 8 }}>
        {TABS.map((t) => (
          <a key={t.key} className="chip" aria-current={t.key === tab.key ? "page" : undefined} href={`#/research/${t.key}`} style={{ textDecoration: "none", padding: "7px 14px", fontSize: 14 }}>
            {t.label}
          </a>
        ))}
      </nav>
      <p className="soft" style={{ maxWidth: "70ch", marginBottom: 20 }}>{tab.about}</p>

      {connection.data && !connected ? (
        <div className="notice">
          <span className="grow">
            Research reads YouTube's public data through your Google connection, which is free.
            {tab.key === "keywords" ? " Until it is connected you can list phrases, but not score them." : " Connect YouTube to use it."}
          </span>
          <a className="btn btn-small" href="#/settings">Connect YouTube</a>
        </div>
      ) : null}

      {tab.key === "outliers" ? <ResearchOutliers connected={connected} initial={route.query.get("q") ?? ""} initialFormat={route.query.get("format") === "short" ? "short" : "long"} />
        : tab.key === "thumbnails" ? <Thumbnails connected={connected} />
        : tab.key === "keywords" ? <ResearchKeywords connected={connected} initial={route.query.get("q") ?? ""} />
        : <ResearchChannels connected={connected} />}
    </>
  );
}
