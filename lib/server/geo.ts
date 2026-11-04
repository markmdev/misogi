// Where climbers are, at city level, for the world map on Explore. A person picks their city (lib/server/cities.ts) or
// tells their Muse. Nothing else sets it.

import { cityByKey, type City } from "./cities";
import { all, run } from "./db";
import { virgilUrl } from "./domain/challenges";
import { AppError } from "./util";

/** Sets or clears a person's city. Only a city from the list can be set. */
export function setCity(userId: string, key: string | null): void {
  if (key && !cityByKey(key)) throw new AppError("invalid", "That city isn't on the list.");
  run("UPDATE users SET city = ? WHERE id = ?", key || null, userId);
}

const PLAIN_MUSE = "/art/mascot/idle.webp";

export type MapClimber = {
  handle: string;
  name: string;
  demo: boolean;
  city: City;
  muse: string;
  challenges: { slug: string; title: string; icon: string; url: string; muse: string | null }[];
};

/** Everyone who picked a city, standing there with their newest challenge's dressed Muse, and what they're climbing. */
export function worldMap(): { climbers: MapClimber[] } {
  const rows = all<{ handle: string; display_name: string; is_demo: number; city: string; slug: string; title: string; emoji: string; virgil_path: string | null }>(
    `SELECT u.handle, u.display_name, u.is_demo, u.city, c.slug, c.title, c.emoji, c.virgil_path
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
       JOIN challenges c ON c.id = m.challenge_id AND c.status = 'active'
      WHERE u.city IS NOT NULL
      ORDER BY u.handle, m.joined_at DESC`,
  );
  const climbers = new Map<string, MapClimber>();
  for (const r of rows) {
    let p = climbers.get(r.handle);
    if (!p) {
      const c = cityByKey(r.city);
      if (!c) continue;
      p = { handle: r.handle, name: r.display_name, demo: r.is_demo === 1, city: c, muse: PLAIN_MUSE, challenges: [] };
      climbers.set(r.handle, p);
    }
    const muse = virgilUrl(r);
    if (muse && p.muse === PLAIN_MUSE) p.muse = muse;
    p.challenges.push({ slug: r.slug, title: r.title, icon: r.emoji, url: `/c/${r.slug}/${r.handle}`, muse });
  }
  return { climbers: [...climbers.values()] };
}
