import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ content: z.string().trim().min(1).max(32_000) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string; runId: string }> },
): Promise<Response> {
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return Response.json(
      { error: { code: "INVALID_IDEMPOTENCY_KEY", message: "干预请求缺少幂等键。" } },
      { status: 400 },
    );
  }
  try {
    const { roomId, runId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const { collaboration } = await getServerRuntime();
    const run = await collaboration.runs.get(runId);
    if (run.roomId !== roomId) throw new Error("Run does not belong to the room");
    const message = await collaboration.service.interveneAndStop({
      runId,
      senderPrincipalId: collaboration.bootstrap.principal.id,
      content: body.content,
      idempotencyKey,
    });
    return Response.json({ message, runId, status: "stopping" }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
