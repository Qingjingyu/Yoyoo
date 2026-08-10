import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { gateway } = await getServerRuntime();
    const agent = await gateway.service.heartbeat(
      request.headers.get("authorization"),
    );
    return Response.json({ agent });
  } catch (error) {
    return errorResponse(error);
  }
}
