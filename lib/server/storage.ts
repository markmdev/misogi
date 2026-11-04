// People's photos and videos live in a private S3 bucket and are served through Misogi's own origin, so the
// sandboxed pages and the site load them like any other image. Requests are signed with AWS Signature V4.
//   S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION (default us-east-1)

import crypto from "node:crypto";
import { AppError } from "./util";

function config() {
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !accessKey || !secretKey) throw new AppError("resting", "Photo storage isn't set up on this server.");
  const region = process.env.AWS_REGION || "us-east-1";
  return { bucket, accessKey, secretKey, region, host: `${bucket}.s3.${region}.amazonaws.com` };
}

const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const hex = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");

function signed(method: "GET" | "PUT" | "DELETE", key: string, headers: Record<string, string>, payloadHash: string) {
  const { accessKey, secretKey, region, host } = config();
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const path = "/" + key.split("/").map(encodeURIComponent).join("/");
  const all: Record<string, string> = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonical = [method, path, "", ...names.map((n) => `${n}:${lower[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), "s3"), "aws4_request");
  const signature = hmac(signingKey, toSign).toString("hex");
  // fetch sets Host from the URL itself.
  const sent = Object.fromEntries(Object.entries(all).filter(([k]) => k !== "host"));
  return {
    url: `https://${host}${path}`,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
  };
}

async function send(method: "GET" | "PUT" | "DELETE", key: string, init: { headers?: Record<string, string>; body?: Buffer; range?: string | null }) {
  // S3 takes an unhashed body over HTTPS, which spares hashing a 100 MB video on the request's thread.
  const { url, headers } = signed(method, key, init.headers ?? {}, init.body ? "UNSIGNED-PAYLOAD" : hex(""));
  return fetch(url, {
    method,
    headers: { ...headers, ...(init.range ? { range: init.range } : {}) },
    body: init.body as unknown as BodyInit | undefined,
  }).catch(() => {
    throw new AppError("resting", "Couldn't reach photo storage. Try again.");
  });
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await send("PUT", key, { headers: { "content-type": contentType }, body });
  if (!res.ok) {
    console.error(`[storage] PUT ${key} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new AppError("resting", "Couldn't save the file. Try again.");
  }
}

/** The object's response, passing a browser's Range through so a video can seek. */
export async function getObject(key: string, range: string | null): Promise<Response> {
  return send("GET", key, { range });
}

export async function deleteObject(key: string): Promise<void> {
  const res = await send("DELETE", key, {});
  if (!res.ok) console.error(`[storage] DELETE ${key} ${res.status}`);
}
