/** @vitest-environment node */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AttachmentMediaMismatchError,
  AttachmentService,
  BlockedAttachmentTypeError,
} from "@/server/attachment-service";
import { LocalBlobStore } from "@/server/local-blob-store";
import { AttachmentRepository } from "@/server/postgres/attachment-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { WorkspaceRepository } from "@/server/postgres/workspace-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const pool = createPostgresPool(databaseUrl, { max: 4 });

async function chunks(...values: Uint8Array[]): Promise<AsyncIterable<Uint8Array>> {
  return (async function* source() {
    for (const value of values) yield value;
  })();
}

async function createFixture() {
  const suffix = randomUUID();
  const principals = new PrincipalRepository(pool);
  const workspaces = new WorkspaceRepository(pool);
  const principal = await principals.create({
    kind: "human",
    externalKey: `human:attachment-service-${suffix}`,
    handle: `upload-${suffix.slice(0, 8)}`,
    displayName: "Upload Owner",
  });
  const workspace = await workspaces.create({
    slug: `attachment-service-${suffix}`,
    name: "Attachment Service Test",
    ownerPrincipalId: principal.id,
  });
  const reader = await principals.create({
    kind: "agent",
    externalKey: `agent:attachment-reader-${suffix}`,
    handle: `reader-${suffix.slice(0, 8)}`,
    displayName: "Attachment Reader",
  });
  await workspaces.addMember({ workspaceId: workspace.id, principalId: reader.id, role: "member" });
  const rooms = new RoomRepository(pool);
  const room = await rooms.create({
    workspaceId: workspace.id,
    name: "Attachment Service Room",
    createdByPrincipalId: principal.id,
  });
  await rooms.addMember({
    roomId: room.id,
    principalId: reader.id,
    role: "member",
    listenerPolicy: "mention_only",
  });
  const blobRoot = await mkdtemp(join(tmpdir(), "yoyoo-attachment-service-"));
  const repository = new AttachmentRepository(pool);
  const service = new AttachmentService(repository, new LocalBlobStore(blobRoot), {
    maxFileBytes: 32,
    pendingLifetimeMs: 60_000,
    failedLifetimeMs: 60_000,
  });
  return { blobRoot, principal, reader, repository, room, rooms, service, workspace };
}

