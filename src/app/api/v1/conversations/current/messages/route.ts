import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import {
  getLocalOwnerId,
  getServerRuntime,
} from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ content: z.string().trim().min(1).max(1200) }).strict();

export async function POST(request: Request): Promise<Response> {
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

  try {
    const body = bodySchema.parse(await request.json());
    const { agentId, service } = await getServerRuntime();
    const submission = await service.submitMessage({
      ownerId: getLocalOwnerId(),
      agentId,
      content: body.content,
      idempotencyKey,
    });
    return Response.json(submission, { status: submission.duplicate ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
