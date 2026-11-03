import type { PublicUser } from "@/lib/shared/types";
import type { UserRow } from "../auth";
import { one, run } from "../db";
import { AppError, id, isValidTimeZone, nowIso, slugify } from "../util";

export const AVATARS = ["sky", "mint", "peach", "lilac", "sand", "rose"] as const;

export function publicUser(u: Pick<UserRow, "handle" | "display_name" | "avatar" | "agent_name" | "agent_kind" | "agent_seen_at">): PublicUser {
  return {
    handle: u.handle,
    display_name: u.display_name,
    avatar: u.avatar,
    agent_name: u.agent_name,
    agent_kind: u.agent_kind,
    agent_seen_at: u.agent_seen_at,
  };
}

export function getUser(userId: string): UserRow {
  const u = one<UserRow>("SELECT * FROM users WHERE id = ?", userId);
  if (!u) throw new AppError("not_found", "User not found.");
  return u;
}

export function getUserByHandle(handle: string): UserRow | null {
  return one<UserRow>("SELECT * FROM users WHERE handle = ?", handle.toLowerCase()) ?? null;
}

function uniqueHandle(base: string): string {
  const root = slugify(base, 20).replace(/-/g, "") || "climber";
  let handle = root;
  for (let i = 0; i < 50 && one("SELECT 1 FROM users WHERE handle = ?", handle); i++) {
    handle = `${root}${Math.floor(Math.random() * 900 + 100)}`;
  }
  return handle;
}

export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!n) throw new AppError("invalid", "Name can't be empty.");
  return n;
}

export function createUser(input: {
  display_name: string;
  handle?: string;
  motivation_style?: string;
  timezone?: string;
  avatar?: string;
  is_demo?: boolean;
}): UserRow {
  const display_name = cleanName(input.display_name);
  const handle = input.handle ? input.handle.toLowerCase() : uniqueHandle(display_name);
  if (!/^[a-z0-9]{2,24}$/.test(handle)) throw new AppError("invalid", "Handles use 2–24 letters or numbers.");
  if (one("SELECT 1 FROM users WHERE handle = ?", handle)) throw new AppError("conflict", `@${handle} is taken.`);
  const avatar = input.avatar && (AVATARS as readonly string[]).includes(input.avatar) ? input.avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  const userId = id("usr");
  run(
    `INSERT INTO users (id, handle, display_name, avatar, motivation_style, timezone, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    handle,
    display_name,
    avatar,
    (input.motivation_style ?? "").slice(0, 600),
    tz,
    input.is_demo ? 1 : 0,
    nowIso(),
  );
  return getUser(userId);
}

export function updatePreferences(
  userId: string,
  patch: { display_name?: string; motivation_style?: string; timezone?: string; agent_name?: string; avatar?: string },
): UserRow {
  const u = getUser(userId);
  const next = {
    display_name: patch.display_name != null ? cleanName(patch.display_name) : u.display_name,
    motivation_style: patch.motivation_style != null ? patch.motivation_style.slice(0, 600) : u.motivation_style,
    timezone:
      patch.timezone != null
        ? isValidTimeZone(patch.timezone)
          ? patch.timezone
          : (() => {
              throw new AppError("invalid", `Unknown time zone "${patch.timezone}". Use an IANA name like America/New_York.`);
            })()
        : u.timezone,
    agent_name: patch.agent_name != null ? patch.agent_name.trim().slice(0, 30) || null : u.agent_name,
    avatar: patch.avatar && (AVATARS as readonly string[]).includes(patch.avatar) ? patch.avatar : u.avatar,
  };
  run(
    "UPDATE users SET display_name = ?, motivation_style = ?, timezone = ?, agent_name = ?, avatar = ? WHERE id = ?",
    next.display_name,
    next.motivation_style,
    next.timezone,
    next.agent_name,
    next.avatar,
    userId,
  );
  return getUser(userId);
}

/** Records that the user's agent just acted, and which kind of agent it is. */
/** Records which agent last acted. The built-in Virgil never displaces a connected outside agent (seen in the last 30 days). */
export function touchAgent(userId: string, kind: string) {
  if (kind === "virgil") {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    run(
      `UPDATE users SET agent_seen_at = ?, agent_kind = 'virgil'
       WHERE id = ? AND (agent_kind IS NULL OR agent_kind IN ('virgil', 'web') OR agent_seen_at IS NULL OR agent_seen_at < ?)`,
      nowIso(),
      userId,
      cutoff,
    );
    return;
  }
  run("UPDATE users SET agent_seen_at = ?, agent_kind = ? WHERE id = ?", nowIso(), kind, userId);
}
