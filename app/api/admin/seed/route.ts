import { queueCover } from "@/lib/server/covers";
import { findChallenge } from "@/lib/server/domain/challenges";
import { getUser } from "@/lib/server/domain/users";
import { adminAuthorized, errorJson, json } from "@/lib/server/http";
import { demoSpaces, seedDemo, seededChallenges } from "@/lib/server/seed";
import { ownerKeyFor, requestSpace, spaceStatus } from "@/lib/server/spaces";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";


/**
 * Seeds the demo data. Body: { force?: boolean, covers?: boolean | string[], spaces?: boolean }.
 * covers: queue a cover image for every seeded challenge that doesn't have one yet; or, given a list of challenge slugs, draw a new cover for each (the old file stays).
 * spaces: build each live demo challenge's shared page, and each demo member page the seed asks for, that doesn't have one yet.
 * redesign: [{ slug, request }] asks for a new version of a demo page, built on the current one; slug is "challenge" or "challenge/handle".
 */
export async function POST(req: Request) {
  if (!adminAuthorized(req)) return json({ error: { code: "unauthorized", message: "Missing or wrong x-admin-key." } }, { status: 401 });
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
    } else if (Array.isArray(body.covers)) {
      for (const slug of body.covers) {
        const c = typeof slug === "string" ? findChallenge(slug) : null;
        if (!c) throw new AppError("not_found", `No challenge "${String(slug)}".`);
        queueCover(c.id);
        covers.queued.push(c.slug);
      }
    }

    const spaces: { slug: string; status: string; version_id?: string; error?: string }[] = [];
    if (body.spaces === true) {
      for (const h of demoSpaces()) {
        const s = spaceStatus(h.challengeId, ownerKeyFor(h.target, h.ownerId));
        if (s.current) spaces.push({ slug: h.page, status: "exists", version_id: s.current.id });
        else if (s.pending) spaces.push({ slug: h.page, status: s.pending.status, version_id: s.pending.id });
        else {
          try {
            const r = requestSpace(getUser(h.ownerId), h.slug, h.target, h.request, "system");
            spaces.push({ slug: h.page, status: r.status, version_id: r.version_id });
          } catch (e) {
            spaces.push({ slug: h.page, status: "error", error: e instanceof AppError ? e.message : String(e) });
          }
        }
      }
    }

    const redesigned: { slug: string; status: string; version_id?: string; error?: string }[] = [];
    if (Array.isArray(body.redesign)) {
      const pages = demoSpaces();
      for (const item of body.redesign as { slug?: unknown; request?: unknown }[]) {
        const h = pages.find((x) => x.page === item?.slug);
        const request = typeof item?.request === "string" ? item.request.trim() : "";
        if (!h || request.length < 10) {
          redesigned.push({ slug: String(item?.slug), status: "error", error: "Unknown demo challenge or request too short." });
          continue;
        }
        try {
          const r = requestSpace(getUser(h.ownerId), h.slug, h.target, request, "system");
          redesigned.push({ slug: h.page, status: r.status, version_id: r.version_id });
        } catch (e) {
          redesigned.push({ slug: h.page, status: "error", error: e instanceof AppError ? e.message : String(e) });
        }
      }
    }

    return json({
      ...seed,
      covers: body.covers === true || Array.isArray(body.covers) ? covers : null,
      spaces: body.spaces === true ? spaces : null,
      redesigned: Array.isArray(body.redesign) ? redesigned : null,
    });
  } catch (e) {
    return errorJson(e);
  }
}
