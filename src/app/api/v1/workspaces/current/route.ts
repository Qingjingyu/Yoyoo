import { errorResponse } from "@/server/http-response";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { collaboration, gateway, pool } = await getServerRuntime();
    const [roomSummaries, gatewayAgents, cardAgents] = await Promise.all([
      collaboration.service.listRoomSummaries(
        collaboration.bootstrap.workspace.id,
        collaboration.bootstrap.principal.id,
      ),
      gateway.repository.listAgents({
        workspaceId: collaboration.bootstrap.workspace.id,
        actorPrincipalId: collaboration.bootstrap.principal.id,
      }),
      new PrincipalRepository(pool).listAICardAgents(
        collaboration.bootstrap.workspace.id,
      ),
    ]);
    return Response.json({
      principal: collaboration.bootstrap.principal,
      workspace: collaboration.bootstrap.workspace,
      rooms: roomSummaries.active,
      archivedRooms: roomSummaries.archived,
      agents: [
        ...collaboration.bootstrap.agents.map(({ principal, binding }) => ({
          principalId: principal.id,
          displayName: principal.displayName,
          adapterId: binding.adapterId,
          capabilities: binding.capabilities,
        })),
        ...[...gatewayAgents, ...cardAgents]
          .filter((agent) => agent.connectionStatus === "connected")
          .map((agent) => ({
            principalId: agent.principalId,
            displayName: agent.displayName,
            adapterId: "yoyoo-agent-gateway",
            capabilities: {
              streaming: false,
              cancellation: false,
              delegation: false,
              artifacts: false,
            },
          })),
      ],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
