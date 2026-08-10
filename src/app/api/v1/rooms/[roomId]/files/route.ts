import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  try {
    const { roomId: rawRoomId } = await context.params;
    const roomId = databaseIdSchema.parse(rawRoomId);
    const { collaboration, search } = await getServerRuntime();
    return Response.json(await search.listRoomFiles({
      roomId,
      principalId: collaboration.bootstrap.principal.id,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
