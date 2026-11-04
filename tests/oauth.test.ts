// How Muse signs in (OAuth 2.0 with PKCE and dynamic client registration), end to end against a running server.
//   BASE_URL=http://localhost:3000 bun test tests/oauth.test.ts
// Muse keeps a site's credential only through this flow, so these follow its contract: RFC 6749, 7591 and 7636.

import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const BASE = process.env.BASE_URL || "http://localhost:3000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE) && !process.env.ALLOW_REMOTE_TESTS)
  throw new Error(`Refusing to run against ${BASE}: the tests create accounts there. Set ALLOW_REMOTE_TESTS=1 if you mean it.`);

const REDIRECT = "https://agent.meta.ai/api/hatch/oauth/callback";
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

/** The connect code in the Connect page's Muse message. The panel shows it masked; the page's props carry it whole for Copy. */
async function connectCodeFor(cookie: string) {
  const page = await (await fetch(`${BASE}/connect`, { headers: { cookie } })).text();
  const code = /connectCode\\?":\\?"([A-Za-z0-9_-]+)/.exec(page)?.[1];
  expect(code).toBeTruthy();
  return code!;
}

/** A new account with a challenge, and the connect code from its Connect page's Muse message. */
async function personWithConnectCode() {
  const ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const r = await fetch(`${BASE}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ display_name: "Oauth Tester", timezone: "America/New_York" }),
  });
  const account = (await r.json()) as { key: string; handle: string; sign_in_url: string };
  await fetch(`${BASE}/api/v1/tools/join_challenge`, {
    method: "POST",
    headers: { authorization: `Bearer ${account.key}`, "content-type": "application/json" },
    body: JSON.stringify({ challenge: "read-25-books" }),
  });
  const token = account.sign_in_url.split("/signin/")[1];
  const signIn = await fetch(`${BASE}/api/signin`, { method: "POST", headers: { "x-forwarded-for": ip }, body: new URLSearchParams({ token }), redirect: "manual" });
  const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0];
  return { ...account, cookie, code: await connectCodeFor(cookie) };
}

async function register() {
  const r = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Muse", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

async function authorize(clientId: string, opts: { code: string; redirect?: string }) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirect ?? REDIRECT,
    state: "st-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "misogi",
    resource: `${BASE}/api/mcp`,
  });
  return fetch(`${BASE}/oauth/authorize/${opts.code}?${q}`, { redirect: "manual" });
}

async function token(params: Record<string, string>) {
  const r = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

async function mcp(credential: string | null, method: string, params?: unknown) {
  const r = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

describe("connecting with the code from the Connect message", () => {
  test("connects that account at once, and the token acts as it", async () => {
    const person = await personWithConnectCode();
    const client = await register();
    expect(client.status).toBe(201);
    expect(client.body.client_secret).toBeUndefined();

    const auth = await authorize(client.body.client_id, { code: person.code });
    expect([302, 303, 307]).toContain(auth.status);
    const back = new URL(auth.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st-1");
    const code = back.searchParams.get("code")!;

    const wrong = await token({ grant_type: "authorization_code", code, client_id: client.body.client_id, redirect_uri: REDIRECT, code_verifier: "not-the-verifier" });
    expect(wrong.body.error).toBe("invalid_grant");

    const ok = await token({ grant_type: "authorization_code", code, client_id: client.body.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(ok.status).toBe(200);
    expect(ok.body.token_type).toBe("Bearer");

    const again = await token({ grant_type: "authorization_code", code, client_id: client.body.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(again.body.error).toBe("invalid_grant");

    const list = await mcp(ok.body.access_token, "tools/call", { name: "list_my_challenges", arguments: {} });
    expect(list.status).toBe(200);
    expect(list.body.result.content[0].text).toContain("read-25-books");

    // The code is spent: it connects nobody else.
    const reuse = await authorize(client.body.client_id, { code: person.code });
    expect(reuse.status).toBe(200);
    expect(await reuse.text()).toContain("already used");
  });

  test("one connect code gives out one token, however many times its link is opened", async () => {
    const person = await personWithConnectCode();
    const client = await register();
    const codes = [];
    for (let i = 0; i < 2; i++) codes.push(new URL((await authorize(client.body.client_id, { code: person.code })).headers.get("location")!).searchParams.get("code")!);
    const trade = (code: string) => token({ grant_type: "authorization_code", code, client_id: client.body.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect((await trade(codes[0])).status).toBe(200);
    expect((await trade(codes[1])).body.error).toBe("invalid_grant");
  });

  test("connecting again replaces the earlier connection, so a leaked link's key can be cut off", async () => {
    const person = await personWithConnectCode();
    const client = await register();
    const connect = async (connectCode: string) => {
      const code = new URL((await authorize(client.body.client_id, { code: connectCode })).headers.get("location")!).searchParams.get("code")!;
      return (await token({ grant_type: "authorization_code", code, client_id: client.body.client_id, redirect_uri: REDIRECT, code_verifier: verifier })).body.access_token as string;
    };
    const first = await connect(person.code);
    const second = await connect(await connectCodeFor(person.cookie));
    expect((await mcp(first, "tools/list")).status).toBe(401);
    expect((await mcp(second, "tools/list")).status).toBe(200);
  });

  test("only Muse's own callbacks can register, so the authorize link can't send anyone elsewhere", async () => {
    const r = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Muse", redirect_uris: ["https://attacker.example/cb"] }),
    });
    expect(r.status).toBe(400);
  });

  test("never sends a code to an address the client didn't register", async () => {
    const person = await personWithConnectCode();
    const client = await register();
    const r = await authorize(client.body.client_id, { code: person.code, redirect: "https://attacker.example/cb" });
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
  });
});
