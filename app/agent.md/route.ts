import { agentGuide } from "@/lib/server/agent-guide";
import { originOf } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(agentGuide(originOf(req)), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" },
  });
}
