import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { dataDir } from "@/lib/server/db";
import { toWebp } from "@/lib/server/images";
import { serveLogMedia } from "@/lib/server/log-media";
import { COVER_SM, MASCOT_SM } from "@/lib/shared/art";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const SMALL = new Map([
  ["covers", COVER_SM],
  ["virgils", MASCOT_SM],
]);

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
    const data = await fs.readFile(file).catch((e) => {
      const [kind, name] = path.relative(root, file).split(path.sep);
      const width = /(?<!-sm)-sm\.webp$/.test(name ?? "") ? SMALL.get(kind) : undefined;
      if (!width) throw e;
      return smallCopy(file, width);
    });
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/** Makes a picture's small copy from the full one the first time it's asked for, and keeps it beside it, written whole before it's in place. */
async function smallCopy(file: string, width: number): Promise<Buffer> {
  const data = await toWebp(await fs.readFile(file.replace(/-sm\.webp$/, ".webp")), width);
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, file);
  return data;
}