describe("AttachmentService", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates an opaque idempotent upload and persists detected metadata", async () => {
    const fixture = await createFixture();
    try {
      const input = {
        workspaceId: fixture.workspace.id,
        principalId: fixture.principal.id,
        idempotencyKey: "same-photo",
        originalName: "天气.png",
        declaredMediaType: "image/png",
      };
      const first = await fixture.service.beginUpload(input);
      const duplicate = await fixture.service.beginUpload(input);

      expect(duplicate).toEqual({ duplicate: true, attachment: first.attachment });
      expect(first.attachment.objectKey).toMatch(/^[a-z0-9]{2}\/[a-z0-9]{64}$/);
      expect(JSON.stringify(first.attachment)).not.toContain(fixture.blobRoot);

      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
      ]);
      const ready = await fixture.service.completeUpload({
        attachmentId: first.attachment.id,
        principalId: fixture.principal.id,
        source: await chunks(png),
      });

      expect(ready).toMatchObject({
        status: "ready",
        detectedMediaType: "image/png",
        sizeBytes: png.byteLength,
      });
      expect(ready.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(fixture.blobRoot, { recursive: true, force: true });
    }
  });

  it("marks oversize and executable uploads failed without retaining bytes", async () => {
    const fixture = await createFixture();
    try {
      const oversize = await fixture.service.beginUpload({
        workspaceId: fixture.workspace.id,
        principalId: fixture.principal.id,
        idempotencyKey: "oversize",
        originalName: "large.txt",
        declaredMediaType: "text/plain",
      });
      await expect(
        fixture.service.completeUpload({
          attachmentId: oversize.attachment.id,
          principalId: fixture.principal.id,
          source: await chunks(Buffer.alloc(33, 0x61)),
        }),
      ).rejects.toMatchObject({ name: "BlobLimitExceededError" });
      await expect(fixture.repository.getById(oversize.attachment.id)).resolves.toMatchObject({
        status: "failed",
        errorCode: "size_limit_exceeded",
      });
      await expect(
        new LocalBlobStore(fixture.blobRoot).stat(oversize.attachment.objectKey),
      ).resolves.toBeNull();

      const executable = await fixture.service.beginUpload({
        workspaceId: fixture.workspace.id,
        principalId: fixture.principal.id,
        idempotencyKey: "executable",
        originalName: "payload.bin",
        declaredMediaType: "application/octet-stream",
      });
      await expect(
        fixture.service.completeUpload({
          attachmentId: executable.attachment.id,
          principalId: fixture.principal.id,
          source: await chunks(Buffer.from([0x4d, 0x5a, 0x90, 0, 1, 2])),
        }),
      ).rejects.toBeInstanceOf(BlockedAttachmentTypeError);
      await expect(fixture.repository.getById(executable.attachment.id)).resolves.toMatchObject({
        status: "failed",
        errorCode: "blocked_media_type",
      });
      await expect(
        new LocalBlobStore(fixture.blobRoot).stat(executable.attachment.objectKey),
      ).resolves.toBeNull();
    } finally {
      await rm(fixture.blobRoot, { recursive: true, force: true });
    }
  });

  it("rejects a client media claim that does not match the bytes", async () => {
    const fixture = await createFixture();
    try {
      const pending = await fixture.service.beginUpload({
        workspaceId: fixture.workspace.id,
        principalId: fixture.principal.id,
        idempotencyKey: "fake-image",
        originalName: "fake.png",
        declaredMediaType: "image/png",
      });
      await expect(
        fixture.service.completeUpload({
          attachmentId: pending.attachment.id,
          principalId: fixture.principal.id,
          source: await chunks(Buffer.from("this is text, not a png")),
        }),
      ).rejects.toBeInstanceOf(AttachmentMediaMismatchError);
      await expect(fixture.repository.getById(pending.attachment.id)).resolves.toMatchObject({
        status: "failed",
        errorCode: "media_type_mismatch",
      });
    } finally {
      await rm(fixture.blobRoot, { recursive: true, force: true });
    }
  });

  it("cleans expired unattached uploads idempotently", async () => {
    const fixture = await createFixture();
    try {
      const pending = await fixture.repository.createPending({
        workspaceId: fixture.workspace.id,
        uploaderPrincipalId: fixture.principal.id,
        objectKey: `aa/${randomUUID().replaceAll("-", "")}${"0".repeat(32)}`,
        originalName: "abandoned.txt",
        declaredMediaType: "text/plain",
        expiresAt: new Date(Date.now() + 1_000),
      });
      const cleaned = await fixture.service.cleanupExpired(
        new Date(Date.now() + 2_000),
      );
      expect(cleaned).toBeGreaterThanOrEqual(1);
      await expect(fixture.repository.getById(pending.attachment.id)).resolves.toBeNull();
      await expect(
        fixture.service.cleanupExpired(new Date(Date.now() + 3_000)),
      ).resolves.toBe(0);
    } finally {
      await rm(fixture.blobRoot, { recursive: true, force: true });
    }
  });

  it("streams linked content to a room member without exposing its object key", async () => {
    const fixture = await createFixture();
    try {
      const pending = await fixture.service.beginUpload({
        workspaceId: fixture.workspace.id,
        principalId: fixture.principal.id,
        idempotencyKey: "room-read",
        originalName: "notes.txt",
        declaredMediaType: "text/plain",
      });
      const body = Buffer.from("private room bytes");
      await fixture.service.completeUpload({
        attachmentId: pending.attachment.id,
        principalId: fixture.principal.id,
        source: await chunks(body),
      });
      await fixture.rooms.createMessage({
        roomId: fixture.room.id,
        senderPrincipalId: fixture.principal.id,
        kind: "message",
        content: "read this",
        status: "completed",
        idempotencyKey: randomUUID(),
        attachmentIds: [pending.attachment.id],
      });

      const opened = await fixture.service.openForRoomMember({
        attachmentId: pending.attachment.id,
        roomId: fixture.room.id,
        principalId: fixture.reader.id,
      });
      const received: Buffer[] = [];
      for await (const chunk of opened.content.stream) received.push(Buffer.from(chunk));
      expect(Buffer.concat(received)).toEqual(body);
      expect(opened.attachment).toMatchObject({ id: pending.attachment.id, roomId: fixture.room.id });
      expect(opened.attachment).not.toHaveProperty("objectKey");

      await expect(
        fixture.service.openForRoomMember({
          attachmentId: pending.attachment.id,
          roomId: randomUUID(),
          principalId: fixture.reader.id,
        }),
      ).rejects.toMatchObject({ name: "AttachmentPermissionError" });
    } finally {
      await rm(fixture.blobRoot, { recursive: true, force: true });
    }
  });
});
