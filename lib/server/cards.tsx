// Share images for a member: the weekly recap card (1080x1350, made for posting) and a link preview.

import { ImageResponse } from "next/og";
import { palette } from "@/lib/shared/theme";
import type { Facts, Metric, PublicUser } from "@/lib/shared/types";
import { firstName, num, withUnit } from "@/lib/shared/format";
import type { ChallengeRow } from "./domain/challenges";
import { initials, ogFonts, ogIcon, ogMascot, ogScene } from "./og";

const AVATAR: Record<string, [string, string]> = {
  sky: ["#D3E6F9", "#2C6FB3"],
  mint: ["#D7EFD3", "#2E8B52"],
  peach: ["#FFD9C9", "#C2502F"],
  lilac: ["#E2D9F6", "#674EB2"],
  sand: ["#F6E2C3", "#9A6418"],
  rose: ["#F9D9E3", "#B0425F"],
};

function weekHeadline(f: Facts, m: Metric): { big: string; small: string } {
  if (m.aggregation === "days") return { big: `${f.this_week}/7`, small: "days this week" };
  if (m.aggregation === "latest") return { big: withUnit(f.total, m.unit), small: `${f.this_week} sessions this week` };
  if (m.aggregation === "distinct") return { big: num(f.this_week), small: `new ${m.name} this week` };
  return { big: withUnit(f.this_week, m.unit), small: "this week" };
}

function Tile({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "flex-start", background: "#fff", borderRadius: 32, padding: "26px 28px", border: "2px solid #EFE5D8" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ogIcon(icon)} alt="" width={64} height={64} />
      <div style={{ display: "flex", marginTop: 14, fontFamily: "Fredoka", fontSize: 50, color: "#2E2A26" }}>{value}</div>
      <div style={{ display: "flex", marginTop: 2, fontSize: 24, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: "#A1978C" }}>{label}</div>
    </div>
  );
}

export function weeklyCard(c: ChallengeRow, user: PublicUser, f: Facts, m: Metric) {
  const pal = palette(c.theme);
  const [abg, afg] = AVATAR[user.avatar] ?? AVATAR.sky;
  const head = weekHeadline(f, m);
  const pct = f.progress != null ? Math.round(f.progress * 100) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: pal.tint, fontFamily: "Nunito", position: "relative" }}>
        <div style={{ display: "flex", position: "relative", height: 470, overflow: "hidden", borderBottomLeftRadius: 56, borderBottomRightRadius: 56 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ogScene(c.theme)} alt="" width={1080} height={608} style={{ position: "absolute", top: -40, left: 0, width: 1080, height: 608, objectFit: "cover" }} />
          <div style={{ display: "flex", position: "absolute", top: 48, left: 56, padding: "12px 24px", borderRadius: 999, background: "rgba(255,255,255,0.92)", fontSize: 28, fontWeight: 800, color: "#2E2A26" }}>
            My week on Misogi
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "0 56px", marginTop: -110 }}>
          <div style={{ display: "flex", flexDirection: "column", background: "#FFF8EF", borderRadius: 48, padding: "40px 44px", boxShadow: "0 30px 60px -30px rgba(46,42,38,0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div style={{ display: "flex", width: 96, height: 96, borderRadius: 999, background: abg, color: afg, alignItems: "center", justifyContent: "center", fontFamily: "Fredoka", fontSize: 40 }}>
                {initials(user.display_name)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ display: "flex", fontFamily: "Fredoka", fontSize: 44, color: "#2E2A26" }}>{firstName(user.display_name)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 800, color: pal.deep }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ogIcon(c.emoji)} alt="" width={38} height={38} />
                  {c.title.length > 38 ? `${c.title.slice(0, 37)}…` : c.title}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginTop: 34 }}>
              <div style={{ display: "flex", fontFamily: "Fredoka", fontSize: 128, lineHeight: 1, color: "#2E2A26" }}>{head.big}</div>
              <div style={{ display: "flex", marginBottom: 18, fontSize: 34, fontWeight: 800, color: "#6B635B" }}>{head.small}</div>
            </div>
            {pct != null ? (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, fontWeight: 800, color: "#6B635B" }}>
                  <span>{pct}% to the summit</span>
                  <span>
                    {withUnit(f.total, m.unit)} / {withUnit(f.target, m.unit)}
                  </span>
                </div>
                <div style={{ display: "flex", marginTop: 12, height: 30, borderRadius: 999, background: "#EFE5D8", overflow: "hidden" }}>
                  <div style={{ display: "flex", width: `${Math.max(4, pct)}%`, height: "100%", borderRadius: 999, background: pal.accent }} />
                </div>
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 28 }}>
            <Tile icon="streak" value={String(f.streak)} label="day streak" />
            <Tile icon="xp" value={`Lv ${f.level}`} label={`${f.xp} xp`} />
            <Tile icon="camp" value={`${f.milestones_done}/${f.milestones_total}`} label="camps" />
          </div>
        </div>
        <div style={{ display: "flex", position: "absolute", left: 56, right: 56, bottom: 48, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#6B635B" }}>
              Day {f.day} of {f.days_total}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontFamily: "Fredoka", fontSize: 40, color: "#2E2A26" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ogIcon("summit")} alt="" width={50} height={50} />
              What&apos;s your misogi?
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ogMascot("cheer")} alt="" width={210} height={210} />
        </div>
      </div>
    ),
    { width: 1080, height: 1350, fonts: ogFonts(), headers: { "Cache-Control": "public, max-age=300" } },
  );
}
