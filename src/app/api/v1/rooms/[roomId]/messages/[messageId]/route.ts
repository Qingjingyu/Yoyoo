import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editBodySchema = z
  .object({
    content: z.string().trim().max(32_000),
    expectedRevisionNumber: z.number().int().positive(),
  })
  .strict();

const retractBodySchema = z
  .object({ expectedRevisionNumber: z.number().int().positive() })
  .strict();

interface MessageRouteContext {
  params: Promise<{ roomId: string; messageId: string }>;
}

export async function PATCH(
  request: Request,
  context: MessageRouteContext,
): Promise<Response> {
  try {
    const [{ roomId, messageId }, body, { collaboration }] = await Promise.all([
      context.params,
      request.json().then((value) => editBodySchema.parse(value)),
      getServerRuntime(),
    ]);
    const message = await collaboration.service.editMessage({
      roomId,
      messageId,
      actorPrincipalId: collaboration.bootstrap.principal.id,
      ...body,
    });
    return Response.json({ message });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: MessageRouteContext,
): Promise<Response> {
  try {
    const [{ roomId, messageId }, body, { collaboration }] = await Promise.all([
      context.params,
      request.json().then((value) => retractBodySchema.parse(value)),
      getServerRuntime(),
    ]);
    const message = await collaboration.service.retractMessage({
      roomId,
      messageId,
      actorPrincipalId: collaboration.bootstrap.principal.id,
      ...body,
    });
    return Response.json({ message });
  } catch (error) {
    return errorResponse(error);
  }
}
