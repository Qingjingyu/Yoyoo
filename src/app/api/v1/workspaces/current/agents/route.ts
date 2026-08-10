import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createAgentSchema = z
  .object({
    handle: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

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
  try {
    const body = createAgentSchema.parse(await request.json());
    const { collaboration, gateway } = await getServerRuntime();
    const created = await gateway.repository.createAgent({
      workspaceId: collaboration.bootstrap.workspace.id,
      actorPrincipalId: collaboration.bootstrap.principal.id,
      handle: body.handle,
      displayName: body.displayName,
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
