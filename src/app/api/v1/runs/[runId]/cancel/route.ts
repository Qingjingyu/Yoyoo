import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await context.params;
    const { service } = await getServerRuntime();
    await service.cancelRun(runId);
    return Response.json({ runId, status: "stopping" }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
