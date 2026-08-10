import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ roomId: string; principalId: string }> },
): Promise<Response> {
  try {
    const { roomId, principalId } = await context.params;
    const { collaboration } = await getServerRuntime();
    const member = await collaboration.service.removeRoomMember({
      roomId,
      actorPrincipalId: collaboration.bootstrap.principal.id,
      memberPrincipalId: principalId,
    });
    return Response.json({ member });
  } catch (error) {
    return errorResponse(error);
  }
}
