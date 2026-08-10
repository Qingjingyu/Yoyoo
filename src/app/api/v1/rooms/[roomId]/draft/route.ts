import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    content: z.string().max(32_000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const { collaboration } = await getServerRuntime();
    const memberState = await collaboration.memberStates.get(
      roomId,
      collaboration.bootstrap.principal.id,
    );
    return Response.json({ memberState });
  } catch (error) {
    return errorResponse(error);
  }
}

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
    const memberState = await collaboration.service.saveDraft({
      roomId,
      principalId: collaboration.bootstrap.principal.id,
      ...body,
    });
    return Response.json({ memberState });
  } catch (error) {
    return errorResponse(error);
  }
}
