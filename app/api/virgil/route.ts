import { currentUser } from "@/lib/server/auth";
import { runVirgil, threadHistory, type VirgilEvent } from "@/lib/server/ai/virgil";
import { errorJson, json, originOf, rateLimit } from "@/lib/server/http";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

/** Streams Virgil's work as newline-delimited JSON events. */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new AppError("unauthorized", "Sign in first.");
    rateLimit(`virgil:${user.id}`, 10, 6);
    const body = ((await req.json().catch(() => null)) ?? {}) as { message?: unknown; thread?: unknown; challenge?: unknown };
    const thread = (typeof body.thread === "string" && body.thread ? body.thread : "main").slice(0, 80);
    const challenge = typeof body.challenge === "string" ? body.challenge.slice(0, 80) : null;
    const origin = originOf(req);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (e: VirgilEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        try {
          await runVirgil(user, { thread, message: String(body.message ?? ""), challenge, origin }, emit);
        } catch (e) {
          emit({ type: "error", message: e instanceof AppError ? e.message : "Virgil hit a snag. Try again." });
          if (!(e instanceof AppError)) console.error("[virgil]", e);
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (e) {
    return errorJson(e);
  }
}

/** Past messages in a thread, for when the drawer opens. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return json({ messages: [] });
  const thread = (new URL(req.url).searchParams.get("thread") || "main").slice(0, 80);
  return json({ messages: threadHistory(user.id, thread, 40) });
}
