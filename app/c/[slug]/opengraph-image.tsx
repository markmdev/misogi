import { ImageResponse } from "next/og";
import { findChallenge, summarize } from "@/lib/server/domain/challenges";
import { ogFonts, ogIcon, ogMascot, ogScene } from "@/lib/server/og";
import { metricLine } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";

export const alt = "A challenge on Misogi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = findChallenge(slug);
  const c = found && found.status !== "draft" ? found : null;
  const theme = c?.theme ?? "teal";
  const pal = palette(theme);
  const s = c ? summarize(c) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: pal.sky, fontFamily: "Nunito" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ogScene(theme)} alt="" width={1200} height={675} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 675, objectFit: "cover" }} />
        <div
          style={{
            position: "absolute",
            left: 56,
            top: 64,
            bottom: 64,
            width: 700,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "#FFF8EF",
            borderRadius: 40,
            padding: "44px 48px",
            boxShadow: "0 30px 60px -30px rgba(46,42,38,0.45)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ display: "flex", width: 92, height: 92, borderRadius: 26, background: pal.tint, alignItems: "center", justifyContent: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ogIcon(c?.emoji ?? "summit")} alt="" width={70} height={70} />
              </div>
              <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: pal.tint, color: pal.deep, fontSize: 26, fontWeight: 800 }}>
                {s ? (s.status === "template" ? `${s.template_label} · ${s.template_year}` : metricLine(s.metric)) : "Misogi"}
              </div>
            </div>
            <div style={{ display: "flex", marginTop: 28, fontFamily: "Fredoka", fontSize: c && c.title.length > 34 ? 56 : 66, lineHeight: 1.08, color: "#2E2A26" }}>
              {c?.title ?? "One hard thing this year"}
            </div>
            {c?.tagline ? <div style={{ display: "flex", marginTop: 16, fontSize: 28, lineHeight: 1.35, color: "#6B635B" }}>{c.tagline.slice(0, 110)}</div> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#6B635B" }}>
              {s && s.status !== "template" ? `${s.members} climbing · join on Misogi` : "Start it on Misogi"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "Fredoka", fontSize: 34, color: "#2E2A26" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ogIcon("summit")} alt="" width={44} height={44} />
              misogi
            </div>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ogMascot("flag")} alt="" width={300} height={300} style={{ position: "absolute", right: 70, bottom: 30 }} />
      </div>
    ),
    { ...size, fonts: ogFonts() },
  );
}
