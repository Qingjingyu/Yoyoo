import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    content: z.string().trim().min(1).max(32_000),
    mentionedPrincipalIds: z.array(databaseIdSchema).max(50).default([]),
    replyToMessageId: databaseIdSchema.nullable().optional(),
    threadRootMessageId: databaseIdSchema.nullable().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
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
    const { roomId: rawRoomId } = await context.params;
    const roomId = databaseIdSchema.parse(rawRoomId);
    const body = bodySchema.parse(await request.json());
    const { collaboration, gateway } = await getServerRuntime();
    const session = await gateway.service.authenticate(
      request.headers.get("authorization"),
    );
    await collaboration.service.getRoomMembershipDetails({
      roomId,
      principalId: session.principalId,
    });
    const submission = await collaboration.service.submitMessage({
      roomId,
      senderPrincipalId: session.principalId,
      idempotencyKey,
      content: body.content,
      mentionedPrincipalIds: body.mentionedPrincipalIds,
      attachmentIds: [],
      replyToMessageId: body.replyToMessageId,
      threadRootMessageId: body.threadRootMessageId,
    });
    return Response.json(submission, {
      status: submission.duplicate ? 200 : 202,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
