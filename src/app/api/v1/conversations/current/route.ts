import { errorResponse } from "@/server/http-response";
import {
  getLocalOwnerId,
  getServerRuntime,
} from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { agentId, service } = await getServerRuntime();
    const snapshot = await service.getCurrent(getLocalOwnerId(), agentId);
    return Response.json(snapshot);
  } catch (error) {
    return errorResponse(error);
  }
}
