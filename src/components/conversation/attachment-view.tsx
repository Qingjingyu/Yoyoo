"use client";

import { Download, FileArchive, FileText } from "lucide-react";
import Image from "next/image";

import type { LinkedAttachmentMetadata } from "@/domain/collaboration";

function contentUrl(roomId: string, attachmentId: string): string {
  return `/api/v1/attachments/${encodeURIComponent(attachmentId)}/content?roomId=${encodeURIComponent(roomId)}`;
}

function fileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function AttachmentView({ attachments }: { attachments: LinkedAttachmentMetadata[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="message-attachments" aria-label="消息附件">
      {attachments.map((attachment) => {
        const mediaType = attachment.detectedMediaType ?? attachment.declaredMediaType;
        const url = contentUrl(attachment.roomId, attachment.id);
        if (mediaType.startsWith("image/")) {
          return (
            <a className="message-attachment message-attachment--image" href={url} key={attachment.id} target="_blank">
              <Image
                alt={attachment.originalName}
                height={240}
                src={url}
                unoptimized
                width={360}
              />
              <span>{attachment.originalName}</span>
            </a>
          );
        }
        const previewable = mediaType === "application/pdf" || mediaType.startsWith("text/");
        return (
          <div className="message-attachment" key={attachment.id}>
            {mediaType === "application/zip" ? (
              <FileArchive aria-hidden="true" size={18} strokeWidth={1.5} />
            ) : (
              <FileText aria-hidden="true" size={18} strokeWidth={1.5} />
            )}
            <span>
              <strong title={attachment.originalName}>{attachment.originalName}</strong>
              <small>{fileSize(attachment.sizeBytes)}</small>
            </span>
            <a
              aria-label={`${previewable ? "预览" : "下载"} ${attachment.originalName}`}
              download={previewable ? undefined : attachment.originalName}
              href={url}
              target={previewable ? "_blank" : undefined}
            >
              {previewable ? <FileText aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}
            </a>
          </div>
        );
      })}
    </div>
  );
}
