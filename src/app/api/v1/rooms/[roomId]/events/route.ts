import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { createCollaborationRunEventResponse } from "@/server/event-stream";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const runId = databaseIdSchema.parse(new URL(request.url).searchParams.get("runId"));
    const lastEventId = request.headers.get("Last-Event-ID")?.trim();
    const afterSequence = lastEventId
      ? z.coerce.number().int().nonnegative().parse(lastEventId)
      : 0;
    const { collaboration } = await getServerRuntime();
    const run = await collaboration.runs.get(runId);
    if (run.roomId !== roomId) throw new Error("Run does not belong to the room");
    return createCollaborationRunEventResponse(
      collaboration.runs,
      runId,
      afterSequence,
      request.signal,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
