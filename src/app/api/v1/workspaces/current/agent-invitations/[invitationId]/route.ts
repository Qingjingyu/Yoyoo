import { z } from "zod";

import { createAgentAdmissionService } from "@/server/agent-admission-runtime";
import { assertSameOrigin, requireHumanSession } from "@/server/auth/human-auth-http";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
): Promise<Response> {
  try {
    const server = await getServerRuntime();
    if (!server.humanAuth.service || !server.humanAuth.publicOrigin) {
      throw new Error("Agent onboarding requires AI Card authentication");
    }
    assertSameOrigin(request, server.humanAuth.publicOrigin);
    const session = await requireHumanSession(request, server.humanAuth.service);
    const { invitationId } = await context.params;
    const revoked = await createAgentAdmissionService(server).revokeInvitation({
      invitationId: z.uuid().parse(invitationId),
      workspaceId: server.collaboration.bootstrap.workspace.id,
      session,
    });
    return revoked
      ? new Response(null, { status: 204 })
      : Response.json(
          { error: { code: "INVITATION_NOT_PENDING", message: "邀请不存在或已经不能撤销。" } },
          { status: 409 },
        );
  } catch (error) {
    return errorResponse(error);
  }
}
