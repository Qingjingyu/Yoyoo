import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ principalId: string }> },
): Promise<Response> {
  try {
    const { principalId: rawPrincipalId } = await context.params;
    const principalId = databaseIdSchema.parse(rawPrincipalId);
    const { collaboration, gateway, pool } = await getServerRuntime();
    const principalRepository = new PrincipalRepository(pool);
    const cardAgent = (await principalRepository.listAICardAgents(
      collaboration.bootstrap.workspace.id,
    )).find((candidate) => candidate.principalId === principalId);
    const agent = cardAgent
      ? await principalRepository.revokeAICardAgent({
          workspaceId: collaboration.bootstrap.workspace.id,
          actorPrincipalId: collaboration.bootstrap.principal.id,
          principalId,
        })
      : await gateway.repository.revokeCredential({
          workspaceId: collaboration.bootstrap.workspace.id,
          actorPrincipalId: collaboration.bootstrap.principal.id,
          principalId,
        });
    return Response.json({ agent });
  } catch (error) {
    return errorResponse(error);
  }
}
