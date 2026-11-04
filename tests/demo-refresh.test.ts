// Refreshing the demo climbers' stories to today leaves real people's part in those challenges alone.
//   BASE_URL=http://localhost:3000 ADMIN_KEY=… DATABASE_PATH=<that server's database> bun test tests/demo-refresh.test.ts
// It rebuilds that server's demo data. Without ADMIN_KEY and DATABASE_PATH it says it skipped.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE) && !process.env.ALLOW_REMOTE_TESTS)
  throw new Error(`Refusing to run against ${BASE}: the tests rebuild its demo data. Set ALLOW_REMOTE_TESTS=1 if you mean it.`);
const KEY = process.env.ADMIN_KEY;
const FILE = process.env.DATABASE_PATH;

const seed = async (force: boolean) => {
  const r = await fetch(`${BASE}/api/admin/seed`, { method: "POST", headers: { "x-admin-key": KEY!, "content-type": "application/json" }, body: JSON.stringify({ force }) });
  expect(r.status).toBe(200);
};

/** A new person with their own key, as their agent signs them up. */
async function account(name: string) {
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const r = await fetch(`${BASE}/api/v1/accounts`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ display_name: name }) });
  const { key, handle } = (await r.json()) as { key: string; handle: string };
  const tool = async (name: string, args: unknown) => {
    const t = await fetch(`${BASE}/api/v1/tools/${name}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(args) });
    expect(t.status).toBe(200);
    return t.json() as Promise<Record<string, unknown>>;
  };
  return { handle, tool };
}

type Log = { id: string; user_id: string; note: string; label: string | null };

describe("the demo refresh", () => {
  test.skipIf(!KEY || !FILE)("keeps a real person's climb, logs and cheers in the demo and friends' challenges", async () => {
    const db = new Database(FILE!);
    const logsOf = (slug: string, handle: string) =>
      db
        .query(
          `SELECT l.id, l.user_id, l.note, l.label FROM logs l JOIN challenges c ON c.id = l.challenge_id JOIN users u ON u.id = l.user_id
            WHERE c.slug = ? AND u.handle = ? AND l.deleted_at IS NULL ORDER BY l.created_at DESC`,
        )
        .all(slug, handle) as Log[];
    const userId = (handle: string) => (db.query("SELECT id FROM users WHERE handle = ?").get(handle) as { id: string }).id;

    // A friend of the film's, with the challenge they started, given their story.
    await seed(false);
    db.run("DELETE FROM challenges WHERE slug = 'taste-20-different-cuisines-in-a-year'");
    db.run("DELETE FROM users WHERE handle = 'tasos'");
    const tasos = await account("Tasos");
    expect(tasos.handle).toBe("tasos");
    const { slug } = (await tasos.tool("create_challenge", {
      title: "Taste 20 different cuisines in a year",
      metric: { name: "different cuisines tried", unit: "cuisines", target: 20, aggregation: "distinct" },
    })) as { slug: string };
    expect(slug).toBe("taste-20-different-cuisines-in-a-year");
    await seed(true);

    // A judge joins two of them, logs, and cheers a story beat, a plain log, an item and a repeated note.
    const judge = await account("Real Judge");
    await judge.tool("join_challenge", { challenge: "learn-french" });
    await judge.tool("join_challenge", { challenge: slug });
    const mine = (await judge.tool("log_progress", { challenge: "learn-french", value: 1, note: "My first hour" })) as { log_id: string };
    const judgeId = userId(judge.handle);
    const toby = logsOf("learn-french", "tobyreid");
    const story = toby.find((l) => l.note)!;
    const plain = toby.find((l) => !l.note)!;
    const item = logsOf(slug, "tasos")[0];
    // A weekly ritual's note repeats in one climber's story: two cheers on two such logs stay two.
    const twice = db
      .query(
        `SELECT l.challenge_id, l.user_id, l.note FROM logs l JOIN users u ON u.id = l.user_id JOIN challenges c ON c.id = l.challenge_id
          WHERE u.is_demo = 1 AND l.note != '' AND c.slug NOT IN ('learn-french', ?) GROUP BY 1, 2, 3 HAVING COUNT(*) > 1 LIMIT 1`,
      )
      .get(slug) as { challenge_id: string; user_id: string; note: string };
    const repeated = db
      .query("SELECT id, user_id, note, label FROM logs WHERE challenge_id = ? AND user_id = ? AND note = ? LIMIT 2")
      .all(twice.challenge_id, twice.user_id, twice.note) as Log[];
    for (const l of [story, plain, item, ...repeated]) db.run("INSERT INTO cheers (log_id, user_id, created_at) VALUES (?, ?, ?)", [l.id, judgeId, new Date().toISOString()]);

    await seed(true);

    expect(logsOf("learn-french", "tobyreid").some((l) => l.id === story.id)).toBe(false);
    expect(db.query("SELECT 1 FROM logs WHERE id = ?").get(mine.log_id)).toBeTruthy();
    expect(db.query("SELECT challenge_id FROM memberships WHERE user_id = ?").all(judgeId)).toHaveLength(2);
    const cheered = db
      .query(`SELECT l.id, l.user_id, l.note, l.label FROM cheers ch JOIN logs l ON l.id = ch.log_id WHERE ch.user_id = ?`)
      .all(judgeId) as Log[];
    expect(cheered).toHaveLength(5);
    expect(cheered.filter((l) => l.user_id === twice.user_id && l.note === twice.note)).toHaveLength(2);
    expect(cheered.some((l) => l.note === story.note && l.user_id === story.user_id)).toBe(true);
    expect(cheered.some((l) => l.label === item.label && l.user_id === item.user_id)).toBe(true);
    expect(cheered.filter((l) => l.user_id === story.user_id)).toHaveLength(2);
    db.close();
  });
});
