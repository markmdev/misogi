import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Serves generated images (covers, Virgils, badges) from the data directory. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/media/[...path]">) {
  const { path: parts } = await ctx.params;
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
