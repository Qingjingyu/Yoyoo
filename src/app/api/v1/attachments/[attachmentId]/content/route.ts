import { Readable } from "node:stream";

import { BlobRangeNotSatisfiableError, type BlobReadRange } from "@/server/blob-store";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(value: string | null, sizeBytes: number): Partial<BlobReadRange> {
  if (!value) return {};
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw new BlobRangeNotSatisfiableError(sizeBytes);
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new BlobRangeNotSatisfiableError(sizeBytes);
    return { start: Math.max(sizeBytes - suffix, 0), end: sizeBytes - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new BlobRangeNotSatisfiableError(sizeBytes);
  }
  return { start, end };
}

function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/gu, "_").slice(0, 120) || "download";
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
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
    const metadata = await attachments.service.getMetadataForRoomMember({
      attachmentId,
      roomId,
      principalId: collaboration.bootstrap.principal.id,
    });
    const range = parseRange(request.headers.get("range"), metadata.sizeBytes ?? 0);
    const opened = await attachments.service.openForRoomMember({
      attachmentId,
      roomId,
      principalId: collaboration.bootstrap.principal.id,
      range,
    });
    const mediaType = opened.attachment.detectedMediaType ?? "application/octet-stream";
    const inline = mediaType.startsWith("image/") || mediaType === "application/pdf" || mediaType.startsWith("text/");
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(opened.attachment.originalName, inline),
      "Content-Length": String(opened.content.end - opened.content.start + 1),
      "Content-Type": mediaType,
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
