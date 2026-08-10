import { Readable } from "node:stream";

import { databaseIdSchema } from "@/domain/id";
import { BlobRangeNotSatisfiableError, type BlobReadRange } from "@/server/blob-store";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(value: string | null, sizeBytes: number): Partial<BlobReadRange> {
  if (!value) return {};
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new BlobRangeNotSatisfiableError(sizeBytes);
  }
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new BlobRangeNotSatisfiableError(sizeBytes);
    }
    return { start: Math.max(sizeBytes - suffix, 0), end: sizeBytes - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new BlobRangeNotSatisfiableError(sizeBytes);
  }
  return { start, end };
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/gu, "_").slice(0, 120)
    || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  try {
    const { attachmentId: rawAttachmentId } = await context.params;
    const attachmentId = databaseIdSchema.parse(rawAttachmentId);
    const runId = databaseIdSchema.parse(
      new URL(request.url).searchParams.get("runId"),
    );
    const { attachments, gateway } = await getServerRuntime();
    const session = await gateway.service.authenticate(
      request.headers.get("authorization"),
    );
    const metadata = await attachments.service.getMetadataForAgent({
      attachmentId,
      runId,
      principalId: session.principalId,
    });
    const range = parseRange(request.headers.get("range"), metadata.sizeBytes ?? 0);
    const opened = await attachments.service.openForAgent({
      attachmentId,
      runId,
      principalId: session.principalId,
      range,
    });
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(opened.attachment.originalName),
      "Content-Length": String(opened.content.end - opened.content.start + 1),
      "Content-Type": opened.attachment.detectedMediaType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (opened.content.partial) {
      headers.set(
        "Content-Range",
        `bytes ${opened.content.start}-${opened.content.end}/${opened.content.sizeBytes}`,
      );
    }
    return new Response(Readable.toWeb(opened.content.stream) as BodyInit, {
      status: opened.content.partial ? 206 : 200,
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
