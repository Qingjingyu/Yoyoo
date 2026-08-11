import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.union([
  z.object({ name: z.string() }).strict(),
  z.object({ purpose: z.string() }).strict(),
  z.object({ status: z.enum(["active", "archived"]) }).strict(),
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const { collaboration } = await getServerRuntime();
    return Response.json(
      await collaboration.service.getSnapshotForMember(
        roomId,
        collaboration.bootstrap.principal.id,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const body = patchSchema.parse(await request.json());
    const { collaboration } = await getServerRuntime();
    const principalId = collaboration.bootstrap.principal.id;
    const room = "name" in body
      ? await collaboration.service.renameRoom({ roomId, principalId, name: body.name })
      : "purpose" in body
        ? await collaboration.service.updateRoomPurpose({
            roomId,
            principalId,
            purpose: body.purpose,
          })
        : await collaboration.service.setRoomStatus({
            roomId,
            principalId,
            status: body.status,
          });
    return Response.json(room);
  } catch (error) {
    return errorResponse(error);
  }
}
