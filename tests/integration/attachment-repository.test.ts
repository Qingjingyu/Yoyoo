/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AttachmentRepository } from "@/server/postgres/attachment-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { WorkspaceRepository } from "@/server/postgres/workspace-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const pool = createPostgresPool(databaseUrl, { max: 4 });

async function createFixture() {
  const suffix = randomUUID();
  const principals = new PrincipalRepository(pool);
  const workspaces = new WorkspaceRepository(pool);
  const rooms = new RoomRepository(pool);
  const human = await principals.create({
    kind: "human",
    externalKey: `human:attachment-${suffix}`,
    handle: `human-${suffix.slice(0, 8)}`,
    displayName: "Attachment Owner",
  });
  const agent = await principals.create({
    kind: "agent",
    externalKey: `agent:attachment-${suffix}`,
    handle: `agent-${suffix.slice(0, 8)}`,
    displayName: "File Reader",
  });
  const otherAgent = await principals.create({
    kind: "agent",
    externalKey: `agent:attachment-other-${suffix}`,
    handle: `other-${suffix.slice(0, 8)}`,
    displayName: "Other Reader",
  });
  const workspace = await workspaces.create({
    slug: `attachment-${suffix}`,
    name: "Attachment Test Space",
    ownerPrincipalId: human.id,
  });
  for (const principalId of [agent.id, otherAgent.id]) {
    await workspaces.addMember({ workspaceId: workspace.id, principalId, role: "member" });
  }
  const room = await rooms.create({
    workspaceId: workspace.id,
    name: "Attachment Room",
    createdByPrincipalId: human.id,
  });
  for (const principalId of [agent.id, otherAgent.id]) {
    await rooms.addMember({
      roomId: room.id,
      principalId,
      role: "member",
      listenerPolicy: "mention_only",
    });
  }
  return { human, agent, otherAgent, workspace, room, rooms };
}

