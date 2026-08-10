import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";
import { toPublicAttachment } from "@/server/attachment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestBody(request: Request): AsyncIterable<Uint8Array> {
  if (!request.body) throw new SyntaxError("Attachment body is required");
  const reader = request.body.getReader();
  return (async function* read() {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      reader.releaseLock();
    }
  })();
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  try {
    const { attachmentId } = await context.params;
    const { attachments, collaboration } = await getServerRuntime();
    const attachment = await attachments.service.completeUpload({
      attachmentId,
      principalId: collaboration.bootstrap.principal.id,
      source: requestBody(request),
    });
    return Response.json({ attachment: toPublicAttachment(attachment) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  try {
    const { attachmentId } = await context.params;
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (!roomId) throw new SyntaxError("roomId is required");
    const { attachments, collaboration } = await getServerRuntime();
    return Response.json({
      attachment: await attachments.service.getMetadataForRoomMember({
        attachmentId,
        roomId,
        principalId: collaboration.bootstrap.principal.id,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
