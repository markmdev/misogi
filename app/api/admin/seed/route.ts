import { queueCover } from "@/lib/server/covers";
import { all } from "@/lib/server/db";
import { findChallenge } from "@/lib/server/domain/challenges";
import { getUser, getUserByHandle } from "@/lib/server/domain/users";
import { adminAuthorized, errorJson, json } from "@/lib/server/http";
import { demoSpaces, placeDemoClimbers, seedDemo, seededChallenges } from "@/lib/server/seed";
import { ownerKeyFor, queueChallengeApp, requestSpace, spaceStatus, type SpaceTarget } from "@/lib/server/spaces";
import { makeSticker } from "@/lib/server/stickers";
import { AppError } from "@/lib/server/util";
import { queueVirgil } from "@/lib/server/virgils";

export const dynamic = "force-dynamic";


/**
 * Seeds the demo data. Body: { force?: boolean, covers?: boolean | string[], virgils?: boolean | string[], spaces?: boolean }.
 * covers: queue a cover image for every seeded challenge that doesn't have one yet; or, given a list of challenge slugs, draw a new cover for each (the old file stays).
 * virgils: draw Virgil dressed for every challenge on the site that doesn't have one yet; or, given a list of slugs, for each of those again; a { slug, outfit } entry dresses him in that outfit instead of one Muse Spark picks.
 * apps: [slug] gives each of those challenges that has no page yet its own app, as a new challenge gets one: Muse Spark writes the brief, Muse Wonder builds it.
 * spaces: build each live demo challenge's shared page, and each demo member page the seed asks for, that doesn't have one yet.
 * redesign: [{ slug, request }] asks for a new version of any page, built on the current one; slug is "challenge" for its shared page
 * or "challenge/handle" for a member's own.
 * cities: puts each demo climber at their city on the world map (a forced seed does it too).
 * stickers: [mediaId] cuts each of those photos' subject into a sticker, as a new photo log gets, and answers with what it cut.
 */
export async function POST(req: Request) {
  if (!adminAuthorized(req)) return json({ error: { code: "unauthorized", message: "Missing or wrong x-admin-key." } }, { status: 401 });
  try {
    let body: { force?: unknown; covers?: unknown; virgils?: unknown; apps?: unknown; spaces?: unknown; redesign?: unknown; cities?: unknown; stickers?: unknown } = {};
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

    const virgils = { queued: [] as string[], already: 0 };
    if (body.virgils === true) {
      for (const c of all<{ id: string; slug: string; virgil_path: string | null }>("SELECT id, slug, virgil_path FROM challenges WHERE status != 'draft'")) {
        if (c.virgil_path) virgils.already++;
        else {
          queueVirgil(c.id);
          virgils.queued.push(c.slug);
        }
      }
    } else if (Array.isArray(body.virgils)) {
      for (const v of body.virgils as unknown[]) {
        const { slug, outfit } = typeof v === "string" ? { slug: v, outfit: undefined } : (v as { slug?: unknown; outfit?: unknown });
        const c = typeof slug === "string" ? findChallenge(slug) : null;
        if (!c) throw new AppError("not_found", `No challenge "${String(slug)}".`);
        queueVirgil(c.id, typeof outfit === "string" && outfit.trim() ? outfit.trim() : undefined);
        virgils.queued.push(c.slug);
      }
    }

    const apps: string[] = [];
    if (Array.isArray(body.apps)) {
      for (const slug of body.apps) {
        const c = typeof slug === "string" ? findChallenge(slug) : null;
        if (!c) throw new AppError("not_found", `No challenge "${String(slug)}".`);
        if (spaceStatus(c.id, "").current) continue;
        queueChallengeApp(c.id);
        apps.push(c.slug);
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
      for (const item of body.redesign as { slug?: unknown; request?: unknown }[]) {
        const h = pageAt(String(item?.slug ?? ""));
        const request = typeof item?.request === "string" ? item.request.trim() : "";
        if (!h || request.length < 10) {
          redesigned.push({ slug: String(item?.slug), status: "error", error: "No such page, or the request is too short." });
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

    const stickers: { id: string; sticker: Awaited<ReturnType<typeof makeSticker>> }[] = [];
    if (Array.isArray(body.stickers)) for (const id of body.stickers) stickers.push({ id: String(id), sticker: await makeSticker(String(id)) });

    return json({
      ...seed,
      covers: body.covers === true || Array.isArray(body.covers) ? covers : null,
      virgils: body.virgils === true || Array.isArray(body.virgils) ? virgils : null,
      apps: Array.isArray(body.apps) ? { queued: apps } : null,
      spaces: body.spaces === true ? spaces : null,
      redesigned: Array.isArray(body.redesign) ? redesigned : null,
      placed: body.cities === true ? placeDemoClimbers() : null,
      stickers: Array.isArray(body.stickers) ? stickers : null,
    });
  } catch (e) {
    return errorJson(e);
  }
}

/** A page by its address: "challenge" is its shared page, which its creator builds; "challenge/handle" is that member's own. */
function pageAt(address: string): { page: string; slug: string; ownerId: string; target: SpaceTarget } | null {
  const [slug, handle] = address.split("/");
  const c = findChallenge(slug ?? "");
  if (!c) return null;
  if (!handle) return c.creator_id ? { page: c.slug, slug: c.slug, ownerId: c.creator_id, target: "challenge" } : null;
  const u = getUserByHandle(handle);
  return u ? { page: `${c.slug}/${u.handle}`, slug: c.slug, ownerId: u.id, target: "me" } : null;
}
