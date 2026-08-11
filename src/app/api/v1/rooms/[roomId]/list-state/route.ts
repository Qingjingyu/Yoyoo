import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ action: z.enum(["pin", "unpin", "hide", "show"]) })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const { collaboration } = await getServerRuntime();
    const memberState = await collaboration.service.updateRoomListState({
      roomId,
      principalId: collaboration.bootstrap.principal.id,
      action: body.action,
    });
    return Response.json({ memberState });
  } catch (error) {
    return errorResponse(error);
  }
}
