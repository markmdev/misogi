// OAuth 2.0 for agents: authorization code with PKCE, public clients by dynamic registration. Muse keeps a
// site's credential only in its own vault, filled by the person signing in, so Misogi signs Muse in rather than
// handing it a key in chat. The token it gets is an ordinary agent key, tied to the client that asked.
//
// The connect code names the account: the Connect page puts it in the message the person pastes, and the
// authorize step that carries it connects that account with no browser session, so Muse on a phone works too.
// It's signed, not stored: good for today and tomorrow, and once an agent connects with it every copy stops working.

import crypto from "node:crypto";
import { createApiKey, sign, type UserRow } from "./auth";
import { one, run, tx } from "./db";
import { id, nowIso, randomToken, sha256 } from "./util";

const GRANT_MINUTES = 10;
const MAX_REDIRECTS = 5;
const MAX_REDIRECT_LENGTH = 512;
/** Muse's own sign-in callbacks. Nothing else gets a code, so Misogi's authorize link can't send anyone elsewhere. */
const REDIRECT_HOSTS = /(^|\.)(meta\.ai|meta\.com|muse\.ai)$/;

export class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
  ) {
    super(description);
  }
  json() {
    return Response.json({ error: this.error, error_description: this.description }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

// ---------- Clients (RFC 7591) ----------

function validRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > MAX_REDIRECT_LENGTH) return false;
  try {
    const u = new URL(uri);
    return u.protocol === "https:" && !u.hash && REDIRECT_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS || !uris.every(validRedirect)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be Muse's https sign-in callbacks.");
  }
  const name = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 80) : "";
  const clientId = id("cli");
  run("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)", clientId, name, JSON.stringify(uris), nowIso());
  return {
    client_id: clientId,
    client_name: name || undefined,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };
}

// ---------- Connect codes ----------

const ID_PART = 12;
const today = () => Math.floor(Date.now() / 86_400_000);
const mac = (userId: string, epoch: number, day: number) => sign(`connect.${userId}.${epoch}.${day}`).slice(0, 16);

/** The code for this person's Connect message: their id, signed with the day and how many times they've connected. */
export function connectCode(user: Pick<UserRow, "id" | "connect_epoch">): string {
  return `${user.id.slice(-ID_PART)}${mac(user.id, user.connect_epoch, today())}`;
}

/** Whose code this is, and whether an agent already connected with it. */
export function connectCodeOwner(code: string): { user: UserRow; used: boolean } | null {
  const user = one<UserRow>("SELECT * FROM users WHERE id = ?", `usr_${code.slice(0, ID_PART)}`);
  if (!user) return null;
  const given = Buffer.from(code.slice(ID_PART));
  const matches = (epoch: number) =>
    [today(), today() - 1].some((day) => {
      const expected = Buffer.from(mac(user.id, epoch, day));
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
  if (matches(user.connect_epoch)) return { user, used: false };
  for (let e = 0; e < user.connect_epoch; e++) if (matches(e)) return { user, used: true };
  return null;
}

// ---------- Authorize ----------

/**
 * Approves an authorize request for the connect code's account and returns where to send the browser. Throws a
 * plain Error when the client or its redirect can't be trusted (show it, don't redirect); otherwise problems go
 * back to the client as an error redirect, per RFC 6749 §4.1.2.1.
 */
export function authorize(params: URLSearchParams, user: UserRow): string {
  const client = one<{ id: string; redirect_uris: string }>("SELECT id, redirect_uris FROM oauth_clients WHERE id = ?", params.get("client_id") ?? "");
  if (!client) throw new Error("This connection request names an app Misogi doesn't know. Start connecting again from your AI.");
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) throw new Error("This connection request doesn't return to the address its app registered.");
  const state = params.get("state");
  const back = (q: Record<string, string>) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries({ ...q, ...(state ? { state } : {}) })) u.searchParams.set(k, v);
    return u.toString();
  };

  const challenge = params.get("code_challenge");
  if (!challenge || params.get("code_challenge_method") !== "S256") return back({ error: "invalid_request", error_description: "Send a PKCE code_challenge with code_challenge_method S256." });

  const code = randomToken(24);
  run("DELETE FROM oauth_grants WHERE expires_at < ?", nowIso());
  run(
    `INSERT INTO oauth_grants (code_hash, client_id, user_id, connect_epoch, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sha256(code),
    client.id,
    user.id,
    user.connect_epoch,
    redirectUri,
    challenge,
    new Date(Date.now() + GRANT_MINUTES * 60_000).toISOString(),
  );
  return back({ code });
}

// ---------- Token ----------

/** Trades an authorization code for an agent key that replaces any earlier connection, and spends the person's connect code. */
export function exchangeCode(form: URLSearchParams) {
  if (form.get("grant_type") !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported.");
  const code = form.get("code") ?? "";
  return tx(() => {
    const grant = one<{ user_id: string; client_id: string; connect_epoch: number; redirect_uri: string; code_challenge: string; expires_at: string; used_at: string | null }>(
      "SELECT * FROM oauth_grants WHERE code_hash = ?",
      sha256(code),
    );
    if (!grant || grant.used_at || grant.expires_at < nowIso() || grant.client_id !== form.get("client_id")) {
      throw new OAuthError("invalid_grant", "This authorization code isn't valid. Start connecting again.");
    }
    if (form.get("redirect_uri") !== grant.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorize request.");
    const computed = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
    if (computed !== grant.code_challenge) throw new OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge.");
    run("UPDATE oauth_grants SET used_at = ? WHERE code_hash = ?", nowIso(), sha256(code));
    const spent = run("UPDATE users SET connect_epoch = connect_epoch + 1 WHERE id = ? AND connect_epoch = ?", grant.user_id, grant.connect_epoch);
    if (spent.changes === 0) throw new OAuthError("invalid_grant", "This connect link was already used. Copy a fresh message from Misogi's Connect page.");
    run("UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND client_id IS NOT NULL AND revoked_at IS NULL", nowIso(), grant.user_id);
    return { access_token: createApiKey(grant.user_id, grant.client_id).key, token_type: "Bearer" };
  });
}
