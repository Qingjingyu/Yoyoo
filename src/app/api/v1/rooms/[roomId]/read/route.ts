import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    lastReadMessageId: databaseIdSchema.optional(),
    readingMessageId: databaseIdSchema.optional(),
  })
  .strict()
  .refine((body) => body.lastReadMessageId || body.readingMessageId, {
    message: "A read cursor or reading position is required",
  });

export async function PUT(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const [{ roomId }, body, { collaboration }] = await Promise.all([
      context.params,
      request.json().then((value) => bodySchema.parse(value)),
      getServerRuntime(),
    ]);
    const memberState = await collaboration.service.updateReadState({
      roomId,
      principalId: collaboration.bootstrap.principal.id,
      ...body,
    });
    return Response.json({ memberState });
  } catch (error) {
    return errorResponse(error);
  }
}
