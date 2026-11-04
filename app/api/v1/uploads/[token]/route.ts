import type { NextRequest } from "next/server";
import { errorJson, json, originOf } from "@/lib/server/http";
import { receiveUpload } from "@/lib/server/log-media";
import { finishBeforeExit } from "@/lib/server/unfinished";

export const dynamic = "force-dynamic";

/** Takes one photo or video, sent as the raw request body to a link from get_upload_link. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/v1/uploads/[token]">) {
  try {
    const { token } = await ctx.params;
    return json(await finishBeforeExit(receiveUpload(token, req, originOf(req))), { status: 201 });
  } catch (e) {
    return errorJson(e);
  }
}
