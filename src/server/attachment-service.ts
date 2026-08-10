import { createHash } from "node:crypto";

import type {
  AttachmentRecord,
  LinkedAttachmentRecord,
} from "@/domain/collaboration";
import {
  BlobLimitExceededError,
  type BlobReadRange,
  type BlobReadResult,
  type BlobStore,
} from "@/server/blob-store";
import {
  AttachmentConflictError,
  AttachmentPermissionError,
  AttachmentRepository,
} from "@/server/postgres/attachment-repository";

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_PENDING_LIFETIME_MS = 60 * 60 * 1000;
const DEFAULT_FAILED_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PROBE_BYTES = 8192;

const blockedMediaTypes = new Set([
  "application/x-dosexec",
  "application/x-executable",
  "application/x-mach-binary",
  "application/x-msdownload",
  "application/x-sharedlib",
  "application/x-shellscript",
]);

const executableExtensions = new Set([
  "app",
  "bat",
  "cmd",
  "com",
  "dll",
  "dmg",
  "exe",
  "js",
  "jse",
  "msi",
  "pkg",
  "ps1",
  "scr",
  "sh",
  "vbs",
]);

export interface AttachmentServiceOptions {
  maxFileBytes?: number;
  pendingLifetimeMs?: number;
  failedLifetimeMs?: number;
  now?: () => Date;
}

export type PublicAttachment = Omit<AttachmentRecord, "objectKey">;
export type PublicLinkedAttachment = Omit<LinkedAttachmentRecord, "objectKey">;

export interface AuthorizedAttachmentContent {
  attachment: PublicLinkedAttachment;
  content: BlobReadResult;
}

export interface AuthorizedAgentAttachmentContent {
  attachment: PublicAttachment;
  content: BlobReadResult;
}

export class InvalidAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAttachmentError";
  }
}

export class BlockedAttachmentTypeError extends Error {
  constructor() {
    super("Executable attachment content is not allowed");
    this.name = "BlockedAttachmentTypeError";
  }
}

export class AttachmentMediaMismatchError extends Error {
  constructor() {
    super("Declared attachment type does not match its content");
    this.name = "AttachmentMediaMismatchError";
  }
}

function safeInteger(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new RangeError("Attachment limits must be positive safe integers");
  }
  return selected;
}

function normalizeFilename(value: string): string {
  const filename = value.trim();
  if (!filename || filename.length > 255 || /[\\/]/u.test(filename)) {
    throw new InvalidAttachmentError("Attachment filename is invalid");
  }
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (executableExtensions.has(extension)) throw new BlockedAttachmentTypeError();
  return filename;
}

function normalizeMediaType(value: string): string {
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  if (!mediaType || mediaType.length > 255 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)) {
    throw new InvalidAttachmentError("Declared media type is invalid");
  }
  if (blockedMediaTypes.has(mediaType)) throw new BlockedAttachmentTypeError();
  return mediaType;
}

function startsWith(probe: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => probe[index] === value);
}

function isProbablyText(probe: Buffer): boolean {
  if (probe.includes(0)) return false;
  return !Buffer.from(probe.toString("utf8"), "utf8").includes(0xefbfbd);
}

