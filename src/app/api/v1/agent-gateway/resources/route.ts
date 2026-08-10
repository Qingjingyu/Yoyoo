import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { toPublicAttachment } from "@/server/attachment-service";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  runId: databaseIdSchema,
  originalName: z.string().trim().min(1).max(255),
  declaredMediaType: z.string().trim().min(1).max(255),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new SyntaxError("Idempotency-Key is required");
    }
    const body = bodySchema.parse(await request.json());
    const { attachments, gateway } = await getServerRuntime();
    const session = await gateway.service.authenticate(
      request.headers.get("authorization"),
    );
    const result = await attachments.service.beginAgentOutput({
      ...body,
      principalId: session.principalId,
      idempotencyKey,
    });
    return Response.json(
      {
        duplicate: result.duplicate,
        attachment: toPublicAttachment(result.attachment),
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
