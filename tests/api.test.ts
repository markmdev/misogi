// End-to-end tests against a running Misogi server (no mocks).
//   BASE_URL=http://localhost:3000 bun test   (that is the default)
// They create their own accounts and challenges; no model calls except where noted.

import { describe, expect, test } from "bun:test";

// Responses are loosely typed JSON; the assertions are the real checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const BASE = process.env.BASE_URL || "http://localhost:3000";
// These tests create real accounts and challenges. Keep them off shared servers unless asked.
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE) && !process.env.ALLOW_REMOTE_TESTS)
  throw new Error(`Refusing to run against ${BASE}: the tests create accounts there. Set ALLOW_REMOTE_TESTS=1 if you mean it.`);
const run = Math.random().toString(36).slice(2, 8);

async function signup(name: string) {
  const r = await fetch(`${BASE}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ display_name: name, timezone: "America/New_York" }),
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { key: string; handle: string; sign_in_url: string };
}

async function tool(key: string, name: string, args: unknown = {}) {
  const r = await fetch(`${BASE}/api/v1/tools/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-misogi-agent": "test" },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

async function mcp(key: string | null, method: string, params?: unknown, id = 1) {
  const r = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

describe("public endpoints", () => {
  test("health", async () => {
    const r = await fetch(`${BASE}/api/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  test("agent guide lists every tool", async () => {
    const guide = await (await fetch(`${BASE}/agent.md`)).text();
    const { tools } = (await (await fetch(`${BASE}/api/v1/tools`)).json()) as { tools: { name: string }[] };
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) expect(guide).toContain(`### ${t.name}`);
  });

  test("pages render", async () => {
    for (const p of ["/", "/explore", "/start", "/connect", "/llms.txt"]) {
      const r = await fetch(`${BASE}${p}`);
      expect(r.status).toBe(200);
    }
    expect((await fetch(`${BASE}/c/does-not-exist-${run}`)).status).toBe(404);
  });

  test("tools reject missing or bad keys", async () => {
    const r1 = await fetch(`${BASE}/api/v1/tools/list_my_challenges`, { method: "POST" });
    expect(r1.status).toBe(401);
    const r2 = await tool("msk_not-a-real-key", "list_my_challenges");
    expect(r2.status).toBe(401);
    const r3 = await mcp(null, "tools/list");
    expect(r3.status).toBe(401);
  });
});

describe("a full climb over the HTTP API", () => {
  let alice: Awaited<ReturnType<typeof signup>>;
  let bob: Awaited<ReturnType<typeof signup>>;
  let slug = "";

  test("create a challenge with a plan and quests", async () => {
    alice = await signup(`Alice ${run}`);
    const c = await tool(alice.key, "create_challenge", {
      title: `Run 365 miles ${run}`,
      tagline: "One mile a day, on average.",
      metric: { name: "miles run", unit: "mi", target: 365, aggregation: "sum" },
      category: "fitness",
      emoji: "running",
      theme: "mint",
    });
    expect(c.status).toBe(200);
    slug = c.body.slug;
    expect(slug).toStartWith("run-365-miles");

    const today = new Date().toISOString().slice(0, 10);
    const plan = await tool(alice.key, "set_plan", {
      challenge: slug,
      summary_md: "Three easy runs a week, one longer run on Sundays. Build slowly and rest when tired.",
      cadence: "3 runs a week, check-in Sun",
      milestones: [
        { title: "First 10", target: 10 },
        { title: "Fifty", target: 50 },
        { title: "Summit", target: 365, emoji: "summit" },
      ],
      reason: "first plan",
    });
    expect(plan.status).toBe(200);
    expect(plan.body.version).toBe(1);

    const quests = await tool(alice.key, "add_quests", {
      challenge: slug,
      quests: [{ title: "Run 3 easy miles", kind: "weekly", xp: 20, due_on: today }],
    });
    expect(quests.status).toBe(200);
    expect(quests.body.quests).toHaveLength(1);
  });

  test("logging updates facts and reaches camps", async () => {
    const q = (await tool(alice.key, "get_challenge", { challenge: slug })).body.quests.open[0];
    const r = await tool(alice.key, "log_progress", { challenge: slug, value: 6, note: "Easy loop around the park, felt fresh", quest_id: q.id });
    expect(r.status).toBe(200);
    expect(r.body.xp).toBe(10 + 5 + 20);
    const r2 = await tool(alice.key, "log_progress", { challenge: slug, value: 5 });
    expect(r2.body.milestones_reached.map((m: { title: string }) => m.title)).toContain("First 10");
    expect(r2.body.facts.total).toBe(11);

    const ctx = await tool(alice.key, "get_challenge", { challenge: slug, include_playbook: true });
    expect(ctx.body.facts.streak).toBe(1);
    expect(ctx.body.facts.milestones_done).toBe(1);
    expect(ctx.body.quests.open).toHaveLength(0);
    expect(ctx.body.playbook).toContain("Misogi playbook");
  });

  test("validation errors are clear", async () => {
    const noValue = await tool(alice.key, "log_progress", { challenge: slug });
    expect(noValue.status).toBe(400);
    expect(noValue.body.error.message).toContain("value");
    expect(noValue.body.error.hint).toContain("note");
    const future = await tool(alice.key, "log_progress", { challenge: slug, value: 1, date: "2099-01-01" });
    expect(future.status).toBe(400);
    const missing = await tool(alice.key, "get_challenge", { challenge: `nope-${run}` });
    expect(missing.status).toBe(404);
    expect(missing.body.error.hint).toBeTruthy();
  });

  test("a practice check-in keeps the streak without moving the total", async () => {
    const r = await tool(alice.key, "log_progress", { challenge: slug, note: "Stretching and mobility, no running today" });
    expect(r.status).toBe(200);
    expect(r.body.facts.total).toBe(11);
    expect(r.body.xp).toBe(15);
    const feed = await tool(alice.key, "get_feed", { challenge: slug });
    expect(JSON.stringify(feed.body)).toContain("checked in");
  });

  test("permissions: outsiders can't log, members can't change the shared page", async () => {
    bob = await signup(`Bob ${run}`);
    const outsider = await tool(bob.key, "log_progress", { challenge: slug, value: 1 });
    expect(outsider.status).toBe(403);
    const joined = await tool(bob.key, "join_challenge", { challenge: slug });
    expect(joined.status).toBe(200);
    const shared = await tool(bob.key, "update_space", { challenge: slug, target: "challenge", request: "Make it purple and loud please" });
    expect(shared.status).toBe(403);
    const metric = await tool(bob.key, "update_challenge", { challenge: slug, title: "Hijacked" });
    expect(metric.status).toBe(403);
    const log = await tool(bob.key, "log_progress", { challenge: slug, value: 20 });
    expect(log.status).toBe(200);
  });

  test("the world map shows only people who picked a city, and only the city", async () => {
    const map = async () => ((await (await fetch(`${BASE}/api/map`)).json()) as { climbers: Json[] }).climbers;
    expect((await map()).some((c) => c.handle === bob.handle)).toBe(false);

    const set = await tool(bob.key, "set_city", { city: "Lisbon" });
    expect(set.status).toBe(200);
    expect(set.body.city).toBe("Lisbon, Portugal");
    const me = (await map()).find((c) => c.handle === bob.handle)!;
    expect(me.city).toMatchObject({ name: "Lisbon", country: "Portugal" });
    expect(Math.abs(me.city.lat - 38.72) + Math.abs(me.city.lon + 9.14)).toBeLessThan(0.1);
    expect(Object.keys(me).sort()).toEqual(["challenges", "city", "demo", "handle", "muse", "name"]);
    expect(me.demo).toBe(false);
    expect(me.challenges.map((c: Json) => c.slug)).toContain(slug);

    const unsure = await tool(bob.key, "set_city", { city: "Springfield" });
    expect(unsure.body.choices.length).toBeGreaterThan(1);
    expect((await map()).find((c) => c.handle === bob.handle)!.city.name).toBe("Lisbon");

    await tool(bob.key, "set_city", { city: null });
    expect((await map()).some((c) => c.handle === bob.handle)).toBe(false);
  });

  test("leaderboard orders by progress and the metric locks", async () => {
    const ctx = await tool(alice.key, "get_challenge", { challenge: slug });
    expect(ctx.body.leaderboard[0].handle).toBe(bob.handle);
    expect(ctx.body.facts.rank).toBe(2);
    const lock = await tool(alice.key, "update_challenge", { challenge: slug, metric: { name: "runs", aggregation: "count" } });
    expect(lock.status).toBe(409);
  });

  test("removing a log is limited to its author", async () => {
    const ctx = await tool(bob.key, "get_challenge", { challenge: slug });
    const logId = ctx.body.recent_logs[0].id;
    const steal = await tool(alice.key, "remove_log", { challenge: slug, log_id: logId });
    expect(steal.status).toBe(403);
    const own = await tool(bob.key, "remove_log", { challenge: slug, log_id: logId });
    expect(own.status).toBe(200);
  });

  test("MCP: list and call tools with the same key", async () => {
    const init = await mcp(alice.key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("misogi");
    const list = await mcp(alice.key, "tools/list", undefined, 2);
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toContain("log_progress");
    const call = await mcp(alice.key, "tools/call", { name: "get_challenge", arguments: { challenge: slug } }, 3);
    const payload = JSON.parse(call.body.result.content[0].text);
    expect(payload.challenge.slug).toBe(slug);
    const bad = await mcp(alice.key, "tools/call", { name: "log_progress", arguments: { challenge: slug } }, 4);
    expect(bad.body.result.isError).toBe(true);
  });

  test("public pages show the climb", async () => {
    expect((await fetch(`${BASE}/c/${slug}`)).status).toBe(200);
    expect((await fetch(`${BASE}/c/${slug}/${alice.handle}`)).status).toBe(200);
    const card = await fetch(`${BASE}/c/${slug}/${alice.handle}/card`);
    expect(card.headers.get("content-type")).toContain("image/png");
    const pulse = (await (await fetch(`${BASE}/api/pulse?c=${slug}`)).json()) as { stamp: string };
    expect(pulse.stamp).toBeTruthy();
  });

  test("sign-in links work once, and only on POST", async () => {
    const link = await tool(alice.key, "get_sign_in_link");
    const preview = await fetch(link.body.url);
    expect(preview.status).toBe(200); // a link preview (GET) doesn't use the token
    const token = String(link.body.url).split("/signin/")[1];
    // Its own address, so back-to-back runs don't trip the sign-in limit of 10 a minute per address.
    const ip = `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const post = () =>
      fetch(`${BASE}/api/signin`, { method: "POST", headers: { "x-forwarded-for": ip }, body: new URLSearchParams({ token }), redirect: "manual" });
    const first = await post();
    expect(first.status).toBe(303);
    expect(first.headers.get("set-cookie") ?? "").toContain("misogi_session");
    const second = await post();
    expect(second.headers.get("location") ?? "").toContain("signin-expired");
  });
});

describe("spaces are sandboxed", () => {
  test("a missing space is a 404, and served spaces carry a sandbox CSP", async () => {
    expect((await fetch(`${BASE}/s/spc_doesnotexist`)).status).toBe(404);
    const id = process.env.SPACE_ID;
    if (!id) return;
    const r = await fetch(`${BASE}/s/${id}`);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
    expect(await r.text()).toContain('id="misogi-data"');
  });
});
