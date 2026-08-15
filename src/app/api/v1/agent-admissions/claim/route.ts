import { z } from "zod";

import { createAgentAdmissionService } from "@/server/agent-admission-runtime";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  invitationId: z.uuid(),
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  claimId: z.uuid(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.match(/^Bearer (at_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!accessToken) {
      return Response.json(
        { error: { code: "AGENT_UNAUTHENTICATED", message: "需要有效的 AI Card Agent 运行时令牌。" } },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      );
    }
    const body = bodySchema.parse(await request.json());
    const server = await getServerRuntime();
    const admission = await createAgentAdmissionService(server).claim({
      ...body,
      accessToken,
    });
    return Response.json({ admission }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
