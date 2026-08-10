import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ agentPrincipalId: databaseIdSchema }).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const body = bodySchema.parse(await request.json());
    const { collaboration } = await getServerRuntime();
    const result = await collaboration.service.createDirectRoom({
      workspaceId: collaboration.bootstrap.workspace.id,
      humanPrincipalId: collaboration.bootstrap.principal.id,
      agentPrincipalId: body.agentPrincipalId,
    });
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
