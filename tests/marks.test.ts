// What a person ticks or picks on a Muse Wonder page is kept for them alone, only when they're signed in, and small.
//   BASE_URL=http://localhost:3000 bun test tests/marks.test.ts
// It needs one built page: SPACE_ID, or else the one the home page shows. Without either it says it skipped.

import { describe, expect, test } from "bun:test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE) && !process.env.ALLOW_REMOTE_TESTS)
  throw new Error(`Refusing to run against ${BASE}: the tests create accounts there. Set ALLOW_REMOTE_TESTS=1 if you mean it.`);
const SPACE =
  process.env.SPACE_ID ??
  /\/s\/(spc_[a-z0-9]+)/.exec(await (await fetch(`${BASE}/`)).text())?.[1];

/** A new person, signed in: their session cookie. */
async function signedIn(name: string): Promise<string> {
  const ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const acct = (await (
    await fetch(`${BASE}/api/v1/accounts`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ display_name: name }) })
  ).json()) as { key: string };
  const link = (await (
    await fetch(`${BASE}/api/v1/tools/get_sign_in_link`, { method: "POST", headers: { authorization: `Bearer ${acct.key}`, "content-type": "application/json" }, body: "{}" })
  ).json()) as { url: string };
  const r = await fetch(`${BASE}/api/signin`, { method: "POST", headers: { "x-forwarded-for": ip }, body: new URLSearchParams({ token: link.url.split("/signin/")[1] }), redirect: "manual" });
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}

const save = (space: string, data: unknown, cookie?: string) =>
  fetch(`${BASE}/api/spaces/${space}/marks`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ data }) });

/** The data a page gets when it loads, as this person (or nobody) sees it. */
async function frameData(space: string, cookie?: string) {
  const html = await (await fetch(`${BASE}/s/${space}`, { headers: cookie ? { cookie } : {} })).text();
  const json = /<script id="misogi-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1];
  return JSON.parse(json) as { saved: unknown; can_save: boolean };
}

describe("ticks on a page", () => {
  test("nobody signed in can save", async () => {
    expect((await save(SPACE ?? "spc_doesnotexist", { ticks: [1] })).status).toBe(401);
  });

  test.skipIf(!SPACE)("each person gets back only what they saved", async () => {
    if (!SPACE) return;
    const ana = await signedIn("Ana Marks");
    const ben = await signedIn("Ben Marks");
    expect((await save(SPACE, { ticks: ["The Hobbit", "Mort"] }, ana)).status).toBe(200);
    expect((await frameData(SPACE, ana)).saved).toEqual({ ticks: ["The Hobbit", "Mort"] });
    expect((await frameData(SPACE, ana)).can_save).toBe(true);
    expect((await frameData(SPACE, ben)).saved).toBeNull();
    const nobody = await frameData(SPACE);
    expect(nobody.saved).toBeNull();
    expect(nobody.can_save).toBe(false);
    const showcase = await frameData(`${SPACE}?showcase=1`, ana);
    expect(showcase.saved).toBeNull();
    expect(showcase.can_save).toBe(false);
  });

  test.skipIf(!SPACE)("a page can keep only a little", async () => {
    if (!SPACE) return;
    const cat = await signedIn("Cat Marks");
    expect((await save(SPACE, { note: "x".repeat(9000) }, cat)).status).toBe(400);
  });
});
