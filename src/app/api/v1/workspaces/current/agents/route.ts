import { errorResponse } from "@/server/http-response";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { collaboration, gateway, pool } = await getServerRuntime();
    const gatewayAgents = await gateway.repository.listAgents({
      workspaceId: collaboration.bootstrap.workspace.id,
      actorPrincipalId: collaboration.bootstrap.principal.id,
    });
    const cardAgents = await new PrincipalRepository(pool).listAICardAgents(
      collaboration.bootstrap.workspace.id,
    );
    const agents = [
      ...gatewayAgents.map((agent) => ({
        ...agent,
        cardId: null,
        machineName: null,
        authenticationMode: "gateway_token" as const,
      })),
      ...cardAgents,
    ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return Response.json({ agents });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  void request;
  return Response.json(
    {
      error: {
        code: "AI_CARD_REQUIRED",
        message: "新的 AI 必须先拥有 AI Card，再由你授权接入当前空间。",
      },
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
