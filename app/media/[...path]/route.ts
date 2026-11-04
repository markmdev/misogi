import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { dataDir } from "@/lib/server/db";
import { serveLogMedia } from "@/lib/server/log-media";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Serves generated images (covers, Virgils, badges) from the data directory, and people's photos and videos on logs from storage. */
export async function GET(req: NextRequest, ctx: RouteContext<"/media/[...path]">) {
  const { path: parts } = await ctx.params;
  if (parts[0] === "logs") {
    if (parts.length !== 3) return new Response("Not found", { status: 404 });
    return serveLogMedia(parts[1], parts[2], req.headers.get("range"));
  }
  const root = path.join(dataDir(), "media");
  const file = path.normalize(path.join(root, ...parts));
  if (!file.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
