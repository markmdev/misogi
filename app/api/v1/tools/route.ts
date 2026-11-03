import { json } from "@/lib/server/http";
import { toolSchemas } from "@/lib/server/tools";

export const dynamic = "force-dynamic";

/** Lists every tool with its JSON Schema. No key needed. */
export function GET() {
  return json({
    tools: toolSchemas(),
    usage: "POST /api/v1/tools/<name> with a JSON body and `Authorization: Bearer <misogi key>`.",
  });
}
