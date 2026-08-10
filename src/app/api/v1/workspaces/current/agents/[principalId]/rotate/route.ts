import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
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
    const { collaboration, gateway } = await getServerRuntime();
    return Response.json(
      await gateway.repository.rotateCredential({
        workspaceId: collaboration.bootstrap.workspace.id,
        actorPrincipalId: collaboration.bootstrap.principal.id,
        principalId,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
