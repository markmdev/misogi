import { ImageResponse } from "next/og";
import { findChallenge, getMembership, metricOf } from "@/lib/server/domain/challenges";
import { memberFacts } from "@/lib/server/domain/progress";
import { getUserByHandle } from "@/lib/server/domain/users";
import { ogFonts, ogIcon, ogMascot, ogScene } from "@/lib/server/og";
import { firstName, withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";

export const alt = "A climb on Misogi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ slug: string; handle: string }> }) {
  const { slug, handle } = await params;
  const c = findChallenge(slug);
  const u = getUserByHandle(handle);
  const m = c && u ? getMembership(c.id, u.id) : null;
  const f = c && m ? memberFacts(c, m) : null;
  const theme = c?.theme ?? "teal";
  const pal = palette(theme);
  const metric = c ? metricOf(c) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Nunito", background: pal.sky }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ogScene(theme)} alt="" width={1200} height={675} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 675, objectFit: "cover" }} />
        <div style={{ position: "absolute", left: 56, top: 64, bottom: 64, width: 720, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#FFF8EF", borderRadius: 40, padding: "44px 48px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 800, color: pal.deep }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ogIcon(c?.emoji ?? "summit")} alt="" width={48} height={48} />
              {c?.title ?? "Misogi"}
            </div>
            <div style={{ display: "flex", marginTop: 18, fontFamily: "Fredoka", fontSize: 64, color: "#2E2A26" }}>{u ? `${firstName(u.display_name)}'s climb` : "A climb"}</div>
            {f && metric ? (
              <div style={{ display: "flex", gap: 28, marginTop: 26, fontSize: 30, fontWeight: 800, color: "#6B635B" }}>
                <span>{withUnit(f.total, metric.unit)}{f.target != null ? ` of ${withUnit(f.target, metric.unit)}` : ""}</span>
                <span>{f.streak} day streak</span>
                <span>Day {f.day}</span>
              </div>
            ) : null}
          </div>
          {f && f.progress != null ? (
            <div style={{ display: "flex", height: 26, borderRadius: 999, background: "#EFE5D8", overflow: "hidden" }}>
              <div style={{ display: "flex", width: `${Math.max(4, Math.round(f.progress * 100))}%`, height: "100%", borderRadius: 999, background: pal.accent }} />
            </div>
          ) : (
            <div style={{ display: "flex", fontFamily: "Fredoka", fontSize: 34, color: "#2E2A26" }}>misogi</div>
          )}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ogMascot("climb")} alt="" width={300} height={300} style={{ position: "absolute", right: 70, bottom: 30 }} />
      </div>
    ),
    { ...size, fonts: ogFonts() },
  );
}
