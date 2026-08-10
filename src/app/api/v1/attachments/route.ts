import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";
import { toPublicAttachment } from "@/server/attachment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  originalName: z.string().min(1).max(255),
  declaredMediaType: z.string().min(1).max(255),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return Response.json(
        { error: { code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key 无效。" } },
        { status: 400 },
      );
    }
    const body = bodySchema.parse(await request.json());
    const { attachments, collaboration } = await getServerRuntime();
    const result = await attachments.service.beginUpload({
      workspaceId: collaboration.bootstrap.workspace.id,
      principalId: collaboration.bootstrap.principal.id,
      idempotencyKey,
      ...body,
    });
    return Response.json(
      { duplicate: result.duplicate, attachment: toPublicAttachment(result.attachment) },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
