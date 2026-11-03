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
  const found = findChallenge(slug);
  const c = found && found.status !== "draft" ? found : null;
  const u = getUserByHandle(handle);
  const m = c && u ? getMembership(c.id, u.id) : null;
  const f = c && m ? memberFacts(c, m) : null;
  const theme = c?.theme ?? "teal";
  const pal = palette(theme);
  const metric = c ? metricOf(c) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Nunito", background: pal.sky }}>
        <img src={ogScene(theme)} alt="" width={1200} height={675} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 675, objectFit: "cover" }} />
        <div style={{ position: "absolute", left: 56, top: 64, bottom: 64, width: 720, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#FFF8EF", borderRadius: 40, padding: "44px 48px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 800, color: pal.deep }}>
              <img src={ogIcon(c?.emoji ?? "summit")} alt="" width={48} height={48} />
              {c?.title ?? "Misogi"}
            </div>
            <div style={{ display: "flex", marginTop: 18, fontFamily: "Fredoka", fontSize: 64, color: "#2E2A26" }}>{u ? `${firstName(u.display_name)}'s climb` : "A climb"}</div>
            {f ? (
              <div style={{ display: "flex", gap: 14, marginTop: 28 }}>
                {f.streak > 0 ? <Chip icon="streak" text={`${f.streak} day streak`} /> : null}
                <Chip icon="calendar" text={`Day ${f.day} of ${f.days_total}`} />
              </div>
            ) : null}
          </div>
          {f && metric ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                <span style={{ fontFamily: "Fredoka", fontSize: 56, lineHeight: 1, color: "#2E2A26" }}>{withUnit(f.total, metric.unit)}</span>
                <span style={{ fontSize: 28, fontWeight: 800, color: "#6B635B", paddingBottom: 4 }}>{f.target != null ? `of ${withUnit(f.target, metric.unit)}` : "so far"}</span>
              </div>
              {f.progress != null ? (
                <div style={{ display: "flex", marginTop: 20, height: 26, borderRadius: 999, background: "#EFE5D8", overflow: "hidden" }}>
                  <div style={{ display: "flex", width: `${Math.max(4, Math.round(f.progress * 100))}%`, height: "100%", borderRadius: 999, background: pal.accent }} />
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: "flex", fontFamily: "Fredoka", fontSize: 34, color: "#2E2A26" }}>misogi</div>
          )}
        </div>
        <img src={ogMascot("climb")} alt="" width={300} height={300} style={{ position: "absolute", right: 70, bottom: 30 }} />
      </div>
    ),
    { ...size, fonts: ogFonts() },
  );
}

function Chip({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 20px 8px 12px", borderRadius: 999, background: "#fff", border: "2px solid #EFE5D8", fontSize: 26, fontWeight: 800, color: "#6B635B" }}>
      <img src={ogIcon(icon)} alt="" width={36} height={36} />
      {text}
    </div>
  );
}
