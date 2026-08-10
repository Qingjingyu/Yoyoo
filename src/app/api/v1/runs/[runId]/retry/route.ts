import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return Response.json(
        {
          error: {
            code: "INVALID_IDEMPOTENCY_KEY",
            message: "Idempotency-Key 请求头不能为空且不能超过 128 个字符。",
          },
        },
        { status: 400 },
      );
    }
    const { service } = await getServerRuntime();
    const retry = await service.retryRun(runId, idempotencyKey);
    return Response.json(retry, { status: retry.duplicate ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
