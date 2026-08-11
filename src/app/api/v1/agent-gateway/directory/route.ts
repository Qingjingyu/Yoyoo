import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { collaboration, gateway } = await getServerRuntime();
    const session = await gateway.service.authenticate(
      request.headers.get("authorization"),
    );
    const rooms = await collaboration.service.listRooms(
      session.workspaceId,
      session.principalId,
    );
    const directory = await Promise.all(
      rooms.map(async (room) => {
        const details = await collaboration.service.getRoomMembershipDetails({
          roomId: room.id,
          principalId: session.principalId,
        });
        return {
          roomId: room.id,
          workspaceId: room.workspaceId,
          name: room.name,
          purpose: room.purpose,
          kind: room.kind,
          allowedActions: {
            sendMessage: true,
            mentionMembers: true,
            replyToMessage: true,
            continueThread: true,
          },
          members: details.members.map((member) => ({
            principalId: member.principalId,
            kind: member.principalKind,
            displayName: member.displayName,
            role: member.role,
          })),
        };
      }),
    );

    return Response.json({
      self: {
        principalId: session.principalId,
        workspaceId: session.workspaceId,
        handle: session.handle,
        displayName: session.displayName,
      },
      rooms: directory,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
