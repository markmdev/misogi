// Connecting Muse, as Muse does it (its requests in the proxy log of 4 November): it reads the Connect message's link,
// registers with its own callback, opens the sign-in the link names, and trades the code for a key at the token address.
// Muse moved that address on 4 November, from /oauth/token (the one the guide gives) to /oauth/auth/token, so both are
// checked. Each connect spends the account's connect code, so each test reads a fresh one from the Connect page.
//   BASE_URL=http://localhost:3000 bun test tests/muse-connect.test.ts
// On the live site, with the connect-check account's key (it creates nothing there):
//   CONNECT_CHECK_KEY=$(security find-generic-password -s misogi-connect-check -a key -w) ALLOW_REMOTE_TESTS=1 \
//   BASE_URL=https://getmisogi.com bun test tests/muse-connect.test.ts

import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE) && !process.env.ALLOW_REMOTE_TESTS)
  throw new Error(`Refusing to run against ${BASE}: the tests sign in there. Set ALLOW_REMOTE_TESTS=1 if you mean it.`);
const MUSE_CALLBACK = "https://agent.meta.ai/api/hatch/oauth/callback";
const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function accountKey(): Promise<string> {
  if (process.env.CONNECT_CHECK_KEY) return process.env.CONNECT_CHECK_KEY;
  const r = await fetch(`${BASE}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ display_name: "Connect Check" }),
  });
  return ((await r.json()) as { key: string }).key;
}

/** The code in the account's Connect message, read from its Connect page as the person who copies it would see it. */
async function connectCode(key: string): Promise<string> {
  const link = (await (
    await fetch(`${BASE}/api/v1/tools/get_sign_in_link`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}" })
  ).json()) as { url: string };
  const signin = await fetch(`${BASE}/api/signin`, { method: "POST", headers: { "x-forwarded-for": ip }, body: new URLSearchParams({ token: link.url.split("/signin/")[1] }), redirect: "manual" });
  const cookie = (signin.headers.get("set-cookie") ?? "").split(";")[0];
  const page = await (await fetch(`${BASE}/connect`, { headers: { cookie } })).text();
  const code = /connectCode\\?":\\?"([A-Za-z0-9_-]+)/.exec(page)?.[1];
  if (!code) throw new Error("The Connect page carries no connect code.");
  return code;
}

/** Muse's whole connect, ending at `tokenAt`: the key it gets, or what stopped it. */
async function museConnects(key: string, tokenAt: (guide: Record<string, string>) => string) {
  const guide = await (await fetch(`${BASE}/hi/${await connectCode(key)}`)).text();
  const call = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(guide)?.[1] ?? "null") as Record<string, string>;
  expect(call?.auth_scheme).toBe("oauth2_code");

  const reg = await fetch(call.registration_url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ client_name: "Muse", redirect_uris: [MUSE_CALLBACK] }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = crypto.randomBytes(32).toString("base64url");
  const authorize = new URL(call.authorization_url);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id,
    redirect_uri: MUSE_CALLBACK,
    scope: call.scopes,
    resource: call.resource,
    state: "check",
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }))
    authorize.searchParams.set(k, v);
  const back = await fetch(authorize, { redirect: "manual" });
  const to = new URL(back.headers.get("location") ?? "about:blank");
  expect(`${to.origin}${to.pathname}`).toBe(MUSE_CALLBACK);
  expect(to.searchParams.get("state")).toBe("check");

  const token = await fetch(tokenAt(call), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: to.searchParams.get("code") ?? "", redirect_uri: MUSE_CALLBACK, client_id, code_verifier: verifier }),
  });
  expect(token.status).toBe(200);
  const { access_token } = (await token.json()) as { access_token: string };

  const mcp = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_my_challenges", arguments: {} } }),
  });
  expect(mcp.status).toBe(200);
  expect(((await mcp.json()) as { result?: { isError?: boolean } }).result?.isError).toBeFalsy();
}

describe("Muse connects with one paste", () => {
  test("at the token address the guide gives", async () => {
    await museConnects(await accountKey(), (call) => call.token_url);
  }, 60_000);

  test("at /oauth/auth/token, where Muse has sent it since 4 November", async () => {
    await museConnects(await accountKey(), () => `${BASE.replace(/\/$/, "")}/oauth/auth/token`);
  }, 60_000);
});
