import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string; runId: string }> },
): Promise<Response> {
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return Response.json(
      { error: { code: "INVALID_IDEMPOTENCY_KEY", message: "重试请求缺少幂等键。" } },
      { status: 400 },
    );
  }
  try {
    const { roomId, runId } = await context.params;
    const { collaboration } = await getServerRuntime();
    const original = await collaboration.runs.get(runId);
    if (original.roomId !== roomId) throw new Error("Run does not belong to the room");
    const retry = await collaboration.service.retryRun({ runId, idempotencyKey });
    return Response.json(retry, { status: retry.duplicate ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
