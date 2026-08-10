import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addMemberSchema = z
  .object({ principalId: databaseIdSchema })
  .strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const { collaboration } = await getServerRuntime();
    return Response.json(
      await collaboration.service.getRoomMembershipDetails({
        roomId,
        principalId: collaboration.bootstrap.principal.id,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId } = await context.params;
    const body = addMemberSchema.parse(await request.json());
    const { collaboration } = await getServerRuntime();
    const member = await collaboration.service.addRoomMember({
      roomId,
      actorPrincipalId: collaboration.bootstrap.principal.id,
      memberPrincipalId: body.principalId,
    });
    return Response.json({ member });
  } catch (error) {
    return errorResponse(error);
  }
}
