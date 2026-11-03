import crypto from "node:crypto";
import { queueCover } from "@/lib/server/covers";
import { getUser } from "@/lib/server/domain/users";
import { errorJson, json } from "@/lib/server/http";
import { heroSpaces, seedDemo, seededChallenges } from "@/lib/server/seed";
import { requestSpace, spaceStatus } from "@/lib/server/spaces";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return process.env.NODE_ENV !== "production";
  const given = req.headers.get("x-admin-key") ?? "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Seeds the demo data. Body: { force?: boolean, covers?: boolean, spaces?: boolean }.
 * covers: queue a cover image for every seeded challenge that doesn't have one yet.
 * spaces: build the shared page for each live demo challenge that doesn't have one yet.
 * redesign: [{ slug, request }] asks for a new version of a demo challenge's page, built on the current one.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: { code: "unauthorized", message: "Missing or wrong x-admin-key." } }, { status: 401 });
  try {
    let body: { force?: unknown; covers?: unknown; spaces?: unknown; redesign?: unknown } = {};
    const text = await req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: { code: "invalid", message: "Body must be JSON." } }, { status: 400 });
      }
    }
    const seed = seedDemo({ force: body.force === true });

    const covers = { queued: [] as string[], already: 0 };
    if (body.covers === true) {
      for (const c of seededChallenges()) {
        if (c.cover_path) covers.already++;
        else {
          queueCover(c.id);
          covers.queued.push(c.slug);
        }
      }
    }

    const spaces: { slug: string; status: string; version_id?: string; error?: string }[] = [];
    if (body.spaces === true) {
      for (const h of heroSpaces()) {
        const s = spaceStatus(h.challengeId, "");
        if (s.current) spaces.push({ slug: h.slug, status: "exists", version_id: s.current.id });
        else if (s.pending) spaces.push({ slug: h.slug, status: s.pending.status, version_id: s.pending.id });
        else {
          try {
            const r = requestSpace(getUser(h.creatorId), h.slug, "challenge", h.request, "system");
            spaces.push({ slug: h.slug, status: r.status, version_id: r.version_id });
          } catch (e) {
            spaces.push({ slug: h.slug, status: "error", error: e instanceof AppError ? e.message : String(e) });
          }
        }
      }
    }

    const redesigned: { slug: string; status: string; version_id?: string; error?: string }[] = [];
    if (Array.isArray(body.redesign)) {
      const heroes = heroSpaces();
      for (const item of body.redesign as { slug?: unknown; request?: unknown }[]) {
        const h = heroes.find((x) => x.slug === item?.slug);
        const request = typeof item?.request === "string" ? item.request.trim() : "";
        if (!h || request.length < 10) {
          redesigned.push({ slug: String(item?.slug), status: "error", error: "Unknown demo challenge or request too short." });
          continue;
        }
        try {
          const r = requestSpace(getUser(h.creatorId), h.slug, "challenge", request, "system");
          redesigned.push({ slug: h.slug, status: r.status, version_id: r.version_id });
        } catch (e) {
          redesigned.push({ slug: h.slug, status: "error", error: e instanceof AppError ? e.message : String(e) });
        }
      }
    }

    return json({
      ...seed,
      covers: body.covers === true ? covers : null,
      spaces: body.spaces === true ? spaces : null,
      redesigned: Array.isArray(body.redesign) ? redesigned : null,
    });
  } catch (e) {
    return errorJson(e);
  }
}