describe("AttachmentRepository", () => {
  beforeAll(async () => {
    // Global setup applies the forward-only migration before this suite.
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates one pending upload per object key and completes it for its owner", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const objectKey = `ab/${randomUUID().replaceAll("-", "")}`;
    const expiresAt = new Date(Date.now() + 60_000);
    const input = {
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey,
      originalName: "proposal.pdf",
      declaredMediaType: "application/pdf",
      expiresAt,
    };

    const first = await repository.createPending(input);
    const duplicate = await repository.createPending(input);
    const ready = await repository.markReady({
      attachmentId: first.attachment.id,
      principalId: fixture.human.id,
      detectedMediaType: "application/pdf",
      sizeBytes: 128,
      sha256: "a".repeat(64),
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      attachment: { id: first.attachment.id, status: "pending" },
    });
    expect(ready).toMatchObject({
      id: first.attachment.id,
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey,
      originalName: "proposal.pdf",
      status: "ready",
      sizeBytes: 128,
      sha256: "a".repeat(64),
    });
  });

  it("atomically links only the uploader's ready files to a room message", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const pending = await repository.createPending({
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey: `cd/${randomUUID().replaceAll("-", "")}`,
      originalName: "launch.png",
      declaredMediaType: "image/png",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.markReady({
      attachmentId: pending.attachment.id,
      principalId: fixture.human.id,
      detectedMediaType: "image/png",
      sizeBytes: 64,
      sha256: "b".repeat(64),
    });
    const message = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "请查看图片",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agent.id],
    });
    const agentMessage = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.agent.id,
      kind: "message",
      content: "Agent cannot attach another principal's upload",
      status: "completed",
      idempotencyKey: randomUUID(),
    });

    await expect(
      repository.linkReadyToMessage({
        workspaceId: fixture.workspace.id,
        roomId: fixture.room.id,
        messageId: agentMessage.message.id,
        principalId: fixture.agent.id,
        attachmentIds: [pending.attachment.id],
      }),
    ).rejects.toThrow("Attachment is not owned by the current principal");

    const linked = await repository.linkReadyToMessage({
      workspaceId: fixture.workspace.id,
      roomId: fixture.room.id,
      messageId: message.message.id,
      principalId: fixture.human.id,
      attachmentIds: [pending.attachment.id],
    });

    expect(linked).toEqual([
      expect.objectContaining({
        id: pending.attachment.id,
        roomId: fixture.room.id,
        messageId: message.message.id,
        position: 0,
      }),
    ]);
    await expect(
      repository.linkReadyToMessage({
        workspaceId: fixture.workspace.id,
        roomId: fixture.room.id,
        messageId: message.message.id,
        principalId: fixture.human.id,
        attachmentIds: [pending.attachment.id],
      }),
    ).resolves.toEqual(linked);
  });

  it("creates a message and its attachment links atomically", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const first = await repository.createPending({
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey: `02/${randomUUID().replaceAll("-", "")}`,
      originalName: "atomic.txt",
      declaredMediaType: "text/plain",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.markReady({
      attachmentId: first.attachment.id,
      principalId: fixture.human.id,
      detectedMediaType: "text/plain",
      sizeBytes: 6,
      sha256: "b".repeat(64),
    });
    const pending = await repository.createPending({
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey: `03/${randomUUID().replaceAll("-", "")}`,
      originalName: "not-ready.txt",
      declaredMediaType: "text/plain",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const idempotencyKey = randomUUID();

    const created = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "with a file",
      status: "completed",
      idempotencyKey,
      attachmentIds: [first.attachment.id],
    });
    const duplicate = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "with a file",
      status: "completed",
      idempotencyKey,
      attachmentIds: [first.attachment.id],
    });

    expect(duplicate).toMatchObject({ duplicate: true, message: { id: created.message.id } });
    await expect(repository.listForMessage(created.message.id)).resolves.toEqual([
      expect.objectContaining({ id: first.attachment.id, position: 0 }),
    ]);
    await expect(
      fixture.rooms.createMessage({
        roomId: fixture.room.id,
        senderPrincipalId: fixture.human.id,
        kind: "message",
        content: "must roll back",
        status: "completed",
        idempotencyKey: `${idempotencyKey}-invalid`,
        attachmentIds: [pending.attachment.id],
      }),
    ).rejects.toThrow("Every attachment must be ready");
    const rolledBack = await pool.query(
      "SELECT id FROM room_messages WHERE room_id = $1 AND idempotency_key = $2",
      [fixture.room.id, `${idempotencyKey}-invalid`],
    );
    expect(rolledBack.rowCount).toBe(0);
  });

  it("returns linked metadata only to an active room member", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const outsider = await new PrincipalRepository(pool).create({
      kind: "human",
      externalKey: `human:attachment-outsider-${randomUUID()}`,
      handle: `outsider-${randomUUID().slice(0, 8)}`,
      displayName: "Outsider",
    });
    const pending = await repository.createPending({
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey: `04/${randomUUID().replaceAll("-", "")}`,
      originalName: "private.pdf",
      declaredMediaType: "application/pdf",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.markReady({
      attachmentId: pending.attachment.id,
      principalId: fixture.human.id,
      detectedMediaType: "application/pdf",
      sizeBytes: 8,
      sha256: "c".repeat(64),
    });
    const message = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "private file",
      status: "completed",
      idempotencyKey: randomUUID(),
      attachmentIds: [pending.attachment.id],
    });

    await expect(
      repository.getForRoomMember({
        attachmentId: pending.attachment.id,
        roomId: fixture.room.id,
        principalId: fixture.agent.id,
      }),
    ).resolves.toMatchObject({
      id: pending.attachment.id,
      messageId: message.message.id,
    });
    await expect(
      repository.getForRoomMember({
        attachmentId: pending.attachment.id,
        roomId: fixture.room.id,
        principalId: outsider.id,
      }),
    ).resolves.toBeNull();
  });

  it("rejects a message whose ready attachments exceed the total byte limit", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const attachmentIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const pending = await repository.createPending({
        workspaceId: fixture.workspace.id,
        uploaderPrincipalId: fixture.human.id,
        objectKey: `05/${randomUUID().replaceAll("-", "")}`,
        originalName: `large-${index}.bin`,
        declaredMediaType: "application/octet-stream",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await repository.markReady({
        attachmentId: pending.attachment.id,
        principalId: fixture.human.id,
        detectedMediaType: "application/octet-stream",
        sizeBytes: 25 * 1024 * 1024,
        sha256: `${index}`.repeat(64),
      });
      attachmentIds.push(pending.attachment.id);
    }

    await expect(fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "too large together",
      status: "completed",
      idempotencyKey: randomUUID(),
      attachmentIds,
    })).rejects.toThrow("100 MiB");
  });

  it("grants a target Agent only its run-scoped linked attachment", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const pending = await repository.createPending({
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey: `ef/${randomUUID().replaceAll("-", "")}`,
      originalName: "brief.txt",
      declaredMediaType: "text/plain",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.markReady({
      attachmentId: pending.attachment.id,
      principalId: fixture.human.id,
      detectedMediaType: "text/plain",
      sizeBytes: 32,
      sha256: "c".repeat(64),
    });
    const message = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "@FileReader 阅读附件",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agent.id],
    });
    await repository.linkReadyToMessage({
      workspaceId: fixture.workspace.id,
      roomId: fixture.room.id,
      messageId: message.message.id,
      principalId: fixture.human.id,
      attachmentIds: [pending.attachment.id],
    });
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO room_runs
        (id, room_id, trigger_message_id, target_agent_principal_id,
         adapter_id, trigger_type, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'attachment-test', 'message', 'queued', $5)`,
      [runId, fixture.room.id, message.message.id, fixture.agent.id, randomUUID()],
    );

    const grant = await repository.createAccessGrant({
      workspaceId: fixture.workspace.id,
      roomId: fixture.room.id,
      attachmentId: pending.attachment.id,
      runId,
      principalId: fixture.agent.id,
      expiresAt: new Date(Date.now() + 30_000),
    });

    await expect(
      repository.getGrantedAttachment({
        grantId: grant.id,
        principalId: fixture.otherAgent.id,
        now: new Date(),
      }),
    ).resolves.toBeNull();
    await expect(
      repository.getGrantedAttachment({
        grantId: grant.id,
        principalId: fixture.agent.id,
        now: new Date(),
      }),
    ).resolves.toMatchObject({ id: pending.attachment.id, objectKey: pending.attachment.objectKey });
    await expect(
      repository.getGrantedAttachmentByScope({
        attachmentId: pending.attachment.id,
        runId,
        principalId: fixture.agent.id,
        now: new Date(),
      }),
    ).resolves.toMatchObject({ id: pending.attachment.id });
    await expect(
      repository.getGrantedAttachmentByScope({
        attachmentId: pending.attachment.id,
        runId,
        principalId: fixture.otherAgent.id,
        now: new Date(),
      }),
    ).resolves.toBeNull();

    await repository.revokeAccessGrant(grant.id);
    await expect(
      repository.getGrantedAttachment({
        grantId: grant.id,
        principalId: fixture.agent.id,
        now: new Date(),
      }),
    ).resolves.toBeNull();
    await expect(
      repository.getGrantedAttachmentByScope({
        attachmentId: pending.attachment.id,
        runId,
        principalId: fixture.agent.id,
        now: new Date(),
      }),
    ).resolves.toBeNull();
  });

  it("lists only expired pending uploads for cleanup", async () => {
    const fixture = await createFixture();
    const repository = new AttachmentRepository(pool);
    const expiresAt = new Date(Date.now() + 1_000);
    const pending = await repository.createPending({
      workspaceId: fixture.workspace.id,
      uploaderPrincipalId: fixture.human.id,
      objectKey: `01/${randomUUID().replaceAll("-", "")}`,
      originalName: "temporary.txt",
      declaredMediaType: "text/plain",
      expiresAt,
    });

    const atBoundary = await repository.listExpiredPending(expiresAt);
    expect(atBoundary.some((attachment) => attachment.id === pending.attachment.id)).toBe(false);
    const afterBoundary = await repository.listExpiredPending(
      new Date(expiresAt.getTime() + 1),
    );
    expect(afterBoundary).toContainEqual(
      expect.objectContaining({ id: pending.attachment.id, objectKey: pending.attachment.objectKey }),
    );
    await repository.deletePending(pending.attachment.id);
    const afterDelete = await repository.listExpiredPending(
      new Date(expiresAt.getTime() + 1),
    );
    expect(afterDelete.some((attachment) => attachment.id === pending.attachment.id)).toBe(false);
  });
});
