import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string() }).strict();

export async function GET(): Promise<Response> {
  try {
    const { collaboration } = await getServerRuntime();
    const rooms = await collaboration.service.listRooms(
      collaboration.bootstrap.workspace.id,
      collaboration.bootstrap.principal.id,
    );
    return Response.json({ rooms }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return Response.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Idempotency-Key 请求头不能为空且不能超过 128 个字符。",
          },
        },
        { status: 400 },
      );
    }
    const body = bodySchema.parse(await request.json());
    const { collaboration } = await getServerRuntime();
    const result = await collaboration.service.createRoom({
      workspaceId: collaboration.bootstrap.workspace.id,
      createdByPrincipalId: collaboration.bootstrap.principal.id,
      name: body.name,
      idempotencyKey,
    });
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
