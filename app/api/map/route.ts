import { worldMap } from "@/lib/server/geo";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Everyone who picked a city, with their dressed Muse and the challenges they're climbing. */
export async function GET() {
  return json(worldMap());
}
