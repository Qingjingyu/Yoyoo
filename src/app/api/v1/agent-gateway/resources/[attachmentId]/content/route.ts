import { databaseIdSchema } from "@/domain/id";
import { toPublicAttachment } from "@/server/attachment-service";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

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
    const { attachmentId: rawAttachmentId } = await context.params;
    const attachmentId = databaseIdSchema.parse(rawAttachmentId);
    const { attachments, gateway } = await getServerRuntime();
    const session = await gateway.service.authenticate(
      request.headers.get("authorization"),
    );
    const attachment = await attachments.service.completeUpload({
      attachmentId,
      principalId: session.principalId,
      source: requestBody(request),
    });
    return Response.json({ attachment: toPublicAttachment(attachment) });
  } catch (error) {
    return errorResponse(error);
  }
}