function detectMediaType(probe: Buffer, declaredMediaType: string): string {
  if (startsWith(probe, [0x4d, 0x5a])) throw new BlockedAttachmentTypeError();
  if (startsWith(probe, [0x7f, 0x45, 0x4c, 0x46])) throw new BlockedAttachmentTypeError();
  if (
    startsWith(probe, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(probe, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(probe, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(probe, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    throw new BlockedAttachmentTypeError();
  }
  if (startsWith(probe, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(probe, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (probe.subarray(0, 6).toString("ascii") === "GIF87a" || probe.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (probe.subarray(0, 4).toString("ascii") === "RIFF" && probe.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (probe.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (startsWith(probe, [0x50, 0x4b, 0x03, 0x04])) {
    return declaredMediaType.includes("officedocument")
      ? declaredMediaType
      : "application/zip";
  }
  if (isProbablyText(probe)) {
    return declaredMediaType === "text/markdown" ? "text/markdown" : "text/plain";
  }
  return "application/octet-stream";
}

function assertMediaTypeMatches(declared: string, detected: string): void {
  if (declared === "application/octet-stream" || declared === detected) return;
  if (declared.startsWith("text/") && detected.startsWith("text/")) return;
  throw new AttachmentMediaMismatchError();
}

function probingSource(
  source: AsyncIterable<Uint8Array>,
  probe: Buffer[],
): AsyncIterable<Uint8Array> {
  return (async function* stream() {
    let remaining = PROBE_BYTES;
    for await (const value of source) {
      const chunk = Buffer.from(value);
      if (remaining > 0 && chunk.byteLength > 0) {
        const selected = chunk.subarray(0, remaining);
        probe.push(selected);
        remaining -= selected.byteLength;
      }
      yield chunk;
    }
  })();
}

export function toPublicAttachment<T extends AttachmentRecord>(
  attachment: T,
): Omit<T, "objectKey"> {
  const { objectKey, ...publicAttachment } = attachment;
  void objectKey;
  return publicAttachment;
}

export class AttachmentService {
  private readonly maxFileBytes: number;
  private readonly pendingLifetimeMs: number;
  private readonly failedLifetimeMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly blobs: BlobStore,
    options: AttachmentServiceOptions = {},
  ) {
    this.maxFileBytes = safeInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    this.pendingLifetimeMs = safeInteger(
      options.pendingLifetimeMs,
      DEFAULT_PENDING_LIFETIME_MS,
    );
    this.failedLifetimeMs = safeInteger(
      options.failedLifetimeMs,
      DEFAULT_FAILED_LIFETIME_MS,
    );
    this.now = options.now ?? (() => new Date());
  }

  async beginUpload(input: {
    workspaceId: string;
    principalId: string;
    idempotencyKey: string;
    originalName: string;
    declaredMediaType: string;
  }): Promise<{ duplicate: boolean; attachment: AttachmentRecord }> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new InvalidAttachmentError("Upload idempotency key is invalid");
    }
    const filename = normalizeFilename(input.originalName);
    const mediaType = normalizeMediaType(input.declaredMediaType);
    const digest = createHash("sha256")
      .update(input.workspaceId)
      .update("\0")
      .update(input.principalId)
      .update("\0")
      .update(idempotencyKey)
      .digest("hex");
    const now = this.now();
    return this.repository.createPending({
      workspaceId: input.workspaceId,
      uploaderPrincipalId: input.principalId,
      objectKey: `${digest.slice(0, 2)}/${digest}`,
      originalName: filename,
      declaredMediaType: mediaType,
      expiresAt: new Date(now.getTime() + this.pendingLifetimeMs),
    });
  }

  async beginAgentOutput(input: {
    runId: string;
    principalId: string;
    idempotencyKey: string;
    originalName: string;
    declaredMediaType: string;
  }): Promise<{ duplicate: boolean; attachment: AttachmentRecord }> {
    const scope = await this.repository.getAgentOutputScope({
      runId: input.runId,
      principalId: input.principalId,
    });
    if (!scope) throw new AttachmentPermissionError();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new InvalidAttachmentError("Upload idempotency key is invalid");
    }
    const filename = normalizeFilename(input.originalName);
    const mediaType = normalizeMediaType(input.declaredMediaType);
    const digest = createHash("sha256")
      .update("agent-output\0")
      .update(input.runId)
      .update("\0")
      .update(input.principalId)
      .update("\0")
      .update(idempotencyKey)
      .digest("hex");
    const now = this.now();
    return this.repository.createPending({
      workspaceId: scope.workspaceId,
      uploaderPrincipalId: input.principalId,
      objectKey: `${digest.slice(0, 2)}/${digest}`,
      originalName: filename,
      declaredMediaType: mediaType,
      expiresAt: new Date(now.getTime() + this.pendingLifetimeMs),
      provenance: "agent_output",
      sourceRunId: input.runId,
    });
  }

  async completeUpload(input: {
    attachmentId: string;
    principalId: string;
    source: AsyncIterable<Uint8Array>;
  }): Promise<AttachmentRecord> {
    const attachment = await this.repository.getById(input.attachmentId);
    if (!attachment) throw new AttachmentConflictError("Attachment not found");
    if (attachment.uploaderPrincipalId !== input.principalId) {
      throw new AttachmentPermissionError(
        "Attachment is not owned by the current principal",
      );
    }
    if (attachment.status === "ready") return attachment;
    if (attachment.status !== "pending") {
      throw new AttachmentConflictError("Attachment is not pending");
    }

    const probe: Buffer[] = [];
    try {
      const written = await this.blobs.write({
        objectKey: attachment.objectKey,
        source: probingSource(input.source, probe),
        maxBytes: this.maxFileBytes,
      });
      const detectedMediaType = detectMediaType(
        Buffer.concat(probe),
        attachment.declaredMediaType,
      );
      assertMediaTypeMatches(attachment.declaredMediaType, detectedMediaType);
      return await this.repository.markReady({
        attachmentId: attachment.id,
        principalId: input.principalId,
        detectedMediaType,
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
      });
    } catch (error) {
      await this.blobs.delete(attachment.objectKey);
      const errorCode = error instanceof BlobLimitExceededError
        ? "size_limit_exceeded"
        : error instanceof BlockedAttachmentTypeError
          ? "blocked_media_type"
          : error instanceof AttachmentMediaMismatchError
            ? "media_type_mismatch"
          : "upload_failed";
      await this.repository.markFailed({
        attachmentId: attachment.id,
        principalId: input.principalId,
        errorCode,
        expiresAt: new Date(this.now().getTime() + this.failedLifetimeMs),
      });
      throw error;
    }
  }

  async cleanupExpired(now = this.now()): Promise<number> {
    const expired = await this.repository.listExpiredUnlinked(now);
    let cleaned = 0;
    for (const attachment of expired) {
      await this.blobs.delete(attachment.objectKey);
      await this.repository.deleteExpiredUnlinked(attachment.id, now);
      cleaned += 1;
    }
    return cleaned;
  }

  async openForRoomMember(input: {
    attachmentId: string;
    roomId: string;
    principalId: string;
    range?: Partial<BlobReadRange>;
  }): Promise<AuthorizedAttachmentContent> {
    const attachment = await this.repository.getForRoomMember(input);
    if (!attachment) throw new AttachmentPermissionError();
    return {
      attachment: toPublicAttachment(attachment),
      content: await this.blobs.open(attachment.objectKey, input.range),
    };
  }

  async getMetadataForRoomMember(input: {
    attachmentId: string;
    roomId: string;
    principalId: string;
  }): Promise<PublicLinkedAttachment> {
    const attachment = await this.repository.getForRoomMember(input);
    if (!attachment) throw new AttachmentPermissionError();
    return toPublicAttachment(attachment);
  }

  async openForAgent(input: {
    attachmentId: string;
    runId: string;
    principalId: string;
    range?: Partial<BlobReadRange>;
  }): Promise<AuthorizedAgentAttachmentContent> {
    const attachment = await this.repository.getGrantedAttachmentByScope({
      attachmentId: input.attachmentId,
      runId: input.runId,
      principalId: input.principalId,
      now: this.now(),
    });
    if (!attachment) throw new AttachmentPermissionError();
    return {
      attachment: toPublicAttachment(attachment),
      content: await this.blobs.open(attachment.objectKey, input.range),
    };
  }

  async getMetadataForAgent(input: {
    attachmentId: string;
    runId: string;
    principalId: string;
  }): Promise<PublicAttachment> {
    const attachment = await this.repository.getGrantedAttachmentByScope({
      ...input,
      now: this.now(),
    });
    if (!attachment) throw new AttachmentPermissionError();
    return toPublicAttachment(attachment);
  }
}
