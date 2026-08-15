import { z } from "zod";

import { createAgentAdmissionService } from "@/server/agent-admission-runtime";
import { AgentAdmissionAuthorizationError } from "@/server/agent-admission-service";
import { assertSameOrigin, requireHumanSession } from "@/server/auth/human-auth-http";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  roomIds: z.array(z.uuid()).min(1).max(50),
  permissions: z.array(z.enum([
    "message.read",
    "message.write",
    "attachment.read",
    "attachment.write",
  ])).min(1).max(4),
}).strict();

async function authorization(request: Request) {
  const server = await getServerRuntime();
  if (!server.humanAuth.service || !server.humanAuth.publicOrigin) {
    throw new Error("Agent onboarding requires AI Card authentication");
  }
  const session = await requireHumanSession(request, server.humanAuth.service);
  if (session.principalId !== server.collaboration.bootstrap.principal.id) {
    throw new AgentAdmissionAuthorizationError("当前身份不是这个工作空间的所有者");
  }
  return { server, session };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { server, session } = await authorization(request);
    const invitations = await createAgentAdmissionService(server).listInvitations({
      workspaceId: server.collaboration.bootstrap.workspace.id,
      principalId: session.principalId,
    });
    return Response.json({ invitations }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { server, session } = await authorization(request);
    assertSameOrigin(request, server.humanAuth.publicOrigin!);
    const body = bodySchema.parse(await request.json());
    const accessible = await server.collaboration.service.listRooms(
      server.collaboration.bootstrap.workspace.id,
      session.principalId,
    );
    const byId = new Map(accessible.map((room) => [room.id, room]));
    const rooms = body.roomIds.map((roomId) => {
      const room = byId.get(roomId);
      if (!room) throw new AgentAdmissionAuthorizationError("所选会话不可访问");
      return { id: room.id, name: room.name };
    });
    const invitation = await createAgentAdmissionService(server).createInvitation({
      session,
      workspaceId: server.collaboration.bootstrap.workspace.id,
      displayName: body.displayName,
      rooms,
      permissions: body.permissions,
    });
    return Response.json({ invitation }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
