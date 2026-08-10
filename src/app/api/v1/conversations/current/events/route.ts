import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { createRunEventResponse } from "@/server/event-stream";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const runId = databaseIdSchema.parse(new URL(request.url).searchParams.get("runId"));
    const lastEventId = request.headers.get("Last-Event-ID")?.trim();
    const afterSequence = lastEventId
      ? z.coerce.number().int().nonnegative().parse(lastEventId)
      : 0;
    const { runs } = await getServerRuntime();
    await runs.get(runId);
    return createRunEventResponse(runs, runId, afterSequence, request.signal);
  } catch (error) {
    return errorResponse(error);
  }
}
